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
      var row = { cat: machineLabel(e.cat) || '未分类', note: e.note || '', amount: Number(e.amount) || 0, ts: e.ts || 0 };
      if (e.book === 'cash') out.cash.push(row);
      else if (e.book === 'transfer') out.transfer.push(row);
    });
    out.cash.sort(function (a, b) { return a.ts - b.ts; });
    out.transfer.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }

  function machineLabel(cat) { return cat === '白色机器' ? 'Urbana' : cat === '黑色机器' ? 'Hipermay' : cat; }

  /* ---------- 工具 ---------- */
  function fmt(n) { return (Math.round(Number(n) || 0)).toLocaleString('en-US'); }
  function hasNumber(n) { return n != null && String(n).trim() !== '' && Number.isFinite(Number(n)); }
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

  // 按实际绘制字体换行；保留显式换行，不截断原始备注。
  P.prototype.wrap = function (str, size, maxW, weight) {
    this.font(size, weight);
    var c = this.c, max = maxW * this.s, lines = [];
    String(str).split(/\r\n|\r|\n/).forEach(function (paragraph) {
      var line = '';
      Array.from(paragraph).forEach(function (ch) {
        if (line && c.measureText(line + ch).width > max) { lines.push(line); line = ''; }
        line += ch;
      });
      lines.push(line);
    });
    return lines;
  };

  /* ---------- 布局常量 ---------- */
  var HEAD_H = 188, HERO_H = 214, SEC_GAP = 34, SUM_H = 84, FOOT_H = 96;
  var TILE_H = 116, TILE_GAP = 16;

  // 只组织显示：分类按首次出现排序，组内保持原顺序，不修改或合并账目。
  function detailLayout(p, list) {
    var groups = [], byCat = new Map(), amountW = 0;
    list.forEach(function (it, i) {
      var cat = it.cat || '未分类';
      var note = String(it.note || '');
      var marker = /[（(]\s*ca(?:n|ñ|n\u0303)uelas\s*[）)]/gi;
      var canuelas = marker.test(note.normalize('NFC'));
      var key = JSON.stringify([canuelas, cat]), group = byCat.get(key);
      if (!group) {
        group = { cat: canuelas ? 'Cañuelas · ' + cat : cat, canuelas: canuelas, rows: [] };
        byCat.set(key, group); groups.push(group);
      }
      var displayNote = canuelas ? note.normalize('NFC').replace(/[（(]\s*ca(?:n|ñ)uelas\s*[）)]/gi, '').trim() : note;
      var amount = '-' + fmt(it.amount);
      amountW = Math.max(amountW, p.wide(amount, 30, 800));
      group.rows.push({ item: it, note: displayNote, index: i + 1, amount: amount });
    });
    // 普通记录在前，Cañuelas 单独列在后面；组内保留原时间顺序。
    groups.sort(function (a, b) { return Number(a.canuelas) - Number(b.canuelas); });
    // 超过 10 笔时在每个分类区域内双列，分类标题始终全宽且只出现一次。
    var columns = list.length > 10 ? 2 : 1, gap = 28;
    var cellW = (W - PAD * 2 - 56 - gap * (columns - 1)) / columns;
    var contentW = cellW - 56;
    // 异常长金额改放独立一行，避免挤占备注或彼此重叠。
    var stacked = amountW > contentW * 0.45;
    var noteW = stacked ? contentW : contentW - amountW - 28;
    var height = 24;
    groups.forEach(function (group) {
      group.lines = p.wrap(group.cat, 23, W - PAD * 2 - 56, 700);
      group.height = 20 + group.lines.length * 30;
      group.bodyHeight = 0;
      height += group.height;
      group.rows.forEach(function (row) {
        row.lines = p.wrap(row.note || '（无备注）', 30, noteW, 700);
        row.stacked = stacked;
        row.amountSize = stacked ? Math.min(30, 30 * contentW / amountW) : 30;
        row.height = Math.max(70, 24 + row.lines.length * 40 + (stacked ? 40 : 0));
      });
      // 每对记录共用行高；先左后右，下一对从最长备注下方开始。
      for (var i = 0; i < group.rows.length; i += columns) {
        var rowH = group.rows[i].height;
        if (columns === 2 && group.rows[i + 1]) rowH = Math.max(rowH, group.rows[i + 1].height);
        for (var col = 0; col < columns && group.rows[i + col]; col++) {
          var row = group.rows[i + col];
          row.x = PAD + 28 + col * (cellW + gap);
          row.y = group.bodyHeight;
        }
        group.bodyHeight += rowH;
      }
      height += group.bodyHeight;
    });
    return { groups: groups, cellW: cellW, height: height + SUM_H };
  }

  function tileRows(n) { return Math.ceil(n / 2); }
  function layout(spec, details) {
    var h = HEAD_H + HERO_H + SEC_GAP;
    h += 44;                                         // 明细小标题
    h += spec.list.length ? details.height : 104;
    h += SEC_GAP + 44;                               // 指标小标题
    h += (spec.tiles.length ? tileRows(spec.tiles.length) * (TILE_H + TILE_GAP) : 92) + 12;
    h += FOOT_H;
    return Math.round(h);
  }

  function draw(canvas, spec) {
    var dpr = 2;
    var details = detailLayout(new P(canvas.getContext('2d'), dpr), spec.list);
    var H = layout(spec, details);
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
    p.text(spec.hero.text != null ? spec.hero.text : fmt(spec.hero.value), PAD + 50, y + 158, '#ffffff', 'left', 78, 800);
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
      var boxH = details.height;
      p.card(PAD, y, W - PAD * 2, boxH, 26, 'rgba(255,255,255,.04)', 'rgba(255,255,255,.09)');
      var ry = y + 24, sum = 0;
      details.groups.forEach(function (group, gi) {
        if (gi) p.line(PAD + 28, ry, W - PAD - 28, 'rgba(255,255,255,.14)');
        group.lines.forEach(function (line, li) {
          p.text(line, PAD + 28, ry + 28 + li * 30, 'rgba(148,163,184,.9)', 'left', 23, 700);
        });
        ry += group.height;
        group.rows.forEach(function (row) {
          sum += row.item.amount;
          var x = row.x, top = ry + row.y, right = x + details.cellW;
          if (row.y) p.line(x + 56, top, right, 'rgba(255,255,255,.055)');
          var mid = top + 42;
          p.card(x, mid - 30, 38, 38, 12, 'rgba(255,255,255,.07)', null);
          p.text(String(row.index), x + 19, mid - 4, 'rgba(148,163,184,.9)', 'center', 20, 700);
          row.lines.forEach(function (line, li) {
            p.text(line, x + 56, mid + li * 40, '#e8eefc', 'left', 30, 700);
          });
          var amountY = mid + (row.stacked ? row.lines.length * 40 : 0);
          p.text(row.amount, right, amountY, '#fda4af', 'right', row.amountSize, 800);
        });
        ry += group.bodyHeight;
      });
      var sy = ry;
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
    if (!spec.tiles.length) {          // 全部为 0:整块不显示,给一句说明
      p.card(PAD, y, full, 92, 26, 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
      p.text('当日无' + spec.tilesEmpty, W / 2, y + 56, 'rgba(148,163,184,.8)', 'center', 25, 600);
      y += 92;
    }
    spec.tiles.forEach(function (t, ti) {
      // 两列排到最后只剩一个非整行块时,让它独占整行,避免右边留空
      var lastOdd = !t.wide && ti === spec.tiles.length - 1 && col === 0;
      var wide = !!t.wide;
      var tw = (wide || lastOdd) ? full : halfW;
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
  function cashSpec(day, r, data, extra, hasReport = true) {
    var tiles = [];
    if (hasReport) {
      tiles.push({ label: '总营业额', value: r.zRevenue });
      tiles.push({ label: '现金', value: r.theoryX });
      tiles.push({ label: '现金支出', value: data.f_exp, color: '#fda4af' });
      tiles.push({ label: '手机卡数', value: r.sNonCash });
    }
    if (hasNumber(extra.fiambreria)) tiles.push({ label: 'Fiambreria', value: extra.fiambreria });
    if (hasNumber(extra.people)) tiles.push({ label: '人数', text: String(Math.round(extra.people)) });
    return {
      title: '现金日结', subtitle: 'CASH  ·  当日支出与实时报表', brand: '现金 · 每日结算',
      date: day, list: [], tiles: tiles,
      listTitle: '当日现金支出', tilesTitle: '实时报表', tilesEmpty: '报表数据',
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
    var tiles = [];                                    // 六项固定显示,值为 0 也照常显示
    tiles.push({ label: 'pago24', value: n('orange_z'), color: '#fbbf24' });
    tiles.push({ label: 'DNI', value: n('dni_z1'), color: '#60a5fa' });
    tiles.push({ label: 'Mercado', value: mercE2, color: '#34d399' });
    tiles.push({ label: 'Vtpay', value: vtZ1, color: '#a78bfa' });
    tiles.push({ label: 'Urbana', value: white });
    tiles.push({ label: 'Hipermay', value: black });
    // 非现金总数差额只在主卡片显示，平账也显示 0。
    return {
      title: '转账日结', subtitle: 'TRANSFER  ·  当日支出与手机卡收入', brand: '转账 · 每日结算',
      date: day, list: [], tiles: tiles,
      listTitle: '当日转账支出', tilesTitle: '手机卡收入', tilesEmpty: '手机卡收入',
      hero: { label: '手机卡总数', value: r.sNonCash, sub: { label: '非现金总数差额', value: l3, color: l3 >= 0 ? '#34d399' : '#fb7185' } },
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
