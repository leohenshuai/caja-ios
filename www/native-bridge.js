/* 原生桥：触觉 / 系统剪贴板 / 系统分享 / 下载拦截。浏览器里没有原生环境时完全不生效。 */
(function () {
  'use strict';
  var H = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.native;
  var pending = {}, seq = 0;
  var NB = window.NativeBridge = { available: !!H };

  window.__nativeReply = function (id, res) {
    var cb = pending[id]; if (!cb) return;
    delete pending[id]; clearTimeout(cb.t); cb.resolve(res);
  };
  NB.call = function (op, payload, timeoutMs) {
    if (!H) return Promise.resolve({ ok: false, error: 'no-native' });
    return new Promise(function (resolve) {
      var id = 'n' + (++seq) + '_' + Date.now();
      pending[id] = { resolve: resolve, t: setTimeout(function () { delete pending[id]; resolve({ ok: false, error: 'timeout' }); }, timeoutMs || 15000) };
      try { H.postMessage({ id: id, op: op, payload: payload || {} }); }
      catch (e) { delete pending[id]; resolve({ ok: false, error: String(e) }); }
    });
  };
  if (!H) return;

  /* ---------- 触觉 ---------- */
  var hapticOn = localStorage.getItem('haptics') !== '0';
  NB.setHaptics = function (v) { hapticOn = !!v; localStorage.setItem('haptics', v ? '1' : '0'); };
  NB.haptic = function (t) { if (hapticOn) H.postMessage({ id: 'h', op: 'haptic', payload: { type: t || 'light' } }); };
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tab, .glass-ind');
    if (t) return NB.haptic('selection');
    if (e.target.closest && e.target.closest('button, .app-card, [role=button]')) NB.haptic('light');
  }, true);
  // toast 的类型决定震动：成功/警告/错误（页面里 toast 元素的 class 变化）
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      var el = m.target;
      if (!el.classList || !el.classList.contains('toast') || !el.classList.contains('show')) return;
      if (m.oldValue && m.oldValue.indexOf('show') >= 0) return;
      var c = el.className;
      NB.haptic(/error|danger|fail/.test(c) ? 'error' : /warn/.test(c) ? 'warning' : /success/.test(c) ? 'success' : 'light');
    });
  }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'], attributeOldValue: true });

  /* ---------- 系统剪贴板 ---------- */
  try {
    var clip = {
      writeText: function (t) { return NB.call('clipboardWrite', { text: String(t) }).then(function (r) { if (!r.ok) throw new Error('copy failed'); }); },
      readText: function () { return NB.call('clipboardRead').then(function (r) { if (!r.ok) throw new Error('read failed'); return r.text || ''; }); }
    };
    Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
  } catch (e) { /* 忽略 */ }
  // execCommand('copy') 兜底：选中文本时同步写入原生剪贴板
  var oldExec = document.execCommand ? document.execCommand.bind(document) : null;
  document.execCommand = function (cmd) {
    if (String(cmd).toLowerCase() === 'copy') {
      var a = document.activeElement, txt = '';
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) txt = a.value.substring(a.selectionStart, a.selectionEnd) || a.value;
      else txt = String(window.getSelection());
      if (txt) { NB.call('clipboardWrite', { text: txt }); return true; }
    }
    return oldExec ? oldExec.apply(null, arguments) : false;
  };

  /* ---------- 下载拦截：blob 下载改为系统分享面板 ---------- */
  var blobs = {};
  var origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (b) { var u = origCreate(b); if (b instanceof Blob) blobs[u] = b; return u; };
  function shareBlob(name, blob) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { NB.call('shareFile', { name: name, text: String(fr.result) }, 60000).then(resolve); };
      fr.onerror = function () { resolve({ ok: false }); };
      fr.readAsText(blob);
    });
  }
  NB.shareText = function (name, text) { return NB.call('shareFile', { name: name, text: text }, 60000); };
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && /^blob:/.test(this.href) && blobs[this.href]) {
      var name = this.getAttribute('download') || 'export.json';
      shareBlob(name, blobs[this.href]).then(function (r) { if (r.ok) NB.haptic('success'); });
      return;
    }
    return origClick.apply(this, arguments);
  };
})();
