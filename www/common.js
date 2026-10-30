/* ===== 公共脚本：inventory / ledger / finance / arrival 共用 ===== */
/* 注意：payroll.html 因 data-vk-skip（文字编辑输入框）特性保留自己的内联键盘抑制版本与 SW 注册，未引用本文件 */
(function () {
    'use strict';

    // Service Worker 注册（等价于原各页面 <head> 内联版本，注册在 load 事件后异步进行，移至 body 底部不影响功能）
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('./sw.js').then(r => console.log('[PWA] SW registered')).catch(e => console.log('[PWA] SW failed', e));
        });
    }

    // 仅在页面提供自制数字键盘时抑制系统键盘；普通页面继续使用系统键盘。
    // 带 data-vk-skip 的输入框(需要系统文字键盘,如备注)不受自制键盘影响
    const isSkipped = (el) => el && el.hasAttribute && el.hasAttribute('data-vk-skip');
    const suppressSystemKeyboard = () => {
        if (!document.getElementById('vk-keypad')) return;
        document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])').forEach(el => {
            if (isSkipped(el)) { if (el.getAttribute('inputmode') === 'none') el.removeAttribute('inputmode'); return; }
            if (el.getAttribute('inputmode') !== 'none') el.setAttribute('inputmode', 'none');
        });
    };
    suppressSystemKeyboard();
    new MutationObserver(suppressSystemKeyboard).observe(document.body, { childList: true, subtree: true });
})();
