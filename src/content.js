(() => {
  'use strict';
  const S = globalThis.GAI_SELECTORS;
  const t = (k) => chrome.i18n.getMessage(k) || k;
  const hosts = new WeakMap();
  let panel = null;

  /* ---------- helpers ---------- */

  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    e.append(...kids.flat().filter((x) => x != null));
    return e;
  }

  function send(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => ({ ok: false, code: 'EXTENSION' }));
  }

  function theme() {
    for (const el of [document.body, document.documentElement]) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0.5)) {
        const [r, g, b] = m.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 'dark' : 'light';
      }
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  const BLOCK = /^(DIV|P|LI|UL|OL|TR|H[1-6]|BLOCKQUOTE|PRE|TABLE)$/;

  function nodeToText(root, skipExcluded = true) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue.replace(/\u00a0/g, ' ');
        return;
      }
      if (n.nodeType === 1) {
        if (n.tagName === 'BR') {
          out += '\n';
          return;
        }
        if (n.tagName === 'STYLE' || n.tagName === 'SCRIPT') return;
        if (skipExcluded && n !== root && n.matches(S.excluded)) return;
      } else if (n.nodeType !== 11) return;
      const block = n.nodeType === 1 && BLOCK.test(n.tagName);
      if (block && out && !out.endsWith('\n')) out += '\n';
      n.childNodes.forEach(walk);
      if (block && !out.endsWith('\n')) out += '\n';
    };
    walk(root);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- thread context ---------- */

  function readThreadMessages() {
    const msgs = [...document.querySelectorAll(S.threadMessage)].slice(-5);
    const parts = msgs
      .map((el) => {
        const c = el.closest(S.threadMessageContainer);
        const s = c?.querySelector(S.threadSender);
        const who = s ? s.getAttribute('name') || s.textContent || s.getAttribute('email') : '';
        const text = nodeToText(el).slice(0, 4000);
        return text ? (who ? `From: ${who}\n${text}` : text) : '';
      })
      .filter(Boolean);
    let total = 0;
    const kept = [];
    for (const p of parts.reverse()) {
      total += p.length;
      if (total > 12000) break;
      kept.unshift(p);
    }
    return kept;
  }

  function getContext(body) {
    const quotes = [...body.querySelectorAll(S.quote)];
    const msgs = body.closest(S.dialog) ? [] : readThreadMessages();
    if (msgs.length) return msgs.join('\n\n---\n\n');
    return quotes.map((q) => nodeToText(q, false)).join('\n\n').slice(0, 8000);
  }

  /* ---------- draft ranges and insertion ---------- */

  function draftRange(body) {
    const r = document.createRange();
    r.selectNodeContents(body);
    const first = body.querySelector(S.excluded);
    if (first) r.setEndBefore(first);
    return r;
  }

  const toHtml = (text) =>
    text
      .split('\n')
      .map((l) =>
        l ? `<div>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : '<div><br></div>'
      )
      .join('');

  function insertText(p, mode) {
    const text = p.result.value.replace(/\r/g, '').trim();
    if (!text) return;
    const body = p.body;
    const saved = p.range && body.contains(p.range.startContainer) ? p.range.cloneRange() : null;
    let range;
    if (mode === 'replace') range = p.selText && saved ? saved : draftRange(body);
    else {
      range = saved || draftRange(body);
      range.collapse(false);
    }
    body.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = text.includes('\n')
      ? document.execCommand('insertHTML', false, toHtml(text))
      : document.execCommand('insertText', false, text);
    if (!ok) {
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      body.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    closePanel(false);
    body.focus();
  }

  /* ---------- panel ---------- */

  function closePanel(restoreFocus = true) {
    if (!panel) return;
    if (panel.reqId) send({ type: 'CANCEL', requestId: panel.reqId });
    removeEventListener('resize', panel.reposition);
    document.removeEventListener('mousedown', panel.outside, true);
    panel.el.remove();
    if (restoreFocus) panel.btn.focus();
    panel = null;
  }

  function togglePanel(body, btn) {
    if (panel && panel.body === body) return closePanel();
    closePanel(false);
    openPanel(body, btn);
  }

  function openPanel(body, btn) {
    const sel = getSelection();
    const p = (panel = { body, btn, range: null, selText: '', reqId: null, last: null, cfg: null });
    if (sel.rangeCount && body.contains(sel.getRangeAt(0).startContainer)) {
      p.range = sel.getRangeAt(0).cloneRange();
      if (!p.range.collapsed) p.selText = nodeToText(p.range.cloneContents(), false);
    }
    p.hasContext = !!getContext(body);

    const instruction = h('textarea', {
      class: 'gai-input',
      rows: 3,
      id: 'gai-instr',
      placeholder: t('instructionPlaceholder'),
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          run('generate');
        }
      }
    });
    const useThread = h('input', { type: 'checkbox', id: 'gai-thread', checked: true });
    const toneSel = h('select', { class: 'gai-select', 'aria-label': t('tonePick'), onchange: () => {
      if (toneSel.value) run('tone', { tone: toneSel.value });
      toneSel.selectedIndex = 0;
    } }, h('option', { value: '', disabled: true, selected: true }, t('tonePick')),
      ...['formal', 'neutral', 'friendly', 'assertive', 'polite'].map((k) => h('option', { value: k }, t('tone_' + k))));
    const langSel = h('select', { class: 'gai-select', 'aria-label': t('translatePick'), onchange: () => {
      if (langSel.value) run('translate', { language: langSel.value });
      langSel.selectedIndex = 0;
    } }, h('option', { value: '', disabled: true, selected: true }, t('translatePick')));
    const quick = (key, action) => h('button', { type: 'button', class: 'gai-chip', onclick: () => run(action) }, t(key));

    const scope = h('div', { class: 'gai-scope' });
    const msgBox = h('div', { class: 'gai-msg', role: 'alert' });
    const spinner = h('div', { class: 'gai-loading', role: 'status', hidden: true },
      h('span', { class: 'gai-spinner', 'aria-hidden': 'true' }), h('span', {}, t('loading')),
      h('button', { type: 'button', class: 'gai-btn2', onclick: () => cancelRequest() }, t('cancelRequest')));
    const result = h('textarea', { class: 'gai-input gai-result', rows: 8, id: 'gai-result', 'aria-label': t('resultLabel') });
    const replaceBtn = h('button', { type: 'button', class: 'gai-btn2', onclick: () => insertText(p, 'replace') });
    const resultBox = h('div', { class: 'gai-resultbox', hidden: true },
      h('label', { for: 'gai-result' }, t('resultLabel')), result,
      h('div', { class: 'gai-actions' },
        h('button', { type: 'button', class: 'gai-primary', onclick: () => insertText(p, 'insert') }, t('insert')),
        replaceBtn,
        h('button', { type: 'button', class: 'gai-btn2', onclick: () => p.last && run(p.last.action, p.last.extra) }, t('regenerate')),
        h('button', { type: 'button', class: 'gai-btn2', onclick: () => closePanel() }, t('cancel'))));

    const el = h('div', { class: 'gai-panel', role: 'dialog', 'aria-label': t('panelTitle'), 'data-theme': theme(),
      onkeydown: (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closePanel();
        }
      } },
      h('div', { class: 'gai-head' }, h('strong', {}, t('panelTitle')),
        h('button', { type: 'button', class: 'gai-x', 'aria-label': t('close'), onclick: () => closePanel() }, '×')),
      h('label', { for: 'gai-instr' }, t('instructionLabel')), instruction,
      h('div', { class: 'gai-actions' },
        h('button', { type: 'button', class: 'gai-primary', onclick: () => run('generate') }, t('generate')),
        h('label', { class: 'gai-check', hidden: !p.hasContext }, useThread, t('useThread'))),
      scope,
      h('div', { class: 'gai-row' }, quick('actFix', 'fix'), quick('actShorten', 'shorten'),
        quick('actExpand', 'expand'), quick('actRephrase', 'rephrase')),
      h('div', { class: 'gai-row' }, toneSel, langSel),
      msgBox, spinner, resultBox,
      h('div', { class: 'gai-privacy' }, t('privacyShort')));
    document.body.append(el);

    Object.assign(p, { el, instruction, useThread, toneSel, langSel, scope, msgBox, spinner, resultBox, result, replaceBtn });
    updateScope(p);

    p.reposition = () => {
      const r = btn.getBoundingClientRect();
      const w = Math.min(420, innerWidth - 16);
      el.style.width = w + 'px';
      el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
      if (r.top > innerHeight / 2) {
        el.style.bottom = innerHeight - r.top + 8 + 'px';
        el.style.top = 'auto';
        el.style.maxHeight = Math.max(240, r.top - 16) + 'px';
      } else {
        el.style.top = r.bottom + 8 + 'px';
        el.style.bottom = 'auto';
        el.style.maxHeight = Math.max(240, innerHeight - r.bottom - 16) + 'px';
      }
    };
    p.outside = (e) => {
      if (!el.contains(e.target) && !btn.contains(e.target)) closePanel(false);
    };
    p.reposition();
    addEventListener('resize', p.reposition);
    document.addEventListener('mousedown', p.outside, true);
    instruction.focus();

    send({ type: 'GET_UI_CONFIG' }).then((c) => {
      if (panel !== p || !c.ok) return;
      p.cfg = c;
      for (const l of c.languages || []) langSel.append(h('option', { value: l }, l));
      if (!c.hasKey) showError('NO_KEY');
    });
  }

  function updateScope(p) {
    const draft = nodeToText(p.body);
    p.scope.textContent = p.selText ? t('scopeSelection') : draft ? t('scopeDraft') : t('scopeEmpty');
    p.replaceBtn.textContent = p.selText ? t('replaceSelection') : t('replaceDraft');
  }

  function setLoading(on) {
    panel.spinner.hidden = !on;
    if (on) {
      panel.msgBox.textContent = '';
      panel.resultBox.hidden = true;
    }
  }

  function cancelRequest() {
    if (!panel?.reqId) return;
    send({ type: 'CANCEL', requestId: panel.reqId });
    panel.reqId = null;
    setLoading(false);
    panel.instruction.focus();
  }

  const ERR_KEYS = {
    NO_KEY: 'errNoKey',
    INVALID_KEY: 'errInvalidKey',
    RATE_LIMIT: 'errRateLimit',
    NETWORK: 'errNetwork',
    BLOCKED: 'errBlocked',
    MODEL: 'errModel',
    EMPTY: 'errEmpty',
    EXTENSION: 'errExtension',
    EMPTY_DRAFT: 'errEmptyDraft',
    NO_INSTRUCTION: 'errNoInstruction'
  };

  function showError(code, detail) {
    const box = panel.msgBox;
    box.textContent = '';
    box.append(h('span', { class: 'gai-error' }, t(ERR_KEYS[code] || 'errGeneric')));
    if (code === 'API' && detail) box.append(h('div', { class: 'gai-detail' }, detail));
    if (code === 'NO_KEY' || code === 'INVALID_KEY' || code === 'MODEL') {
      box.append(' ', h('a', { href: '#', class: 'gai-link', onclick: (e) => {
        e.preventDefault();
        send({ type: 'OPEN_OPTIONS' });
      } }, t('openSettings')));
    }
  }

  async function run(action, extra = {}) {
    const p = panel;
    if (!p) return;
    if (p.reqId) cancelRequest();
    p.last = { action, extra };
    updateScope(p);

    const instruction = p.instruction.value.trim();
    const draft = nodeToText(p.body);
    const text = action === 'generate' ? draft : p.selText || draft;
    if (action === 'generate' && !instruction) return showError('NO_INSTRUCTION');
    if (action !== 'generate' && !text) return showError('EMPTY_DRAFT');

    const requestId = crypto.randomUUID();
    p.reqId = requestId;
    setLoading(true);
    const res = await send({
      type: 'GENERATE',
      requestId,
      payload: {
        action,
        instruction: action === 'generate' ? instruction : '',
        text,
        scope: p.selText && action !== 'generate' ? 'selection' : 'draft',
        thread: action === 'generate' && p.hasContext && p.useThread.checked ? getContext(p.body) : '',
        ...extra
      }
    });
    if (panel !== p || p.reqId !== requestId) return;
    p.reqId = null;
    setLoading(false);
    if (!res.ok) {
      if (res.code === 'CANCELLED') return;
      return showError(res.code, res.message);
    }
    p.result.value = res.text;
    p.resultBox.hidden = false;
    p.result.focus();
  }

  /* ---------- attaching to compose windows ---------- */

  function findToolbar(body) {
    let n = body.parentElement;
    for (let i = 0; n && i < 25; i++, n = n.parentElement) {
      const tb = n.querySelector(S.toolbar);
      if (tb) return tb;
      const sb = n.querySelector(S.sendButton);
      if (sb) return sb.parentElement;
    }
    return null;
  }

  function attach(body) {
    const tb = findToolbar(body);
    if (!tb) return;
    const existing = hosts.get(tb);
    if (existing && existing.isConnected && existing._body === body) return;
    existing?.remove();
    const host = h(tb.tagName === 'TR' ? 'td' : 'div', { class: 'gai-host', 'data-theme': theme() });
    host._body = body;
    const btn = h('button', {
      type: 'button',
      class: 'gai-trigger',
      title: t('btnAiTitle'),
      'aria-haspopup': 'dialog',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => togglePanel(body, btn)
    }, h('span', { 'aria-hidden': 'true' }, '✦ '), t('btnAi'));
    host.append(btn);
    tb.append(host);
    hosts.set(tb, host);
  }

  let queued = false;
  function scan() {
    queued = false;
    document.querySelectorAll(S.composeBody).forEach(attach);
    if (panel && !panel.body.isConnected) closePanel(false);
  }
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
