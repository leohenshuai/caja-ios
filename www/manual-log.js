/* 手动记录小组件:点按钮记录当前数值,带时间保存;按条数或天数自动删除旧记录。
   ManualLog.mount({ el, key, title, btn, getValue, maxCount, maxDays, color }) */
(function () {
  'use strict';
  var css = '.mlog{background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;padding:12px;margin:12px 0}'
    + '.mlog-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}'
    + '.mlog-t{font-size:14px;font-weight:700}.mlog-t small{font-weight:400;font-size:11px;color:var(--text-muted,#94a3b8);margin-left:6px}'
    + '.mlog-b{font:inherit;font-size:13px;padding:8px 12px;border-radius:10px;border:1px solid #22d3ee;background:rgba(6,182,212,.15);color:#67e8f9;min-height:36px}'
    + '.mlog-r{display:flex;align-items:center;gap:10px;padding:8px 2px;border-top:1px solid var(--border,#334155);font-size:13px}'
    + '.mlog-d{color:var(--text-muted,#94a3b8);font-size:12px;min-width:92px}.mlog-v{margin-left:auto;font-weight:700;font-family:"Courier New",monospace;font-size:15px}'
    + '.mlog-x{font:inherit;font-size:12px;border:none;background:none;color:var(--text-muted,#94a3b8);padding:4px 6px}'
    + '.mlog-e{font-size:12px;color:var(--text-muted,#94a3b8);padding:6px 2px}'
    + '.mlog-i{border-top:1px solid var(--border,#334155);padding:8px 2px}.mlog-i .mlog-r{border-top:none;padding:0}'
    + '.mlog-n{display:block;width:100%;text-align:left;font:inherit;font-size:12px;line-height:1.45;margin-top:6px;padding:6px 8px;border-radius:8px;border:1px dashed var(--border,#334155);background:rgba(255,255,255,.03);color:var(--text,#e5e7eb);white-space:pre-wrap;word-break:break-word}'
    + '.mlog-n.empty{color:var(--text-muted,#94a3b8)}';
  var esc = function (t) { return String(t).replace(/[&<>"\']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var p2 = function (n) { return String(n).padStart(2, '0'); };
  function load(k) { try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v.filter(function (x) { return x && Number.isFinite(x.t) && Number.isFinite(x.v); }) : []; } catch (e) { return []; } }
  function trim(list, o) {
    if (o.maxDays) { var cut = Date.now() - o.maxDays * 86400000; list = list.filter(function (x) { return x.t >= cut; }); }
    if (o.maxCount) list = list.slice(-o.maxCount);
    return list;
  }
  window.ManualLog = {
    mount: function (o) {
      var box = o.el; if (!box) return;
      box.className = 'mlog';
      function save(l) { try { localStorage.setItem(o.key, JSON.stringify(l)); } catch (e) {} }
      function render() {
        var list = trim(load(o.key), o); save(list);
        var rows = list.slice().reverse().map(function (x) {
          var d = new Date(x.t), col = o.color ? o.color(x.v) : '';
          var note = x.n ? String(x.n) : '';
          return '<div class="mlog-i"><div class="mlog-r"><span class="mlog-d">' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + '</span>'
            + '<span class="mlog-v"' + (col ? ' style="color:' + col + '"' : '') + '>' + Math.round(x.v).toLocaleString('en-US') + '</span>'
            + '<button type="button" class="mlog-x" data-del="' + x.t + '">删除</button></div>'
            + (o.notes ? '<button type="button" class="mlog-n' + (note ? '' : ' empty') + '" data-note="' + x.t + '">' + (note ? '📝 ' + esc(note) : '＋ 添加备注') + '</button>' : '')
            + '</div>';
        }).join('');
        box.innerHTML = '<div class="mlog-h"><span class="mlog-t">' + o.title + '<small>' + (o.maxCount ? '最多保留 ' + o.maxCount + ' 条' : '保留 ' + o.maxDays + ' 天') + '</small></span>'
          + '<button type="button" class="mlog-b" data-add="1">' + o.btn + '</button></div>'
          + (rows || '<div class="mlog-e">暂无记录</div>');
      }
      box.addEventListener('click', function (e) {
        var a = e.target.closest('[data-add]'), d = e.target.closest('[data-del]'), nb = e.target.closest('[data-note]');
        if (nb) {
          var tn = Number(nb.dataset.note), l0 = load(o.key), it = l0.find(function (x) { return x.t === tn; });
          if (!it) return;
          var v0 = window.prompt('备注(留空则清除)', it.n || '');
          if (v0 === null) return;
          v0 = String(v0).trim().slice(0, 200);
          if (v0) it.n = v0; else delete it.n;
          save(l0); render();
          if (o.toast) o.toast(v0 ? '备注已保存' : '备注已清除');
        } else if (a) {
          var v = Number(o.getValue()); if (!Number.isFinite(v)) return;
          var l = load(o.key), tt = Date.now(); while (l.some(function (x) { return x && x.t === tt; })) tt++; l.push({ t: tt, v: Math.round(v) }); save(trim(l, o)); render();
          if (o.toast) o.toast('已记录:' + Math.round(v).toLocaleString('en-US'));
        } else if (d) {
          if (!confirm('删除这条记录?')) return;
          var t = Number(d.dataset.del); save(load(o.key).filter(function (x) { return x.t !== t; })); render();
        }
      });
      render();
      return { render: render };
    }
  };
})();
