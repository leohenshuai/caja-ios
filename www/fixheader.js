/* 页头固定：用 fixed + 占位，避免 body overflow-x:hidden 在 iOS WebView 中使 sticky 失效 */
(function () {
  'use strict';
  function init() {
    var h = document.querySelector('.header');
    if (!h) return;
    var sp = document.createElement('div');
    h.parentNode.insertBefore(sp, h);
    h.style.cssText += ';position:fixed !important;top:0;left:0;right:0;z-index:1000;box-sizing:border-box;background:#0f172a !important;';
    function fit() { sp.style.height = h.offsetHeight + 'px'; }
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(h);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
