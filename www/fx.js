// ============ 共享特效（已精简：移除会持续占用 CPU/GPU 导致卡顿的部分） ============
// 移除内容说明（原因：持续运行、每帧计算、或全局高频触发，属于无实际业务价值的“炫技”特效）：
//  - 粒子连线画布（每帧 O(n^2) 距离计算，永久运行）
//  - 鼠标聚光灯跟随（永久 requestAnimationFrame 循环）
//  - 极光光晕（filter: blur 持续动画 + 全局 mousemove 视差监听）
//  - 随机流星（永久 setTimeout/rAF 循环）
//  - 全局点击粒子爆散（每次点击都创建/动画多个节点，录入数据时高频点击会明显卡顿）
//  - 数字变化闪烁的 MutationObserver（subtree+characterData 监听 + 强制同步重排 offsetWidth，
//    实时监控页面数值频繁更新时会造成明显卡顿）
//  - 双击彩带彩蛋 / 点击标题钞票雨 / 长按彩虹边框：纯装饰彩蛋，无业务价值
// 保留内容（低成本、一次性或仅在用户交互瞬间触发）：
//  - 卡片悬停光泽扫过、按钮悬停/按下反馈（纯 CSS，见 fx.css）
//  - 按钮按下水波纹（pointerdown 触发，短生命周期）
//  - 滚动入场渐显（IntersectionObserver，进入视口后立即 unobserve，不持续运行）
//  - 时段问候语（一次性文本，无动画循环）
//  - 网络在线/离线状态栏闪烁提示（仅在状态真正变化时触发一次，属于功能性提示）
(function () {
    // 按钮水波纹
    document.addEventListener('pointerdown', e => {
        const btn = e.target.closest && e.target.closest('button');
        if (!btn) return;
        const rect = btn.getBoundingClientRect();
        const r = document.createElement('span');
        r.className = 'fx-btn-ripple';
        const size = Math.max(rect.width, rect.height);
        r.style.width = r.style.height = size + 'px';
        r.style.left = (e.clientX - rect.left - size / 2) + 'px';
        r.style.top = (e.clientY - rect.top - size / 2) + 'px';
        btn.appendChild(r);
        setTimeout(() => r.remove(), 550);
    }, true);

    // 滚动入场渐显：给主要卡片/区块打上标记，进入视口时浮现一次
    const revealEls = document.querySelectorAll('.metric-card, .caja-card, .staff-card, .card, .info-section, table, .arrival-page .stat, .arrival-page .panel, .arrival-page .day-group');
    revealEls.forEach(el => el.classList.add('fx-reveal'));
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    en.target.classList.add('fx-shown');
                    io.unobserve(en.target);
                }
            });
        }, { threshold: 0.08 });
        revealEls.forEach(el => io.observe(el));
    } else {
        revealEls.forEach(el => el.classList.add('fx-shown'));
    }

    // 兜底：IntersectionObserver 不触发时（后台标签/预览环境），1.2s 后强制显示，避免内容一直透明
    setTimeout(() => revealEls.forEach(el => el.classList.add('fx-shown')), 1200);

    // 时段问候语（插入页面顶部，一次性）
    const hour = new Date().getHours();
    let greet;
    if (hour < 6) greet = '夜深了，清点完早点休息 🌙';
    else if (hour < 11) greet = '早上好，开门大吉 ☀️';
    else if (hour < 14) greet = '中午好，忙完记得吃饭 🍚';
    else if (hour < 19) greet = '下午好，生意兴隆 📈';
    else greet = '晚上好，今日辛苦了 🌆';
    const g = document.createElement('div');
    g.className = 'fx-greeting';
    g.textContent = greet;
    document.body.prepend(g);

    // 在线/离线状态切换时闪一下状态栏（功能性提示，仅在状态真正变化时触发一次）
    window.addEventListener('online', () => flashStatus());
    window.addEventListener('offline', () => flashStatus());
    function flashStatus() {
        const bar = document.getElementById('statusBar');
        if (!bar) return;
        bar.classList.remove('fx-status-flash');
        void bar.offsetWidth;
        bar.classList.add('fx-status-flash');
    }
})();
