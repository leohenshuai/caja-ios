/* 日结海报:现金账本 / 转账账本。
   数据来源:财务页自身 app.data(报表值走 Calc.getReportValues)+ 记账系统 LedgerDB(当日支出明细)。
   渲染:纯 canvas 直绘(不依赖 html2canvas),输出 PNG;预览在页面内,再由用户保存/分享。 */
(function () {
  'use strict';

  var LEDGER_DB = 'LedgerDB', LEDGER_STORE = 'data';
  var W = 1080, PAD = 64;

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

  /* ---------- 工具 ---------- */
  function fmt(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US'); }
  function nz(n) { return Math.abs(Number(n) || 0) >= 1; }     // 非零判定(四舍五入后)
  function weekday(ds) {
    var p = String(ds).split('-').map(Number);
    if (p.length !== 3) return '';
    return '周' + '日一二三四五六'.charAt(new Date(p[0], p[1] - 1, p[2]).getDay());
  }

  function P(ctx, s) { this.c = ctx; this.s = s; }
  P.prototype.font = function (size, weight) {
    this.c.font = (weight || 600) + ' ' + (size * this.s) + 'px -apple-system, "PingFang SC", "Helvetica Neue", system-ui, sans-serif';
  };
  P.prototype.text = function (str, x, y, color, align, size, weight) {
    if (size) this.font(size, weight);
    this.c.fillStyle = color; this.c.textAlign = align || 'left'; this.c.textBaseline = 'alphabetic';
    this.c.fillText(str, x * this.s, y * this.s);
  };
  P.prototype.path = function (x, y, w, h, r) {
    var c = this.c, s = this.s;
    x *= s; y *= s; w *= s; h *= s; r *= s;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  };
  P.prototype.card = function (x, y, w, h, r, fill, stroke) {
    this.path(x, y, w, h, r);
    if (fill) { this.c.fillStyle = fill; this.c.fill(); }
    if (stroke) { this.c.strokeStyle = stroke; this.c.lineWidth = Math.max(1, 1.4 * this.s); this.c.stroke(); }
  };
  P.prototype.grad = function (x1, y1, x2, y2, from, to) {
    var g = this.c.createLinearGradient(x1 * this.s, y1 * this.s, x2 * this.s, y2 * this.s);
    g.addColorStop(0, from); g.addColorStop(1, to);
    return g;
  };
  P.prototype.glow = function (cx, cy, r, color) {
    var c = this.c, s = this.s;
    var g = c.createRadialGradient(cx * s, cy * s, 0, cx * s, cy * s, r * s);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  };
  P.prototype.line = function (x1, y, x2, color) {
    var c = this.c, s = this.s;
    c.strokeStyle = color; c.lineWidth = Math.max(1, s);
    c.beginPath(); c.moveTo(x1 * s, y * s); c.lineTo(x2 * s, y * s); c.stroke();
  };
  P.prototype.clip = function (str, size, maxW, weight) {
    this.font(size, weight || 600);
    var c = this.c, max = maxW * this.s;
    if (c.measureText(str).width <= max) return str;
    var out = str;
    while (out.length > 1 && c.measureText(out + '…').width > max) out = out.slice(0, -1);
    return out + '…';
  };
  P.prototype.wide = function (str, size, weight) {   // 量文字宽度(回 CSS px)
    this.font(size, weight || 600);
    return this.c.measureText(str).width / this.s;
  };

  /* ---------- 布局常量 ---------- */
  var HEAD_H = 188, HERO_H = 214, SEC_GAP = 34, ROW_H = 70, SUM_H = 84, FOOT_H = 96;
  var TILE_H = 116, TILE_GAP = 16;

  function tileRows(n) { return Math.ceil(n / 2); }
  function layout(spec) {
    var h = HEAD_H + HERO_H + SEC_GAP;
    h += 44;                                         // 明细小标题
    h += spec.list.length ? (24 + spec.list.length * ROW_H + SUM_H) : 104;
    h += SEC_GAP + 44;                               // 指标小标题
    h += tileRows(spec.tiles.length) * (TILE_H + TILE_GAP) + 12;
    h += FOOT_H;
    return Math.round(h);
  }

  function draw(canvas, spec) {
    var dpr = 2, H = layout(spec);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = '100%';
    var c = canvas.getContext('2d');
    var p = new P(c, dpr);
    var A = spec.accent, A2 = spec.accent2;

    /* 背景:深色渐变 + 两处柔光 */
    var bg = c.createLinearGradient(0, 0, W * dpr, H * dpr);
    bg.addColorStop(0, '#0a0f1f'); bg.addColorStop(0.5, '#0d1528'); bg.addColorStop(1, '#090d1a');
    c.fillStyle = bg; c.fillRect(0, 0, W * dpr, H * dpr);
    p.glow(130, 90, 620, spec.glow1);
    p.glow(W - 80, 330, 560, spec.glow2);

    /* ===== 头部 ===== */
    // 左侧竖条
    c.fillStyle = p.grad(0, 60, 0, 150, A, A2);
    p.path(PAD, 62, 7, 86, 4); c.fill();

    p.text(spec.title, PAD + 26, 104, '#ffffff', 'left', 50, 800);
    p.text(spec.subtitle, PAD + 26, 140, 'rgba(148,163,184,.85)', 'left', 23, 500);

    // 右上日期胶囊
    var dLabel = spec.date + '  ' + weekday(spec.date);
    var dw = p.wide(dLabel, 24, 700) + 44;
    p.card(W - PAD - dw, 72, dw, 54, 27, 'rgba(255,255,255,.07)', 'rgba(255,255,255,.14)');
    p.text(dLabel, W - PAD - dw / 2, 106, 'rgba(226,232,240,.95)', 'center', 24, 700);

    var y = HEAD_H;

    /* ===== Hero 大数字卡 ===== */
    p.card(PAD, y, W - PAD * 2, HERO_H - 24, 30, p.grad(PAD, y, W - PAD, y + HERO_H, spec.heroFrom, spec.heroTo), 'rgba(255,255,255,.16)');
    // 卡内左侧竖条
    c.fillStyle = A; p.path(PAD + 34, y + 38, 5, 46, 3); c.fill();
    p.text(spec.hero.label, PAD + 54, y + 72, 'rgba(226,232,240,.9)', 'left', 26, 700);
    p.text(fmt(spec.hero.value), PAD + 50, y + 158, '#ffffff', 'left', 78, 800);
    // 右下角副指标
    if (spec.hero.sub) {
      p.text(spec.hero.sub.label, W - PAD - 40, y + 110, 'rgba(203,213,225,.75)', 'right', 22, 600);
      p.text(spec.hero.sub.text || fmt(spec.hero.sub.value), W - PAD - 40, y + 156, spec.hero.sub.color || A, 'right', 40, 800);
    }
    y += HERO_H + SEC_GAP - 24;

    /* ===== 支出明细 ===== */
    p.text('●', PAD, y + 24, A, 'left', 16, 800);
    p.text(spec.listTitle, PAD + 24, y + 26, '#e8eefc', 'left', 27, 800);
    p.text(spec.list.length ? (spec.list.length + ' 笔') : '', W - PAD, y + 26, 'rgba(148,163,184,.8)', 'right', 22, 600);
    y += 44;

    if (spec.list.length) {
      var boxH = 24 + spec.list.length * ROW_H + SUM_H - 24;
      p.card(PAD, y, W - PAD * 2, boxH, 26, 'rgba(255,255,255,.04)', 'rgba(255,255,255,.09)');
      var ry = y + 24, sum = 0;
      spec.list.forEach(function (it, i) {
        sum += it.amount;
        var base = ry + ROW_H * i;
        if (i) p.line(PAD + 28, base, W - PAD - 28, 'rgba(255,255,255,.055)');
        var mid = base + ROW_H / 2 + 10;
        // 序号圆点
        p.card(PAD + 28, mid - 30, 38, 38, 12, 'rgba(255,255,255,.07)', null);
        p.text(String(i + 1), PAD + 47, mid - 4, 'rgba(148,163,184,.9)', 'center', 20, 700);
        p.text(p.clip(it.cat, 28, 250, 700), PAD + 84, mid, '#e8eefc', 'left', 28, 700);
        if (it.note) p.text(p.clip(it.note, 22, 340, 500), PAD + 348, mid, 'rgba(148,163,184,.9)', 'left', 22, 500);
        p.text('-' + fmt(it.amount), W - PAD - 28, mid, '#fda4af', 'right', 30, 800);
      });
      var sy = ry + ROW_H * spec.list.length;
      p.line(PAD + 28, sy, W - PAD - 28, 'rgba(255,255,255,.14)');
      p.text('支出合计', PAD + 28, sy + 48, 'rgba(226,232,240,.92)', 'left', 27, 800);
      p.text('-' + fmt(sum), W - PAD - 28, sy + 50, '#fb7185', 'right', 36, 800);
      y += boxH;
    } else {
      p.card(PAD, y, W - PAD * 2, 92, 26, 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
      p.text('当日无支出记录', W / 2, y + 56, 'rgba(148,163,184,.8)', 'center', 25, 600);
      y += 92;
    }
    y += SEC_GAP;

    /* ===== 指标两列网格 ===== */
    p.text('●', PAD, y + 24, A2, 'left', 16, 800);
    p.text(spec.tilesTitle, PAD + 24, y + 26, '#e8eefc', 'left', 27, 800);
    y += 44;

    var full = W - PAD * 2;
    var halfW = (full - TILE_GAP) / 2;
    var col = 0;
    spec.tiles.forEach(function (t) {
      var wide = !!t.wide;
      var tw = wide ? full : halfW;
      if (wide && col === 1) { y += TILE_H + TILE_GAP; col = 0; }       // 整行块另起一行
      var tx = PAD + (col === 1 ? halfW + TILE_GAP : 0);
      var fill = t.hl ? p.grad(tx, y, tx + tw, y + TILE_H, 'rgba(255,255,255,.12)', 'rgba(255,255,255,.045)') : 'rgba(255,255,255,.04)';
      p.card(tx, y, tw, TILE_H, 24, fill, t.hl ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.085)');
      // 顶部小色条
      c.fillStyle = t.color || (t.hl ? A : 'rgba(148,163,184,.45)');
      p.path(tx + 26, y + 26, 4, 26, 2); c.fill();
      p.text(p.clip(t.label, 23, tw - 76, 600), tx + 42, y + 48, 'rgba(203,213,225,.88)', 'left', 23, 600);
      var vText = t.text != null ? t.text : fmt(t.value);
      var vSize = vText.length > 11 ? 34 : 40;
      p.text(vText, tx + 26, y + 95, t.color || (t.hl ? '#ffffff' : '#e8eefc'), 'left', vSize, 800);
      col = wide ? 0 : (col === 1 ? 0 : 1);
      if (col === 0) y += TILE_H + TILE_GAP;
    });
    if (col === 1) y += TILE_H + TILE_GAP;

    /* ===== 页脚 ===== */
    y += 16;
    p.line(PAD, y, W - PAD, 'rgba(255,255,255,.08)');
    y += 42;
    p.text(spec.brand, PAD, y, 'rgba(148,163,184,.7)', 'left', 21, 700);
    p.text(new Date().toLocaleString('zh-CN'), W - PAD, y, 'rgba(100,116,139,.75)', 'right', 20, 500);
    return canvas;
  }

  /* ---------- 两种海报的数据组装 ---------- */
  // extra: { fiambreria, people }
  function cashSpec(day, r, data, extra) {
    var tiles = [];
    tiles.push({ label: '总营业额', value: r.zRevenue });
    tiles.push({ label: '现金', value: r.theoryX });
    tiles.push({ label: '现金支出', value: data.f_exp, color: '#fda4af' });
    tiles.push({ label: '手机卡数', value: r.sNonCash });
    if (nz(extra.fiambreria)) tiles.push({ label: 'Fiambreria', value: extra.fiambreria });
    if (nz(extra.people)) tiles.push({ label: '人数', text: String(Math.round(extra.people)) });
    return {
      title: '现金账本日结', subtitle: 'CASH  ·  当日支出与实时报表', brand: '现金账本 · 每日结算',
      date: day, list: [], tiles: tiles,
      listTitle: '当日现金支出', tilesTitle: '实时报表',
      hero: { label: '总现金', value: r.vaultH, sub: { label: '今日余额', value: r.todayY } },
      accent: '#38bdf8', accent2: '#818cf8',
      heroFrom: 'rgba(56,189,248,.26)', heroTo: 'rgba(99,102,241,.16)',
      glow1: 'rgba(56,189,248,.16)', glow2: 'rgba(99,102,241,.13)'
    };
  }
  function transferSpec(day, r, data) {
    var n = function (k) { return Number(String(data[k] == null ? '' : data[k]).replace(/[^\d.-]/g, '')) || 0; };
    var listSum = function (v) {
      if (Array.isArray(v)) return v.reduce(function (a, x) { return a + (Number(x) || 0); }, 0);
      return Number(v) || 0;
    };
    // Mercado 取今日收入 e2;橙色/DNI/Vtpay 取各自软件(本店)收入值
    var mercE2 = n('merc_f2') - n('merc_b2') + n('merc_c2') - n('merc_other');
    var vtZ1 = n('vtpay_z1');
    var white = listSum(data.white_list), black = listSum(data.black_k_list);
    var l3 = r.sNonCash - r.z3Ref;
    var tiles = [];                                    // 为零不显示
    if (nz(n('orange_z'))) tiles.push({ label: '橙色机器', value: n('orange_z'), color: '#fbbf24' });
    if (nz(n('dni_z1'))) tiles.push({ label: 'DNI', value: n('dni_z1'), color: '#60a5fa' });
    if (nz(mercE2)) tiles.push({ label: 'Mercado', value: mercE2, color: '#34d399' });
    if (nz(vtZ1)) tiles.push({ label: 'Vtpay', value: vtZ1, color: '#a78bfa' });
    if (nz(white)) tiles.push({ label: '白色机器', value: white });
    if (nz(black)) tiles.push({ label: '黑色机器', value: black });
    // 非现金总数差额只在 Hero 卡右侧显示一次,这里不再重复列出
    return {
      title: '转账账本日结', subtitle: 'TRANSFER  ·  当日支出与平台项目', brand: '转账账本 · 每日结算',
      date: day, list: [], tiles: tiles,
      listTitle: '当日转账支出', tilesTitle: '平台项目',
      hero: { label: '手机卡总数', value: r.sNonCash, sub: nz(l3) ? { label: '非现金总数差额', value: l3, color: l3 >= 0 ? '#34d399' : '#fb7185' } : null },
      accent: '#a78bfa', accent2: '#38bdf8',
      heroFrom: 'rgba(167,139,250,.26)', heroTo: 'rgba(56,189,248,.15)',
      glow1: 'rgba(167,139,250,.16)', glow2: 'rgba(56,189,248,.12)'
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
