/* 统一底栏特效:高光随滚动移动;下滑时收起缩小,上滑/停下恢复;系统键盘弹出时隐藏 */
(function () {
  'use strict';
  var lastY = window.scrollY, tm = 0;
  function bar() { return document.querySelector('.bottom-bar'); }
  window.addEventListener('scroll', function () {
    var b = bar(); if (!b) return;
    var y = window.scrollY, dy = y - lastY, max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    b.style.setProperty('--sx', (10 + 80 * Math.min(1, Math.max(0, y / max))).toFixed(1) + '%');
    b.classList.add('scrolling');
    if (dy > 4 && y > 80 && y < max - 40) b.classList.add('compact'); else if (dy < -2 || y >= max - 40 || y <= 80) b.classList.remove('compact');
    lastY = y;
    clearTimeout(tm); tm = setTimeout(function () { b.classList.remove('scrolling', 'compact'); }, 380);
  }, { passive: true });
  function isField(el) { return el && /^(INPUT|TEXTAREA)$/.test(el.tagName); }
  document.addEventListener('focusin', function (e) { if (isField(e.target)) document.body.classList.add('kb-on'); });
  document.addEventListener('focusout', function () { setTimeout(function () { if (!isField(document.activeElement)) document.body.classList.remove('kb-on'); }, 80); });
})();
