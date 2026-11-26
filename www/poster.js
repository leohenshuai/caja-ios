/* 日结海报:现金账本 / 转账账本。
   数据来源:财务页自身 app.data(报表值走 Calc.getReportValues)+ 记账系统 LedgerDB(当日支出明细)。
   渲染:纯 canvas 直绘(不依赖 html2canvas),输出 PNG;预览在页面内,再由用户保存/分享。 */
(function () {
  'use strict';

  var LEDGER_DB = 'LedgerDB', LEDGER_STORE = 'data';
  var W = 1080, PAD = 56;

  /* ---------- 记账库读取(只读,不写) ---------- */
  function openLedger() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(LEDGER_DB);            // 不指定版本,避免误触发升级
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { resolve(null); };
      req.onupgradeneeded = function (e) {            // 记账库还不存在时不建表,直接放弃
        try { e.target.transaction.abort(); } catch (_) {}
        resolve(null);
      };
    });
  }
  function dbGet(db, key) {
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction([LEDGER_STORE], 'readonly');
        var r = tx.objectStore(LEDGER_STORE).get(key);
        r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
        r.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }
  function localDateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // 返回 { cash:[{cat,note,amount,ts}], transfer:[...] },只取当日支出
  async function loadLedgerDay(dateStr) {
    var out = { cash: [], transfer: [], ok: false };
    var db = await openLedger();
    if (!db) return out;
    var entries = await dbGet(db, 'entries');
    try { db.close(); } catch (_) {}
    if (!Array.isArray(entries)) return out;
    out.ok = true;
    entries.forEach(function (e) {
      if (!e || e.date !== dateStr || e.type !== 'out') return;
      var row = { cat: e.cat || '未分类', note: e.note || '', amount: Number(e.amount) || 0, ts: e.ts || 0 };
      if (e.book === 'cash') out.cash.push(row);
      else if (e.book === 'transfer') out.transfer.push(row);
    });
    out.cash.sort(function (a, b) { return a.ts - b.ts; });
    out.transfer.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }

  /* ---------- 画布工具 ---------- */
  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString('en-US');
  }
  function nz(n) { return Math.abs(Number(n) || 0) >= 1; }     // 非零判定(四舍五入后)

  function Painter(ctx, scale) {
    this.c = ctx; this.s = scale; this.y = 0;
  }
  Painter.prototype.font = function (size, weight) {
    this.c.font = (weight || 600) + ' ' + (size * this.s) + 'px -apple-system, "PingFang SC", system-ui, sans-serif';
  };
  Painter.prototype.text = function (str, x, y, color, align) {
    this.c.fillStyle = color; this.c.textAlign = align || 'left'; this.c.textBaseline = 'alphabetic';
    this.c.fillText(str, x * this.s, y * this.s);
  };
  Painter.prototype.rrect = function (x, y, w, h, r, fill, stroke) {
    var c = this.c, s = this.s;
    x *= s; y *= s; w *= s; h *= s; r *= s;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = Math.max(1, 1.2 * s); c.stroke(); }
  };
  Painter.prototype.line = function (x1, y, x2, color) {
    var c = this.c, s = this.s;
    c.strokeStyle = color; c.lineWidth = Math.max(1, s);
    c.beginPath(); c.moveTo(x1 * s, y * s); c.lineTo(x2 * s, y * s); c.stroke();
  };
  // 超长文本截断加省略号
  Painter.prototype.clip = function (str, size, maxW) {
    this.font(size, 600);
    var c = this.c, s = this.s, max = maxW * s;
    if (c.measureText(str).width <= max) return str;
    var out = str;
    while (out.length > 1 && c.measureText(out + '…').width > max) out = out.slice(0, -1);
    return out + '…';
  };

  /* ---------- 海报布局(先算高度再画,保证不截断) ---------- */
  // rows: [{label, value, strong?, color?}] ; list: [{cat,note,amount}]
  function layout(spec) {
    var h = 0;
    h += 150;                                   // 头部
    if (spec.list.length) h += 62 + spec.list.length * 58 + 56 + 30;   // 明细标题+行+合计+间隔
    else h += 110;
    h += 56 + spec.rows.length * 60 + 40;       // 指标区
    h += 70;                                    // 页脚
    return h;
  }

  function draw(canvas, spec) {
    var dpr = 2, H = layout(spec);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = '100%';
    var c = canvas.getContext('2d');
    var p = new Painter(c, dpr);

    // 背景
    var g = c.createLinearGradient(0, 0, W * dpr, H * dpr);
    g.addColorStop(0, '#0b1324'); g.addColorStop(0.55, '#0e1a30'); g.addColorStop(1, '#0a1020');
    c.fillStyle = g; c.fillRect(0, 0, W * dpr, H * dpr);
    // 顶部色条
    var g2 = c.createLinearGradient(0, 0, W * dpr, 0);
    g2.addColorStop(0, spec.accent); g2.addColorStop(1, spec.accent2);
    c.fillStyle = g2; c.fillRect(0, 0, W * dpr, 10 * dpr);

    var y = 86;
    p.font(44, 800); p.text(spec.title, PAD, y, '#ffffff');
    p.font(26, 600); p.text(spec.date, W - PAD, y, 'rgba(226,232,240,.75)', 'right');
    y += 34;
    p.font(22, 500); p.text(spec.subtitle, PAD, y, 'rgba(148,163,184,.9)');
    y += 44;

    // 明细
    if (spec.list.length) {
      p.font(26, 800); p.text('当日支出明细', PAD, y, spec.accent);
      y += 34;
      var cardTop = y, rowH = 58;
      p.rrect(PAD - 16, cardTop - 12, W - (PAD - 16) * 2, spec.list.length * rowH + 56 + 20, 24, 'rgba(255,255,255,.045)', 'rgba(255,255,255,.1)');
      y += 28;
      var sum = 0;
      spec.list.forEach(function (it, i) {
        sum += it.amount;
        if (i) p.line(PAD, y - 34, W - PAD, 'rgba(255,255,255,.06)');
        p.font(27, 700);
        p.text(p.clip(it.cat, 27, 300), PAD, y, '#e8eefc');
        if (it.note) {
          p.font(21, 500);
          p.text(p.clip(it.note, 21, 330), PAD + 310, y, 'rgba(148,163,184,.95)');
        }
        p.font(29, 800);
        p.text('-' + fmt(it.amount), W - PAD, y, '#fda4af', 'right');
        y += rowH;
      });
      p.line(PAD, y - 30, W - PAD, 'rgba(255,255,255,.14)');
      y += 12;
      p.font(27, 800); p.text('支出合计', PAD, y, 'rgba(226,232,240,.9)');
      p.font(33, 800); p.text('-' + fmt(sum), W - PAD, y, '#fb7185', 'right');
      y += 60;
    } else {
      p.rrect(PAD - 16, y - 12, W - (PAD - 16) * 2, 86, 24, 'rgba(255,255,255,.045)', 'rgba(255,255,255,.1)');
      p.font(25, 600); p.text('当日无支出记录', W / 2, y + 42, 'rgba(148,163,184,.85)', 'center');
      y += 118;
    }

    // 指标
    p.font(26, 800); p.text(spec.rowsTitle, PAD, y, spec.accent);
    y += 30;
    var mTop = y;
    p.rrect(PAD - 16, mTop - 10, W - (PAD - 16) * 2, spec.rows.length * 60 + 30, 24, 'rgba(255,255,255,.045)', 'rgba(255,255,255,.1)');
    y += 42;
    spec.rows.forEach(function (r, i) {
      if (i) p.line(PAD, y - 36, W - PAD, 'rgba(255,255,255,.06)');
      p.font(r.strong ? 29 : 26, r.strong ? 800 : 600);
      p.text(r.label, PAD, y, r.strong ? '#ffffff' : 'rgba(203,213,225,.95)');
      p.font(r.strong ? 34 : 29, 800);
      p.text(r.text != null ? r.text : fmt(r.value), W - PAD, y, r.color || (r.strong ? spec.accent : '#e8eefc'), 'right');
      y += 60;
    });

    y += 34;
    p.font(20, 500);
    p.text('由管理系统生成 · ' + new Date().toLocaleString('zh-CN'), W / 2, y, 'rgba(100,116,139,.8)', 'center');
    return canvas;
  }

  /* ---------- 两种海报的数据组装 ---------- */
  // extra: { fiambreria, people }
  function cashSpec(day, r, data, extra) {
    var rows = [];
    rows.push({ label: '总营业额', value: r.zRevenue });
    rows.push({ label: '现金', value: r.theoryX });
    rows.push({ label: '现金支出', value: data.f_exp, color: '#fda4af' });
    rows.push({ label: '手机卡数', value: r.sNonCash });
    if (nz(extra.fiambreria)) rows.push({ label: 'Fiambreria', value: extra.fiambreria });
    rows.push({ label: '今日余额', value: r.todayY, strong: true });
    if (nz(extra.people)) rows.push({ label: '人数', text: String(Math.round(extra.people)) });
    rows.push({ label: '总现金', value: r.vaultH, strong: true });
    return {
      title: '现金账本日结', subtitle: '现金支出明细 · 实时报表',
      date: day, list: [], rows: rows, rowsTitle: '实时报表',
      accent: '#38bdf8', accent2: '#6366f1'
    };
  }
  function transferSpec(day, r, data) {
    var rows = [];
    var n = function (k) { return Number(String(data[k] == null ? '' : data[k]).replace(/[^\d.-]/g, '')) || 0; };
    // Mercado 取今日收入 e2;橙色/DNI/Vtpay 取各自软件(本店)收入值
    var mercE2 = n('merc_f2') - n('merc_b2') + n('merc_c2') - n('merc_other');
    var vtZ1 = n('vtpay_z1');
    var listSum = function (v) {
      if (Array.isArray(v)) return v.reduce(function (a, x) { return a + (Number(x) || 0); }, 0);
      return Number(v) || 0;
    };
    var white = listSum(data.white_list), black = listSum(data.black_k_list);
    var l3 = r.sNonCash - r.z3Ref;
    // 为零不显示;橙色与 DNI 取软件收入值(orange_z / dni_z1),Vtpay 取本店收入值 z1
    if (nz(n('orange_z'))) rows.push({ label: '橙色机器', value: n('orange_z') });
    if (nz(n('dni_z1'))) rows.push({ label: 'DNI', value: n('dni_z1') });
    if (nz(mercE2)) rows.push({ label: 'Mercado', value: mercE2 });
    if (nz(vtZ1)) rows.push({ label: 'Vtpay', value: vtZ1 });
    if (nz(white)) rows.push({ label: '白色机器', value: white });
    if (nz(black)) rows.push({ label: '黑色机器', value: black });
    if (nz(r.sNonCash)) rows.push({ label: '手机卡总数', value: r.sNonCash, strong: true });
    if (nz(l3)) rows.push({ label: '非现金总数差额', value: l3, strong: true, color: l3 >= 0 ? '#34d399' : '#fb7185' });
    return {
      title: '转账账本日结', subtitle: '转账支出明细 · 平台项目',
      date: day, list: [], rows: rows, rowsTitle: '平台项目与差额',
      accent: '#a78bfa', accent2: '#38bdf8'
    };
  }

  window.LedgerPoster = {
    loadLedgerDay: loadLedgerDay,
    localDateStr: localDateStr,
    cashSpec: cashSpec,
    transferSpec: transferSpec,
    draw: draw,
    fmt: fmt
  };
})();
