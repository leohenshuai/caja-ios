/* 页头固定：用 fixed + 占位，避免 body overflow-x:hidden 在 iOS WebView 中使 sticky 失效。
   页签栏(.tabs)紧随页头一起吸顶，否则滚动时会被固定的页头盖住。 */
(function () {
  'use strict';
  function init() {
    var h = document.querySelector('.header');
    if (!h) return;
    var sp = document.createElement('div');
    h.parentNode.insertBefore(sp, h);
    var solidBackground = document.body.hasAttribute('data-translucent-nav') ? '' : 'background:#0f172a !important;';
    h.style.cssText += ';position:fixed !important;top:0;left:0;right:0;z-index:1000;box-sizing:border-box;' + solidBackground;

    // 页签栏也固定在页头正下方，并用占位撑开原本的高度
    var t = document.querySelector('.tabs');
    var tsp = null;
    if (t) {
      tsp = document.createElement('div');
      t.parentNode.insertBefore(tsp, t);
      t.style.cssText += ';position:fixed !important;left:0;right:0;z-index:999;box-sizing:border-box;' +
        'margin:0 !important;padding:6px 12px 8px !important;' + solidBackground +
        'border-bottom:1px solid rgba(148,163,184,.18);';
    }

    function fit() {
      var hh = h.offsetHeight;
      sp.style.height = hh + 'px';
      if (t && tsp) {
        t.style.top = hh + 'px';
        tsp.style.height = t.offsetHeight + 'px';
      }
    }
    fit();
    // 字体/布局稳定后再量一次，避免首帧高度偏小
    setTimeout(fit, 80);
    setTimeout(fit, 400);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    if (window.ResizeObserver) {
      new ResizeObserver(fit).observe(h);
      if (t) new ResizeObserver(fit).observe(t);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
