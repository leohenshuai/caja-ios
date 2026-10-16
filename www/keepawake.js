/* 屏幕常亮：Screen Wake Lock API，右下角小按钮可开关，状态记忆 */
(function () {
  'use strict';
  var KEY = 'keepAwake', lock = null;
  var native = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.keepAwake);
  var on = native ? window.__NATIVE_KEEP_AWAKE__ !== false : localStorage.getItem(KEY) !== '0';
  function push() { if (native) window.webkit.messageHandlers.keepAwake.postMessage(on); }
  var btn = document.createElement('div');
  btn.style.cssText = 'position:fixed;right:10px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:99999;width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:17px;line-height:34px;text-align:center;opacity:.6;user-select:none;-webkit-user-select:none;';
  function paint(note) {
    var active = native ? on : (on && lock && !lock.released);
    btn.textContent = active ? '☀️' : '🌙';
    btn.style.background = active ? 'rgba(230,150,0,.8)' : 'rgba(0,0,0,.45)';
    btn.title = note || (active ? '屏幕常亮：开' : '屏幕常亮：关');
  }
  function toast(t) {
    var d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:8px;font-size:14px;z-index:99999;max-width:80%;';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
  }
  async function acquire(manual) {
    if (native) { push(); if (manual) toast(on ? '屏幕常亮已开启(原生)' : '屏幕常亮已关闭'); return paint(); }
    if (!on || lock && !lock.released) return paint();
    if (!('wakeLock' in navigator)) { if (manual) toast('此浏览器不支持屏幕常亮'); return paint(); }
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', function () { paint(); });
      if (manual) toast('屏幕常亮已开启');
    } catch (e) {
      lock = null;
      if (manual) toast('开启失败：' + (e.name === 'NotAllowedError' ? '系统省电模式可能禁止常亮，请关闭省电模式' : e.message));
    }
    paint();
  }
  function release() { if (lock) { lock.release().catch(function(){}); lock = null; } }
  btn.addEventListener('click', function () {
    on = !on; localStorage.setItem(KEY, on ? '1' : '0'); push();
    if (on) acquire(true); else { release(); toast('屏幕常亮已关闭'); paint(); }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') acquire(); });
  ['touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function once() { acquire(); }, { passive: true });
  });
  function init() { document.body.appendChild(btn); paint(); acquire(); }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
