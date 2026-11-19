import { buildPrompt } from './prompts.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 90000;
const EDIT_ACTIONS = ['fix', 'tone', 'shorten', 'expand', 'rephrase', 'translate'];

export const DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  tone: 'auto',
  language: 'auto',
  languages: ['polski', 'angielski'],
  signature: '',
  systemPrompt: '',
  temperature: 0.7
};

const controllers = new Map();

// Klucz API jest dostępny tylko dla zaufanych kontekstów (nie dla content scriptów).
const lockStorage = () =>
  chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
lockStorage();
chrome.runtime.onInstalled.addListener(lockStorage);
chrome.runtime.onStartup.addListener(lockStorage);

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  if (['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'].includes(s.model)) s.model = DEFAULTS.model;
  return s;
}

class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function mapHttpError(status, data) {
  const msg = data?.error?.message || '';
  const st = data?.error?.status || '';
  if (status === 429 || st === 'RESOURCE_EXHAUSTED') return new ApiError('RATE_LIMIT', msg);
  if (status === 404) return new ApiError('MODEL', msg);
  if (status === 401 || status === 403 || st === 'PERMISSION_DENIED' || /api key/i.test(msg)) {
    return new ApiError('INVALID_KEY', msg);
  }
  return new ApiError('API', msg || `HTTP ${status}`);
}

function cleanOutput(text) {
  let s = text.trim();
  const fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  return s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
}

async function callGemini({ apiKey, model, system, user, temperature, signal }) {
  const name = String(model || '').replace(/^models\//, '');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ApiError('MODEL');
  let res;
  try {
    res = await fetch(`${API}${encodeURIComponent(name)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature }
      })
    });
  } catch (e) {
    if (signal?.aborted) throw new ApiError(signal.reason === 'timeout' ? 'NETWORK' : 'CANCELLED');
    throw new ApiError('NETWORK');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw mapHttpError(res.status, data);
  if (data?.promptFeedback?.blockReason) throw new ApiError('BLOCKED');
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text.trim()) {
    throw new ApiError(cand?.finishReason && cand.finishReason !== 'STOP' ? 'BLOCKED' : 'EMPTY');
  }
  return cleanOutput(text);
}

async function generate(msg) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new ApiError('NO_KEY');
  const r = msg.payload || {};
  if (r.action !== 'generate' && !EDIT_ACTIONS.includes(r.action)) throw new ApiError('API', 'Bad action');
  const lim = (s, n) => String(s || '').slice(0, n);
  const req = {
    action: r.action,
    instruction: lim(r.instruction, 4000),
    text: lim(r.text, 30000),
    thread: lim(r.thread, 20000),
    tone: lim(r.tone, 20),
    language: lim(r.language, 60),
    scope: r.scope === 'selection' ? 'selection' : 'draft'
  };
  const { system, user } = buildPrompt(settings, req);
  const temperature = Math.min(2, Math.max(0, Number(settings.temperature) || 0));

  const ctrl = new AbortController();
  controllers.set(msg.requestId, ctrl);
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  try {
    return await callGemini({
      apiKey: settings.apiKey,
      model: settings.model,
      system,
      user,
      temperature: req.action === 'fix' ? Math.min(temperature, 0.3) : temperature,
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(timer);
    controllers.delete(msg.requestId);
  }
}

async function test(msg) {
  const saved = await getSettings();
  const apiKey = msg.apiKey || saved.apiKey;
  if (!apiKey) throw new ApiError('NO_KEY');
  return callGemini({
    apiKey,
    model: msg.model || saved.model,
    system: 'Reply with the single word: OK',
    user: 'ping',
    temperature: 0,
    signal: AbortSignal.timeout(30000)
  });
}

async function handle(msg, sender) {
  if (sender.id !== chrome.runtime.id) throw new ApiError('API', 'Forbidden');
  const fromExt = sender.url?.startsWith(chrome.runtime.getURL(''));
  const fromGmail = !!sender.tab && sender.url?.startsWith('https://mail.google.com/');

  switch (msg?.type) {
    case 'GENERATE':
      if (!fromGmail) throw new ApiError('API', 'Forbidden');
      return { text: await generate(msg) };
    case 'CANCEL':
      controllers.get(msg.requestId)?.abort();
      return {};
    case 'GET_UI_CONFIG': {
      if (!fromGmail) throw new ApiError('API', 'Forbidden');
      const s = await getSettings();
      return { hasKey: !!s.apiKey, tone: s.tone, language: s.language, languages: s.languages };
    }
    case 'OPEN_OPTIONS':
      await chrome.runtime.openOptionsPage();
      return {};
    case 'TEST':
      if (!fromExt) throw new ApiError('API', 'Forbidden');
      await test(msg);
      return {};
    default:
      throw new ApiError('API', 'Unknown message');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((e) =>
      sendResponse({ ok: false, code: e.code || 'API', message: e.code ? e.message : 'Error' })
    );
  return true;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
