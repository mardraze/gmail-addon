'use strict';
const t = (k) => chrome.i18n.getMessage(k) || k;
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  tone: 'auto',
  language: 'auto',
  languages: ['polski', 'angielski'],
  signature: '',
  systemPrompt: '',
  temperature: 0.7
};

document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = t(e.dataset.i18n)));
document.querySelectorAll('[data-i18n-placeholder]').forEach((e) => (e.placeholder = t(e.dataset.i18nPlaceholder)));
document.title = t('optTitle');

const status = (msg, kind = '') => {
  $('status').textContent = msg;
  $('status').className = kind;
};

const parseLanguages = () =>
  [...new Set($('languages').value.split('\n').map((s) => s.trim()).filter(Boolean))];

function fillLanguageSelect(selected) {
  const sel = $('language');
  const list = parseLanguages();
  if (selected && selected !== 'auto' && !list.includes(selected)) list.push(selected);
  sel.textContent = '';
  sel.append(new Option(t('optLangAuto'), 'auto'));
  list.forEach((l) => sel.append(new Option(l, l)));
  sel.value = selected || 'auto';
}

function syncModelInput() {
  $('customModel').hidden = $('model').value !== '__custom';
}

function fill(s) {
  $('apiKey').value = s.apiKey;
  const known = [...$('model').options].some((o) => o.value === s.model && o.value !== '__custom');
  $('model').value = known ? s.model : '__custom';
  $('customModel').value = known ? '' : s.model;
  syncModelInput();
  $('tone').value = s.tone;
  $('languages').value = s.languages.join('\n');
  fillLanguageSelect(s.language);
  $('signature').value = s.signature;
  $('systemPrompt').value = s.systemPrompt;
  $('temperature').value = s.temperature;
  $('tempOut').textContent = Number(s.temperature).toFixed(1);
}

const currentModel = () => ($('model').value === '__custom' ? $('customModel').value.trim() : $('model').value);

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  fill({ ...DEFAULTS, ...(settings || {}) });
}

$('model').addEventListener('change', syncModelInput);
$('languages').addEventListener('input', () => fillLanguageSelect($('language').value));
$('temperature').addEventListener('input', () => ($('tempOut').textContent = Number($('temperature').value).toFixed(1)));
$('toggleKey').addEventListener('click', () => {
  const show = $('apiKey').type === 'password';
  $('apiKey').type = show ? 'text' : 'password';
  $('toggleKey').textContent = t(show ? 'hide' : 'show');
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const model = currentModel();
  if (!/^(models\/)?[A-Za-z0-9._-]+$/.test(model)) {
    status(t('errModel'), 'err');
    return $('customModel').hidden ? $('model').focus() : $('customModel').focus();
  }
  try {
    await chrome.storage.local.set({
      settings: {
        apiKey: $('apiKey').value.trim(),
        model: model.replace(/^models\//, ''),
        tone: $('tone').value,
        language: $('language').value,
        languages: parseLanguages(),
        signature: $('signature').value,
        systemPrompt: $('systemPrompt').value,
        temperature: Number($('temperature').value)
      }
    });
    status(t('savedOk'), 'ok');
  } catch {
    status(t('saveErr'), 'err');
  }
});

$('test').addEventListener('click', async () => {
  status(t('testing'));
  $('test').disabled = true;
  const res = await chrome.runtime
    .sendMessage({ type: 'TEST', apiKey: $('apiKey').value.trim(), model: currentModel() })
    .catch(() => ({ ok: false, code: 'NETWORK' }));
  $('test').disabled = false;
  if (res?.ok) return status(t('testOk'), 'ok');
  const key = { NO_KEY: 'errNoKey', INVALID_KEY: 'errInvalidKey', RATE_LIMIT: 'errRateLimit', NETWORK: 'errNetwork', BLOCKED: 'errBlocked', MODEL: 'errModel', EMPTY: 'errEmpty' }[res?.code] || 'errGeneric';
  status(`${t('testFail')} ${t(key)}`, 'err');
});

$('wipe').addEventListener('click', async () => {
  if (!confirm(t('confirmDelete'))) return;
  await chrome.storage.local.clear();
  fill(DEFAULTS);
  status(t('deletedOk'), 'ok');
});

load();
