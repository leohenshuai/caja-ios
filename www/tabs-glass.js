/* iOS 26 液态玻璃标签：滑动的玻璃滑块 + 拉伸形变 + 内容切换动效 */
(function () {
  'use strict';
  function setup(bar) {
    if (bar.__glass) return; bar.__glass = true;
    bar.style.position = 'relative';
    var ind = document.createElement('div');
    ind.className = 'glass-ind';
    bar.insertBefore(ind, bar.firstChild);
    var first = true;
    function move(animate) {
      var act = bar.querySelector('.tab.active');
      if (!act) { ind.style.opacity = 0; return; }
      var x = act.offsetLeft, w = act.offsetWidth, y = act.offsetTop, h = act.offsetHeight;
      var prevX = parseFloat(ind.dataset.x || x), dist = Math.abs(x - prevX);
      ind.style.opacity = 1;
      if (!animate || first) {
        ind.style.transition = 'none';
      } else {
        ind.style.transition = 'transform .5s cubic-bezier(.22,1.25,.36,1), width .5s cubic-bezier(.22,1.25,.36,1), height .3s';
        if (dist > 4) { // 移动时先拉伸再回弹，模拟液态
          ind.animate([{ scale: '1 1' }, { scale: '1.12 .88', offset: .35 }, { scale: '1 1' }], { duration: 500, easing: 'ease-out' });
        }
      }
      ind.style.width = w + 'px'; ind.style.height = h + 'px';
      ind.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      ind.dataset.x = x;
      first = false;
      // 把选中标签滚到中间
      var target = x - (bar.clientWidth - w) / 2;
      if (bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: Math.max(0, target), behavior: animate ? 'smooth' : 'auto' });
    }
    new MutationObserver(function () { move(true); }).observe(bar, { attributes: true, subtree: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { move(false); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { move(false); });
    setTimeout(function () { move(false); }, 60);
    setTimeout(function () { move(false); }, 400);
    move(false);
  }
  function init() { document.querySelectorAll('.tabs').forEach(setup); }
  // 内容切换：新显示的页签内容淡入 + 轻微上移 + 去模糊
  function watchContent() {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        var el = m.target;
        if (el.classList && el.classList.contains('tab-content') && el.classList.contains('active')) {
          el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.985)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
            { duration: 420, easing: 'cubic-bezier(.22,1.1,.36,1)' });
        }
      });
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }
  // modalPop:弹窗内容出现时做一次弹性位移/缩放(不改透明度,即使动画不推进也完整可见)
  function modalPop() {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        var el = m.target;
        if (!el.classList || !el.classList.contains('modal') || !el.classList.contains('show')) return;
        if (m.oldValue && /\bshow\b/.test(m.oldValue)) return;
        var c = el.querySelector('.modal-content'); if (!c || !c.animate) return;
        try { c.animate([{ transform: 'translateY(22px) scale(.96)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22,1.2,.36,1)' }); } catch (e) {}
      });
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'], attributeOldValue: true });
  }
  modalPop();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); watchContent(); });
  else { init(); watchContent(); }
})();
