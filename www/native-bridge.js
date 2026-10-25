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
  // 触觉覆盖范围:按钮、标签、卡片、自制键盘按键、弹窗里的选项、开关/复选/单选、下拉、可点击行、输入框聚焦
  var lastHap = 0;
  function tick(kind) {                       // 40ms 内去重,避免 pointerdown 与 click 重复震
    var n = Date.now(); if (n - lastHap < 40) return; lastHap = n; NB.haptic(kind);
  }
  // 提示音 / 数字播报:各自独立开关(localStorage keySound / keyVoice),默认都开
  var SPEAKKEY = { '.': 'dot', '-': 'neg' };
  var SPEAK = { '0': '零', '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八', '9': '九', '00': '零零', '.': '点', '-': '负', back: '删除', clear: '清空', enter: '确认', hide: '收起' };
  function flag(k) { return localStorage.getItem(k) !== '0'; }
  NB.isSoundOn = function () { return flag('keySound'); };
  NB.isVoiceOn = function () { return flag('keyVoice'); };
  NB.setSound = function (v) { localStorage.setItem('keySound', v ? '1' : '0'); };
  NB.setVoice = function (v) { localStorage.setItem('keyVoice', v ? '1' : '0'); if (!v) H.postMessage({ id: 's', op: 'speak', payload: { text: '' } }); };
  // 播报语速(0.6~1.8,1.0=原速)与音量(0~1),可在键盘 ⚙︎ 里调,保存在本机
  function num(k, d) { var v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? v : d; }
  NB.getVoiceRate = function () { return Math.min(1.8, Math.max(0.6, num('voiceRate', 1.0))); };
  NB.getVoiceVol = function () { return Math.min(1, Math.max(0, num('voiceVol', 1.0))); };
  NB.setVoiceRate = function (v) { localStorage.setItem('voiceRate', String(v)); };
  NB.setVoiceVol = function (v) { localStorage.setItem('voiceVol', String(v)); };
  // 播报声音:xiaoxiao(默认)/ xiaoyi;晓伊的录音在 voice-yi,原生端以 "yi/" 前缀存放
  NB.getVoiceName = function () { return localStorage.getItem('voiceName') === 'yi' ? 'yi' : 'xiaoxiao'; };
  NB.setVoiceName = function (n) { localStorage.setItem('voiceName', n === 'yi' ? 'yi' : 'xiaoxiao'); };
  NB.voiceKey = function (k) { return (NB.getVoiceName() === 'yi' ? 'yi/' : '') + k; };
  function keyFeedback(kk) {
    var spoken = flag('keyVoice') && SPEAK[kk];
    var isNum = /^(\d|00|\.|-)$/.test(kk);        // 数字/小数点/负号:语音已开时不再叠系统按键音,听感更干净
    if (flag('keySound') && !(spoken && isNum)) H.postMessage({ id: 's', op: 'sound', payload: { type: kk === 'back' || kk === 'clear' ? 'delete' : (kk === 'enter' || kk === 'hide' ? 'action' : 'key') } });
    if (flag('keyVoice') && SPEAK[kk]) H.postMessage({ id: 's', op: 'speak', payload: { text: SPEAK[kk], key: NB.voiceKey(SPEAKKEY[kk] || kk), rate: NB.getVoiceRate(), vol: NB.getVoiceVol() } });
  }
  // 其他按钮的提示音:独立开关 uiSound(默认开)。按类型区分,避免所有按钮同一个声音
  NB.isUiSoundOn = function () { return flag('uiSound'); };
  NB.setUiSound = function (v) { localStorage.setItem('uiSound', v ? '1' : '0'); };
  function uiSound(type) { if (flag('uiSound')) H.postMessage({ id: 's', op: 'sound', payload: { type: type } }); }
  var DANGER = /danger|clear|reset|delete|remove|清零|重置|删除|全清|清空|移除/i;
  function isDanger(el) {
    var b = el.closest('button, [role=button], .app-card, [onclick]'); if (!b) return false;
    return DANGER.test(b.className + ' ' + (b.getAttribute('onclick') || '') + ' ' + (b.textContent || '').slice(0, 12));
  }
  // 任意触摸都提前唤醒原生音频/触觉(1.5s 节流):第一下按键时引擎已就绪,第一个数字不会发声延迟
  var lastWarm = 0;
  document.addEventListener('pointerdown', function () {
    var n = Date.now(); if (n - lastWarm < 1500) return; lastWarm = n;
    H.postMessage({ id: 'w', op: 'warm', payload: {} });
  }, true);
  var SEL_TAB = '.tab, .glass-ind, [role=tab]';
  var SEL_KEY = '#vk-keypad button, #vk-keypad [data-k]';
  var SEL_PRESS = 'button, a.app-card, .app-card, [role=button], [onclick], summary, label.switch, .chip, .platform-select-chip, .toggle, .pill, select';
  // 自制键盘:按下瞬间就震(它在 pointerup 里处理并阻止了 click,所以必须监听 pointerdown)
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest && e.target;
    if (!t || !t.closest) return;
    if (t.closest(SEL_KEY)) {
      var k = t.closest('[data-k]'); var kk = k && k.dataset.k;
      // 数字键 rigid(清脆有力),退格/清空 medium,回车/收起 heavy
      tick(kk === 'enter' || kk === 'hide' ? 'heavy' : (kk === 'back' || kk === 'clear' ? 'medium' : 'rigid'));
      keyFeedback(kk);
      return;
    }
  }, true);
  document.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest(SEL_KEY)) return;           // 键盘已在 pointerdown 处理
    if (t.closest(SEL_TAB)) { uiSound('tab'); return tick('selection'); }
    if (t.closest('input[type=checkbox], input[type=radio], input[type=range]')) { uiSound('tab'); return tick('selection'); }
    if (t.closest(SEL_PRESS)) { uiSound(isDanger(t) ? 'danger' : 'tap'); tick('light'); }
  }, true);
  // 面值张数输入框(财务 central-faceN / 现金箱 face-N / 财务 central-z):聚焦时统一给 震动+提示音。
  // 手动点、回车、自动跳转都走 focusin,所以三种方式表现完全一致;150ms 去重保证一次聚焦只响一下。
  var FACE_INPUT = /^(central-face\d+|face-\d+|central-z)$/;
  var lastFaceFb = 0;
  function faceFocusFeedback() {
    var n = Date.now(); if (n - lastFaceFb < 150) return; lastFaceFb = n;
    tick('light');
    uiSound('tap');
  }
  // 点进输入框(弹出键盘)也给一下轻触
  document.addEventListener('focusin', function (e) {
    var t = e.target; if (!t || !t.tagName) return;
    if (FACE_INPUT.test(t.id || '')) { faceFocusFeedback(); return; }
    if (/^(INPUT|TEXTAREA)$/.test(t.tagName) && !/^(checkbox|radio|button|submit|file|range|hidden)$/.test(t.type)) tick('light');
  }, true);
  // toast 的类型决定震动：成功/警告/错误（页面里 toast 元素的 class 变化）
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      var el = m.target;
      if (!el.classList || !el.classList.contains('toast') || !el.classList.contains('show')) return;
      if (m.oldValue && m.oldValue.indexOf('show') >= 0) return;
      var c = el.className;
      var kind = /error|danger|fail/.test(c) ? 'error' : /warn/.test(c) ? 'warning' : /success/.test(c) ? 'success' : 'light';
      NB.haptic(kind);
      if (kind !== 'light') uiSound(kind);
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
