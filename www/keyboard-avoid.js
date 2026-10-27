/* 输入框避让键盘:聚焦的输入框始终保持在键盘(自制键盘或系统键盘)上方,不被遮挡。
   做法:算出"可见区底边",不够就滚动容器(页面或弹窗),并在键盘高度变化时重算。 */
(function () {
  'use strict';
  var MARGIN = 14;                                   // 输入框底边与键盘之间留的空隙
  var active = null, timer = null;

  function isField(el) {
    return el && el.tagName && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|range|color|hidden)$/.test(el.type)));
  }
  function keypadTop() {                             // 自制键盘顶边(未显示返回 Infinity)
    var kp = document.getElementById('vk-keypad');
    if (!kp) return Infinity;
    var cs = getComputedStyle(kp);
    if (cs.display === 'none' || cs.visibility === 'hidden') return Infinity;
    var r = kp.getBoundingClientRect();
    return r.height > 0 ? r.top : Infinity;
  }
  function bottomBarTop() {                          // 悬浮底部操作栏顶边(输入框也不该被它挡)
    var b = document.querySelector('.bottom-bar');
    if (!b || getComputedStyle(b).display === 'none') return Infinity;
    var r = b.getBoundingClientRect();
    return r.height > 0 ? r.top : Infinity;
  }
  function visibleBottom() {
    var vv = window.visualViewport;
    var sys = vv ? vv.offsetTop + vv.height : window.innerHeight;    // 系统键盘弹出时 visualViewport 会变矮
    var kp = keypadTop();
    // 自制键盘显示时,以键盘顶边为准;否则以系统可见区为准。底部栏在键盘显示时通常被盖住,不参与计算
    return Math.min(sys, kp) - MARGIN;
  }
  function visibleTop() {
    var h = document.querySelector('.header');
    var hb = h ? h.getBoundingClientRect().bottom : 0;
    var vv = window.visualViewport;
    return Math.max(hb, vv ? vv.offsetTop : 0) + 8;
  }
  function scrollParent(el) {                        // 最近的可滚动祖先(弹窗里的输入框要滚弹窗内容)
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 2) return p;
    }
    return null;
  }
  function reveal(el, smooth) {
    if (!el || !document.contains(el)) return;
    var vb = visibleBottom(), vt = visibleTop();
    var r = el.getBoundingClientRect(), dy = 0;
    if (r.bottom > vb) dy = r.bottom - vb;
    else if (r.top < vt) dy = r.top - vt;
    if (!dy) return;
    var sp = scrollParent(el);
    var beh = smooth ? 'smooth' : 'auto';
    if (sp) {
      var before = sp.scrollTop;
      sp.scrollBy({ top: dy, behavior: beh });
      // 弹窗内容已滚到头仍不够时,再滚页面兜底
      setTimeout(function () {
        var r2 = el.getBoundingClientRect();
        if (r2.bottom > visibleBottom() + 1) window.scrollBy({ top: r2.bottom - visibleBottom(), behavior: beh });
      }, smooth ? 260 : 30);
    } else {
      window.scrollBy({ top: dy, behavior: beh });
    }
  }
  // 页面底部留白:保证最下面的输入框也有地方可滚出来
  // --kb-room 会改 body 的 padding-bottom = 整页重排(实测 6~7ms),所以值没变时不写
  var lastRoom = -1;
  function setRoom(need) {
    if (need === lastRoom) return;
    lastRoom = need;
    document.documentElement.style.setProperty('--kb-room', need + 'px');
  }
  function ensureRoom() {
    var kp = keypadTop(), need = 0;
    if (kp !== Infinity) need = Math.max(0, window.innerHeight - kp) + 24;
    else if (window.visualViewport) need = Math.max(0, window.innerHeight - (window.visualViewport.offsetTop + window.visualViewport.height)) + 24;
    setRoom(need);
  }
  function schedule(el, smooth) {
    clearTimeout(timer);
    ensureRoom();
    // 分几次重算:键盘动画、vk-open 内边距生效、弹窗重排都有延迟
    [30, 180, 420].forEach(function (d, i) {
      setTimeout(function () { if (active === el) { ensureRoom(); reveal(el, smooth && i === 0 ? true : false); } }, d);
    });
  }

  document.addEventListener('focusin', function (e) {
    if (!isField(e.target)) return;
    active = e.target; schedule(active, true);
  }, true);
  document.addEventListener('focusout', function () {
    setTimeout(function () { if (!isField(document.activeElement)) { active = null; setRoom(0); } }, 80);
  }, true);
  if (window.visualViewport) {
    ['resize', 'scroll'].forEach(function (ev) {
      window.visualViewport.addEventListener(ev, function () { if (active) { ensureRoom(); reveal(active, false); } });
    });
  }
  window.addEventListener('orientationchange', function () { if (active) schedule(active, false); });
  // 自制键盘的显示/隐藏、高度变化(vk-show / vk-open)
  new MutationObserver(function () { if (active) schedule(active, false); })
    .observe(document.body, { attributes: true, attributeFilter: ['class'] });
  var kp = document.getElementById('vk-keypad');
  if (kp) {
    new MutationObserver(function () { if (active) schedule(active, false); }).observe(kp, { attributes: true, attributeFilter: ['class', 'style'] });
    if (window.ResizeObserver) new ResizeObserver(function () { if (active) { ensureRoom(); reveal(active, false); } }).observe(kp);
  }
  // 输入内容换行/展开导致输入框下移时也跟随
  document.addEventListener('input', function (e) { if (e.target === active) reveal(active, false); }, true);
})();
