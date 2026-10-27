/* ===== 面值剪贴板：财务 / 现金箱共用 =====
 * 每次“复制面值张数”自动记一条历史；可编辑、置顶、删除，并直接累加/覆盖粘贴。
 * 历史存 localStorage 'caja-clip-history-v1'；被选为“当前”的一条同步写入原单份剪贴板
 * 'caja-denomination-clipboard-v1'，所以页面原有的“累加粘贴”按钮不用改。
 * 粘贴本身仍调用各页面的 app.pasteDenominations(mode)，沿用原有记录/撤销/确认逻辑。 */
(function () {
    'use strict';

    var HIST_KEY = 'caja-clip-history-v1';
    var CUR_KEY = 'caja-denomination-clipboard-v1';
    var MAX = 20; // 不含置顶
    var FACES = [20000, 10000, 2000, 1000, 500, 200, 100, 1];
    // 显示/编辑顺序：与“现金清点”界面一致（财务 CASH_FACES、现金箱 DISPLAY_ORDER 都是这个顺序）
    var SHOW = [200, 100, 500, 1000, 2000, 10000, 20000, 1];

    var ov = null, listEl = null, editState = null, delPending = null;
    var inertEls = [], bodyStyle = null, touchY = 0, lockY = 0, ghostUntil = 0, shield = null, shieldTimer = 0;

    // ---------- 存取 ----------
    function load() {
        try {
            var a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
            return Array.isArray(a) ? a.filter(function (x) { return x && x.byFace; }) : [];
        } catch (e) { return []; }
    }
    function save(list) { try { localStorage.setItem(HIST_KEY, JSON.stringify(list)); } catch (e) { toast('保存失败：浏览器存储不可用', 'error'); } }
    function curStamp() {
        try { var p = JSON.parse(localStorage.getItem(CUR_KEY) || 'null'); return p && p.copiedAt; } catch (e) { return null; }
    }
    function toast(msg, type) { try { if (typeof app !== 'undefined' && app.showToast) app.showToast(msg, type || 'success'); } catch (e) {} }

    // ---------- 工具 ----------
    function norm(byFace) { var o = {}; FACES.forEach(function (f) { o[f] = Math.max(0, parseInt(byFace && byFace[f], 10) || 0); }); return o; }
    function total(b) { return FACES.reduce(function (s, f) { return s + f * (b[f] || 0); }, 0); }
    function fmt(n) { return Number(n).toLocaleString('en-US'); }
    function same(a, b) { return FACES.every(function (f) { return (a[f] || 0) === (b[f] || 0); }); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function stamp(ms) { var d = new Date(ms); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function trim(list) {
        var n = list.filter(function (x) { return !x.pinned; }).length;
        for (var i = list.length - 1; i >= 0 && n > MAX; i--) { if (!list[i].pinned) { list.splice(i, 1); n--; } }
    }
    function isCur(it) { return it.copiedAt && curStamp() === it.copiedAt; }
    function setCurrent(it) {
        try {
            localStorage.setItem(CUR_KEY, JSON.stringify({
                version: 1, type: 'denomination-counts',
                source: it.source + (it.edited ? '（已编辑）' : ''), copiedAt: it.copiedAt, byFace: norm(it.byFace)
            }));
        } catch (e) { toast('写入失败：浏览器存储不可用', 'error'); }
    }

    // ---------- 记录（由页面的复制动作调用）----------
    function record(p) {
        try {
            if (!p || !p.byFace) return;
            var by = norm(p.byFace);
            if (!FACES.some(function (f) { return by[f] > 0; })) return;
            var list = load();
            var top = list.length ? list[0] : null;
            if (top && same(top.byFace, by)) {
                top.copiedAt = p.copiedAt || Date.now(); top.source = p.source || top.source;
            } else {
                list.unshift({ id: newId(), source: p.source || '未知来源', copiedAt: p.copiedAt || Date.now(), byFace: by, orig: Object.assign({}, by), note: '', pinned: false, edited: false });
                trim(list);
            }
            save(list); badge(); renderList();
        } catch (e) {}
    }

    function badge() {
        var n = load().length;
        [].forEach.call(document.querySelectorAll('[data-clip-count]'), function (s) { s.textContent = n; s.style.display = n ? '' : 'none'; });
    }

    // ---------- 样式与骨架 ----------
    function injectCss() {
        if (document.getElementById('cajaClipCss')) return;
        var s = document.createElement('style'); s.id = 'cajaClipCss';
        s.textContent =
            '.clip-badge{display:inline-block;min-width:18px;padding:0 5px;margin-left:4px;border-radius:999px;background:var(--yellow,#f59e0b);color:#1a1200;font-size:11px;font-weight:700;line-height:18px;text-align:center}' +
            '.modal-content.clip-box{background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:14px;padding:14px;width:min(94vw,480px);max-height:86vh;overflow:hidden;display:flex;flex-direction:column;color:var(--text,#f1f5f9);text-align:left}' +
            '.clip-box #clipListView{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
            '.clip-box #clipEditView{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}' +
            '.clip-escroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}' +
            '.clip-box [hidden]{display:none!important}' +
            '.clip-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}.clip-h b{font-size:16px}.clip-h button{margin-left:auto;padding:6px 12px}' +
            '.clip-sub{font-size:12px;color:var(--text-muted,#94a3b8)}' +
            '.clip-list{display:flex;flex-direction:column;gap:8px;margin-top:8px}' +
            '.clip-empty{padding:26px 8px;text-align:center;color:var(--text-muted,#94a3b8);font-size:13px;line-height:1.7}' +
            '.clip-item{background:var(--bg,#0f172a);border:1px solid var(--border,#334155);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}' +
            '.clip-item.is-cur{border-color:var(--cyan,#06b6d4);box-shadow:0 0 0 1px var(--cyan,#06b6d4) inset}' +
            '.clip-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.clip-meta{min-width:0}' +
            '.clip-src{font-weight:700;font-size:13px;overflow-wrap:anywhere}' +
            '.clip-time{font-size:11.5px;color:var(--text-muted,#94a3b8);overflow-wrap:anywhere}' +
            '.clip-tag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;vertical-align:1px}' +
            '.clip-tag.cur{background:var(--cyan,#06b6d4);color:#fff}.clip-tag.ed{background:rgba(245,158,11,.18);color:var(--yellow,#f59e0b)}' +
            '.clip-total{font-weight:700;font-size:15px;color:var(--cyan,#06b6d4);white-space:nowrap;font-variant-numeric:tabular-nums}' +
            '.clip-chips{display:flex;flex-wrap:wrap;gap:4px}' +
            '.clip-chip{font-size:12px;padding:1px 7px;border-radius:5px;border:1px solid var(--border,#334155);background:var(--surface,#1e293b);font-variant-numeric:tabular-nums}' +
            '.clip-chip.chg{border-color:var(--yellow,#f59e0b);color:var(--yellow,#f59e0b)}' +
            '.clip-acts{display:flex;flex-wrap:wrap;gap:6px}.clip-acts button{padding:6px 11px;font-size:12.5px;min-height:0}' +
            '.clip-foot{margin-top:10px;font-size:11.5px;color:var(--text-muted,#94a3b8);line-height:1.6}' +
            '.clip-egrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px;margin-bottom:12px}' +
            '.clip-erow{background:var(--bg,#0f172a);border:1px solid var(--border,#334155);border-radius:6px;padding:4px;position:relative;transition:all .2s;min-width:0}' +
            '.clip-erow:focus-within{border-color:var(--cyan,#06b6d4);box-shadow:0 0 0 2px rgba(6,182,212,.2)}' +
            '.clip-erow.chg{border-color:var(--yellow,#f59e0b)}' +
            '.clip-erow label{display:block;font-size:10px;color:var(--text-muted,#94a3b8);margin-bottom:2px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.clip-erow input{width:100%;background:transparent;border:none;color:var(--text,#f1f5f9);font-size:15px;font-weight:700;text-align:center;padding:2px;font-family:\'Courier New\',monospace;height:26px}' +
            '.clip-erow input:focus{outline:none}' +
            '.clip-note{margin-top:10px;width:100%;background:var(--bg,#0f172a);border:1px solid var(--border,#334155);border-radius:8px;color:var(--text,#f1f5f9);padding:8px 10px;font-size:13px}' +
            '.clip-sum{margin-top:10px;padding:10px 12px;background:var(--bg,#0f172a);border-radius:8px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}' +
            '.clip-sum small{display:block;color:var(--text-muted,#94a3b8);font-size:11.5px}' +
            '.clip-sum .big{font-size:19px;font-weight:700;color:var(--cyan,#06b6d4);font-variant-numeric:tabular-nums;text-align:right}' +
            '.clip-sum .dl{font-size:12px;color:var(--yellow,#f59e0b);text-align:right;font-variant-numeric:tabular-nums}' +
            '#cajaClipOv{z-index:3000;overscroll-behavior:contain}' +
            '#cajaClipShield{position:fixed;inset:0;z-index:2999;background:transparent}' +
            '.toast{pointer-events:none}' +
            'body.vk-open #cajaClipOv{align-items:flex-start;padding-top:8px}' +
            'body.vk-open #cajaClipOv .clip-box{max-height:calc(100vh - var(--vk-h, 460px) - 16px);max-height:calc(100dvh - var(--vk-h, 460px) - 16px)}' +
                        '#cajaClipOv .clip-box input{touch-action:manipulation}' +
            'html.caja-clip-lock,html.caja-clip-lock body{overflow:hidden!important}' +
            '.clip-efoot{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;padding:0}.clip-efoot button{padding:10px 6px}.clip-efoot .full{grid-column:1/-1}';
        document.head.appendChild(s);
    }

    function build() {
        if (ov) return;
        injectCss();
        ov = document.createElement('div');
        ov.className = 'modal'; ov.id = 'cajaClipOv';
        ov.innerHTML =
            '<div class="modal-content clip-box">' +
            '<div id="clipListView">' +
            '<div class="clip-h"><b>🗂 面值剪贴板</b><span class="clip-sub" id="clipSub"></span><button type="button" data-act="close">关闭</button></div>' +
            '<div class="clip-list" id="clipList"></div>' +
            '<div class="clip-foot">每次点“复制”会自动记录，最多保留 20 条（置顶的不计）。“累加”直接粘贴到当前界面；“设为当前”后，页面上的“累加粘贴”按钮会使用这一条。<br><span style="opacity:.6">版本 v4</span></div>' +
            '</div>' +
            '<div id="clipEditView" hidden>' +
            '<div class="clip-escroll">' +
            '<div class="clip-h"><b>✏️ 编辑剪贴内容</b></div>' +
            '<div class="clip-sub" id="clipEditSrc"></div>' +
            '<div class="clip-egrid" id="clipEgrid"></div>' +
            '<input class="clip-note" id="clipNote" type="text" maxlength="30" placeholder="备注（可不填，如：早班）" autocomplete="off">' +
            '<div class="clip-sum"><div><small>修改前合计 <span id="clipOrig"></span></small><small>修改后合计</small></div><div><div class="dl" id="clipDelta"></div><div class="big" id="clipNew"></div></div></div>' +
            '</div>' +
            '<div class="clip-efoot">' +
            '<button type="button" data-act="e-reset">↺ 还原为首次复制</button>' +
            '<button type="button" data-act="e-saveas">另存为新条目</button>' +
            '<button type="button" data-act="e-cancel">取消</button>' +
            '<button type="button" class="success" data-act="e-save">💾 保存修改</button>' +
            '</div></div></div>';
        document.body.appendChild(ov);
        listEl = ov.querySelector('#clipList');
        ov.addEventListener('click', onClick);
        // 编辑输入：只保留数字
        ov.addEventListener('input', function (e) {
            var t = e.target; if (!editState || !t.dataset || !t.dataset.face) return;
            editState.work[t.dataset.face] = Math.max(0, parseInt(String(t.value).replace(/\D/g, ''), 10) || 0);
            updEdit(true);
        });
        ov.addEventListener('focusout', function () { if (editState) updEdit(false); });
        // 自制键盘弹出后，只在弹窗内部滚动，把输入框露出来（底层页面已锁定不动）
        ov.addEventListener('focusin', function (e) {
            var t = e.target; if (!t || t.tagName !== 'INPUT') return;
            if (t.dataset && t.dataset.face) { try { t.select(); } catch (_) {} } // 直接输入即替换原张数
            setTimeout(function () {
                try {
                    var box = ov.querySelector('.clip-escroll'), kp = document.getElementById('vk-keypad');
                    var bottom = (kp && kp.classList.contains('vk-show')) ? Math.min(box.getBoundingClientRect().bottom, kp.getBoundingClientRect().top) : box.getBoundingClientRect().bottom;
                    var r = t.getBoundingClientRect(), top = box.getBoundingClientRect().top;
                    if (!box) return;
                    if (r.bottom > bottom - 8) box.scrollTop += r.bottom - bottom + 8;
                    else if (r.top < top + 8) box.scrollTop -= top + 8 - r.top;
                } catch (_) {}
            }, 300);
        });
    }

    // ---------- 列表 ----------
    function hideKeypad() {
        // 离开编辑态/关闭弹窗时收起自制键盘，避免它继续浮在上面接管按键
        try {
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            var kp = document.getElementById('vk-keypad');
            if (kp) kp.classList.remove('vk-show');
            document.body.classList.remove('vk-open');
        } catch (e) {}
    }
    function view(name) {
        if (name !== 'edit') hideKeypad();
        ov.querySelector('#clipListView').hidden = name !== 'list';
        ov.querySelector('#clipEditView').hidden = name !== 'edit';
    }
    function renderList() {
        if (!ov || ov.querySelector('#clipListView').hidden) return;
        var list = load().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0); });
        ov.querySelector('#clipSub').textContent = list.length ? '共 ' + list.length + ' 条' : '';
        if (!list.length) { listEl.innerHTML = '<div class="clip-empty">还没有复制记录。<br>在清点界面点“复制”后，会自动出现在这里。</div>'; return; }
        var cs = curStamp();
        listEl.innerHTML = list.map(function (it) {
            var cur = it.copiedAt && cs === it.copiedAt, orig = it.orig || it.byFace;
            var chips = SHOW.filter(function (f) { return it.byFace[f] > 0 || (it.edited && orig[f] > 0); }).map(function (f) {
                return '<span class="clip-chip' + (it.edited && it.byFace[f] !== orig[f] ? ' chg' : '') + '">' + fmt(f) + '×' + (it.byFace[f] || 0) + '</span>';
            }).join('');
            return '<div class="clip-item' + (cur ? ' is-cur' : '') + '" data-id="' + esc(it.id) + '">' +
                '<div class="clip-top"><div class="clip-meta"><div class="clip-src">' + (it.pinned ? '📌 ' : '') + esc(it.source) +
                (it.edited ? '<span class="clip-tag ed">已编辑</span>' : '') + (cur ? '<span class="clip-tag cur">当前</span>' : '') + '</div>' +
                '<div class="clip-time">' + stamp(it.copiedAt) + (it.note ? ' · ' + esc(it.note) : '') + '</div></div>' +
                '<div class="clip-total">' + fmt(total(it.byFace)) + '</div></div>' +
                '<div class="clip-chips">' + chips + '</div>' +
                '<div class="clip-acts">' +
                '<button type="button" class="primary" data-act="add">累加</button>' +
                (cur ? '' : '<button type="button" data-act="cur">设为当前</button>') +
                '<button type="button" data-act="edit">编辑</button>' +
                '<button type="button" data-act="pin">' + (it.pinned ? '取消置顶' : '置顶') + '</button>' +
                (delPending === it.id ? '<button type="button" class="danger" data-act="del">确认删除</button>' : '<button type="button" data-act="del">删除</button>') +
                '</div></div>';
        }).join('');
    }

    function onClick(e) {
        if (e.target === ov) { close(); return; }
        var b = e.target.closest('button[data-act]'); if (!b) return;
        var act = b.dataset.act;
        if (act === 'close') { close(); return; }
        if (act.indexOf('e-') === 0) { editAct(act); return; }
        var row = b.closest('.clip-item'); if (!row) return;
        var list = load(), it = find(list, row.dataset.id); if (!it) { renderList(); return; }
        if (act !== 'del') delPending = null;
        if (act === 'add') {
            setCurrent(it); close();
            if (typeof app !== 'undefined' && app.pasteDenominations) app.pasteDenominations();
        } else if (act === 'cur') { setCurrent(it); renderList(); toast('已设为当前，“累加粘贴”按钮将使用这一条'); }
        else if (act === 'pin') { it.pinned = !it.pinned; trim(list); save(list); renderList(); badge(); }
        else if (act === 'edit') openEdit(it);
        else if (act === 'del') {
            if (delPending === it.id) { save(list.filter(function (x) { return x.id !== it.id; })); delPending = null; badge(); }
            else delPending = it.id;
            renderList();
        }
    }

    // ---------- 编辑 ----------
    function openEdit(it) {
        editState = { id: it.id, work: norm(it.byFace) };
        ov.querySelector('#clipEditSrc').textContent = '来源：' + it.source + ' · ' + stamp(it.copiedAt);
        ov.querySelector('#clipNote').value = it.note || '';
        ov.querySelector('#clipOrig').textContent = fmt(total(it.byFace));
        ov.querySelector('#clipEgrid').innerHTML = SHOW.map(function (f) {
            return '<div class="clip-erow" id="clipRow' + f + '"><label for="clipIn' + f + '">' + fmt(f) + '</label>' +
                '<input id="clipIn' + f + '" data-face="' + f + '" type="text" inputmode="numeric" autocomplete="off" value="' + editState.work[f] + '"></div>';
        }).join('');
        view('edit'); updEdit(false);
    }
    function updEdit(typing) {
        if (!editState) return;
        var it = find(load(), editState.id); if (!it) return;
        FACES.forEach(function (f) {
            var inp = ov.querySelector('#clipIn' + f);
            if (inp && !(typing && document.activeElement === inp)) inp.value = editState.work[f];
            var row = ov.querySelector('#clipRow' + f); if (row) row.classList.toggle('chg', editState.work[f] !== (it.byFace[f] || 0));
        });
        var t = total(editState.work), d = t - total(it.byFace);
        ov.querySelector('#clipNew').textContent = fmt(t);
        ov.querySelector('#clipDelta').textContent = d === 0 ? '无改动' : (d > 0 ? '+' : '−') + fmt(Math.abs(d));
    }
    function editAct(act) {
        if (!editState) return;
        var list = load(), it = find(list, editState.id);
        if (!it) { editState = null; view('list'); renderList(); return; }
        if (act === 'e-cancel') { editState = null; view('list'); renderList(); return; }
        if (act === 'e-reset') { editState.work = norm(it.orig || it.byFace); updEdit(false); return; }
        var note = ov.querySelector('#clipNote').value.trim();
        if (act === 'e-save') {
            it.byFace = norm(editState.work); delete it.trimBak; it.note = note; it.edited = !same(it.byFace, it.orig || it.byFace);
            save(list); if (isCur(it)) setCurrent(it);
            toast('已保存修改');
        } else if (act === 'e-saveas') {
            var n = { id: newId(), source: it.source, copiedAt: Date.now(), byFace: norm(editState.work), orig: Object.assign({}, it.orig || it.byFace), note: note, pinned: false, edited: true };
            n.edited = !same(n.byFace, n.orig);
            list.unshift(n); trim(list); save(list); toast('已另存为新条目');
        }
        editState = null; delPending = null; view('list'); renderList(); badge();
    }
    // ---------- 打开 / 关闭 ----------
    function open() {
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
        build(); attachGuards(); editState = null; delPending = null; view('list');
        ov.classList.add('show'); lock(); renderList();
    }
    function close() {
        if (!ov) return;
        try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
        ov.classList.remove('show'); editState = null; delPending = null;
        hideKeypad(); unlock(); raiseShield();
    }

    // 关闭后，移动端浏览器可能在 300ms 后才把这次触摸补成一组鼠标事件（“幽灵点击”），
    // 落到底层界面上。这里用一层透明挡板实地挡住，不只靠 JS 判断。
    function raiseShield() {
        ghostUntil = Date.now() + 700;
        if (!shield) { shield = document.createElement('div'); shield.id = 'cajaClipShield'; }
        if (!shield.parentNode) document.body.appendChild(shield);
        clearTimeout(shieldTimer);
        shieldTimer = setTimeout(function () { if (shield && shield.parentNode) shield.parentNode.removeChild(shield); detachGuards(); }, 700);
    }

    // ---------- 防穿透：弹窗打开期间，底层界面不接收任何点击/触摸/焦点，也不滚动 ----------
    function isShown() { return !!(ov && ov.classList.contains('show')); }
    function allowed(t) {
        // 弹窗本身、自制数字键盘（编辑张数要用）、toast 提示放行
        return !!(t && t.closest && (ov.contains(t) || t.closest('#vk-keypad') || t.closest('.toast')));
    }
    function lock() {
        if (document.documentElement.classList.contains('caja-clip-lock')) return;
        lockY = window.scrollY || window.pageYOffset || 0;
        document.documentElement.classList.add('caja-clip-lock');
        // 固定 body（iOS 上 overflow:hidden 锁不住底层滚动，必须 position:fixed）
        var bs = document.body.style;
        bodyStyle = { position: bs.position, top: bs.top, left: bs.left, right: bs.right, width: bs.width };
        bs.position = 'fixed'; bs.top = (-lockY) + 'px'; bs.left = '0'; bs.right = '0'; bs.width = '100%';
        inertEls = [];
        [].forEach.call(document.body.children, function (el) {
            if (el === ov || el.id === 'vk-keypad' || el.classList.contains('toast') || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
            if (el.hasAttribute('inert')) return;
            el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); inertEls.push(el);
        });
    }
    function unlock() {
        inertEls.forEach(function (el) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); });
        inertEls = [];
        document.documentElement.classList.remove('caja-clip-lock');
        if (bodyStyle) {
            var bs = document.body.style;
            bs.position = bodyStyle.position; bs.top = bodyStyle.top; bs.left = bodyStyle.left; bs.right = bodyStyle.right; bs.width = bodyStyle.width;
            bodyStyle = null;
            window.scrollTo(0, lockY);
        }
    }
    function guard(e) {
        if (!ov) return;
        if (isShown()) {
            if (allowed(e.target)) return;
        } else if (Date.now() >= ghostUntil || allowed(e.target)) {
            return; // 关闭 700ms 之后恢复正常；挡板与键盘上的操作不拦
        }
        e.stopPropagation(); if (e.cancelable) e.preventDefault();
    }
    // 拦截类监听只在弹窗开着时挂上：document 上的非 passive touchstart/touchmove
    // 会让 WebKit 放弃滚动快速通道（每次滚动起手都要等主线程），常驻不值得。
    var GUARD_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'contextmenu'];
    var guardsOn = false;
    function onKeyDown(e) {
        if (!isShown()) return;
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (editState) editAct('e-cancel'); else close(); }
        else if (!allowed(e.target)) e.stopPropagation(); // 底层页面的快捷键不响应
    }
    function attachGuards() {
        if (guardsOn) return; guardsOn = true;
        GUARD_EVENTS.forEach(function (t) { document.addEventListener(t, guard, { capture: true, passive: false }); });
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
        document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    }
    function detachGuards() {
        if (!guardsOn) return; guardsOn = false;
        GUARD_EVENTS.forEach(function (t) { document.removeEventListener(t, guard, { capture: true }); });
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('touchstart', onTouchStart, { capture: true });
        document.removeEventListener('touchmove', onTouchMove, { capture: true });
        document.removeEventListener('wheel', onWheel, { capture: true });
    }
    // ---------- 防滑动穿透：弹窗里的任何滑动都不能带动底层界面 ----------
    // 找到手指所在位置向上最近的“真的能滚动”的容器（只在弹窗内找）
    function scroller(t) {
        while (t && t !== document.body && t.nodeType === 1) {
            if (ov.contains(t) && t !== ov) {
                var oy = getComputedStyle(t).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && t.scrollHeight > t.clientHeight + 1) return t;
            }
            t = t.parentNode;
        }
        return null;
    }
    // dy>0：内容要往上走（手指向下拉 / 滚轮向上）；dy<0：反之
    function canScroll(sc, dy) {
        if (!sc) return false;
        if (dy > 0) return sc.scrollTop > 0;
        if (dy < 0) return sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1;
        return true;
    }
    function onTouchStart(e) {
        if (isShown() && e.touches.length) touchY = e.touches[0].clientY;
    }
    function onTouchMove(e) {
        if (!isShown()) return;
        if (e.target.closest && e.target.closest('#vk-keypad')) { if (!e.target.closest('input[type=range]')) e.preventDefault(); return; }
        var dy = e.touches[0].clientY - touchY;
        if (!ov.contains(e.target) || !canScroll(scroller(e.target), dy)) {
            if (e.cancelable) e.preventDefault(); // 容器已滑到头 / 在空白处 / 在弹窗外：一律吃掉，不让它滚到底层
        }
        touchY = e.touches[0].clientY;
    }
    function onWheel(e) {
        if (!isShown()) return;
        if (!ov.contains(e.target) || !canScroll(scroller(e.target), -e.deltaY)) {
            if (e.cancelable) e.preventDefault();
        }
    }

    // 另一个页面/标签页复制后，自动刷新角标与列表
    window.addEventListener('storage', function (e) {
        if (e.key === HIST_KEY || e.key === CUR_KEY) { badge(); if (ov && ov.classList.contains('show') && !editState) renderList(); }
    });
    badge(); document.addEventListener('DOMContentLoaded', badge);

    window.CajaClip = { open: open, close: close, record: record };
})();
