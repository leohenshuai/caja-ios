/* 首页（App 内）：数据与备份面板、检查更新接 GitHub Release、触觉开关。浏览器里不生效。 */
(function () {
  'use strict';
  var NB = window.NativeBridge;
  if (!(NB && NB.available) || !window.Backup) return;
  var $ = function (id) { return document.getElementById(id); };
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function fmtTime(ms) { var d = new Date(ms), p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  var KIND = { auto: '自动', manual: '手动', snapshot: '恢复前快照' };
  function kindOf(n) { return KIND[n.split('_')[0]] || n.split('_')[0]; }

  /* ---- 版本与更新状态 ---- */
  var info = { build: '?', last: 0 };
  function paintStatus(state) {
    if ($('suiteVersion')) $('suiteVersion').textContent = 'build ' + info.build;
    if ($('suiteRuntime')) $('suiteRuntime').textContent = 'App 内置(离线可用)';
    if ($('suiteUpdateState')) $('suiteUpdateState').textContent = state || '等待检查';
    if ($('suiteLastCheck')) $('suiteLastCheck').textContent = info.last ? fmtTime(info.last) : '尚未检查';
    var w = document.querySelector('.suite-status-item.warning'); if (w) w.style.display = 'none';
  }
  window.renderSuiteUpdateStatus = function () {};
  window.checkSuiteUpdate = async function () {
    var b = $('suiteUpdateBtn'); b.disabled = true; b.textContent = '正在检查…'; paintStatus('正在检查…');
    var r = await NB.call('checkUpdate', {}, 20000);
    b.disabled = false; b.textContent = '立即检查更新';
    if (!r.ok) { NB.haptic('error'); return paintStatus(r.error || '检查失败'); }
    info.last = Date.now();
    paintStatus(r.hasUpdate ? '发现新版本 build ' + r.latest + '(覆盖安装前请先点下方“导出”)' : '已是最新版本');
    NB.haptic(r.hasUpdate ? 'warning' : 'success');
  };
  NB.call('appInfo').then(function (r) { if (r.ok) { info.build = r.build; info.last = r.lastUpdateCheck || 0; } paintStatus(); });

  /* ---- 恢复全部备份：改走带快照/回滚的流程 ---- */
  window.restoreAllSystemsBackup = async function (ev) {
    var input = ev.target, f = input.files && input.files[0]; if (!f) return;
    try {
      var text = await f.text(), v = await Backup.validate(text), s = v.backup.stats || {};
      if (!confirm('将用 ' + (v.backup.exportedAt ? fmtTime(Date.parse(v.backup.exportedAt)) : '未知时间') + ' 的备份覆盖当前全部数据' + (s.records ? '(' + s.records + ' 条记录)' : '') + '。\n恢复前会自动保存一份快照,失败会自动回滚。继续吗?')) return;
      await Backup.restore(text); NB.haptic('success'); alert('恢复完成,页面将刷新。'); location.reload();
    } catch (e) { NB.haptic('error'); alert('恢复失败:' + e.message); }
    finally { input.value = ''; }
  };

  /* ---- 合并后的「数据与备份」面板 ---- */
  var old = document.querySelector('.suite-backup-panel'); if (!old) return;
  old.style.display = 'none';                                   // 旧的"六系统总备份"并入新面板
  var tipBox = document.querySelector('.info-section'); if (tipBox) tipBox.style.display = 'none';   // 使用提示删除
  document.querySelectorAll('.app-status').forEach(function (e) { e.style.display = 'none'; });       // "待缓存"在 App 内无意义
  var foot = document.querySelector('.footer'); if (foot) foot.textContent = 'Caja 套件 · 全部页面内置于 App · 数据保存在本机';

  var panel = document.createElement('div');
  panel.id = 'vaultPanel'; panel.style.cssText = 'display:block';
  panel.innerHTML =
    '<div class="suite-backup-title">数据与备份</div>' +
    '<div class="suite-backup-desc" id="vaultSummary" style="margin:4px 0 12px">读取中…</div>' +
    '<div class="suite-backup-actions" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">' +
    '<button class="suite-backup-btn" id="vaultNow" type="button"><span>🛡️</span><span>立即备份</span></button>' +
    '<button class="suite-backup-btn" id="vaultExport" type="button"><span>📤</span><span>导出</span></button>' +
    '<button class="suite-backup-btn suite-restore-btn" id="vaultImport" type="button"><span>♻️</span><span>从文件恢复</span></button>' +
    '<button class="suite-backup-btn" id="vaultHap" type="button"><span>📳</span><span id="vaultHapT"></span></button>' +
    '<button class="suite-backup-btn" id="vaultSnd" type="button"><span>🔊</span><span id="vaultSndT"></span></button>' +
    '<button class="suite-backup-btn" id="vaultUi" type="button"><span>🔔</span><span id="vaultUiT"></span></button>' +
    '<button class="suite-backup-btn" id="vaultVoc" type="button"><span>🗣️</span><span id="vaultVocT"></span></button>' +
    '<input id="vaultFile" type="file" accept="application/json,.json" hidden onchange="restoreAllSystemsBackup(event)"></div>' +
    '<div class="suite-backup-desc" style="font-size:12px;opacity:.75;margin-bottom:8px">从旧版网页迁入:先在旧版首页导出备份,再点“从文件恢复”选择该文件。</div>' +
    '<div id="vaultList"></div>' +
    '<div class="suite-backup-desc" style="margin-top:8px;font-size:12px"><b>删除 App 会同时删掉备份</b>,请定期“导出”到 iCloud 云盘或电脑。</div>';

  /* 首页只放一行入口,点开后从底部弹出完整面板 */
  var entry = document.createElement('div');
  entry.id = 'vaultEntry';
  entry.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:12px;margin-top:14px;padding:14px 16px;cursor:pointer;border-radius:22px;border:.5px solid rgba(255,255,255,.16);background:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,.035));box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 8px 24px rgba(0,0,0,.3)';
  entry.innerHTML = '<div style="font-size:26px;flex:none">🛡️</div><div style="flex:1;min-width:0"><div style="margin:0;font-size:15px;font-weight:700;color:#fff">数据与备份</div>' +
    '<div id="vaultBrief" style="margin:2px 0 0;font-size:12px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">读取中…</div></div><div style="font-size:22px;opacity:.5;flex:none">›</div>';
  old.parentNode.insertBefore(entry, old);
  var sheet = document.createElement('div');
  sheet.id = 'vaultSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:5000;display:none;background:rgba(0,0,0,.45);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)';
  var card = document.createElement('div');
  card.style.cssText = 'position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow:auto;-webkit-overflow-scrolling:touch;border-radius:28px 28px 0 0;padding:10px 16px calc(20px + env(safe-area-inset-bottom,0px));' +
    'background:linear-gradient(170deg,#2a3656,#141c33) !important;border:.5px solid rgba(255,255,255,.2);box-shadow:0 -10px 40px rgba(0,0,0,.5)';
  card.innerHTML = '<div id="vaultGrab" style="width:40px;height:5px;border-radius:3px;background:rgba(255,255,255,.3);margin:0 auto 12px"></div>';
  card.appendChild(panel); sheet.appendChild(card); document.body.appendChild(sheet);
  // 打开/关闭不依赖任何动画:先直接放到最终位置,动画只是"尽力而为"的点缀
  function openSheet() {
    sheet.style.display = 'block'; card.style.transition = 'none'; card.style.transform = 'none';
    try { card.animate([{ transform: 'translateY(40px)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.22,1.1,.36,1)' }); } catch (e) {}
    NB.haptic('light'); render();
  }
  function closeSheet() { sheet.style.display = 'none'; }
  entry.onclick = openSheet;
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  var ty0 = null;
  card.addEventListener('touchstart', function (e) { ty0 = (card.scrollTop <= 0) ? e.touches[0].clientY : null; }, { passive: true });
  card.addEventListener('touchend', function (e) { if (ty0 !== null && e.changedTouches[0].clientY - ty0 > 90) closeSheet(); ty0 = null; }, { passive: true });

  function paintHap() { $('vaultHapT').textContent = '触觉:' + (localStorage.getItem('haptics') === '0' ? '关' : '开'); }
  paintHap();
  $('vaultHap').onclick = function () { var on = localStorage.getItem('haptics') === '0'; NB.setHaptics(on); paintHap(); if (on) NB.haptic('success'); };
  function paintKb() { $('vaultUiT').textContent = '按钮音:' + (NB.isUiSoundOn() ? '开' : '关'); $('vaultSndT').textContent = '键盘音:' + (NB.isSoundOn() ? '开' : '关'); $('vaultVocT').textContent = '数字播报:' + (NB.isVoiceOn() ? '开' : '关'); }
  paintKb();
  $('vaultSnd').onclick = function () { NB.setSound(!NB.isSoundOn()); paintKb(); NB.haptic('selection'); if (NB.isSoundOn()) NB.call('sound', { type: 'key' }); };
  $('vaultUi').onclick = function () { NB.setUiSound(!NB.isUiSoundOn()); paintKb(); NB.haptic('selection'); if (NB.isUiSoundOn()) NB.call('sound', { type: 'tap' }); };
  $('vaultVoc').onclick = function () { NB.setVoice(!NB.isVoiceOn()); paintKb(); NB.haptic('selection'); if (NB.isVoiceOn()) NB.call('speak', { text: '数字播报已开启' }); };
  $('vaultImport').onclick = function () { $('vaultFile').click(); };
  $('vaultNow').onclick = async function () {
    var b = this; b.disabled = true; var r = await Backup.auto('manual', 'manual'); b.disabled = false;
    if (r.ok) NB.haptic('success'); else { NB.haptic('error'); alert(r.empty ? '当前没有任何数据,未生成备份' : '备份失败:' + (r.error || '')); }
    render();
  };
  $('vaultExport').onclick = async function () {
    var b = this; b.disabled = true;
    try {
      var snap = await Backup.snapshot('export'), text = await Backup.serialize(snap), d = new Date(), p = function (x) { return String(x).padStart(2, '0'); };
      var name = '六系统全部备份_' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()) + '.json';
      await NB.shareText(name, text);
    } catch (e) { NB.haptic('error'); alert('导出失败:' + e.message); }
    b.disabled = false;
  };

  function schedText() {
    var h = Backup.getEveryH(); if (!h) return '(定时备份已关闭)';
    var nd = Backup.nextDue(); return '(' + (h === 24 ? '每天' : '每' + h + '小时') + '一次,下次约 ' + (nd && nd > Date.now() ? fmtTime(nd) : '打开 App 时') + ')';
  }
  // 定时选择行
  var sched = document.createElement('div');
  sched.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0 10px;font-size:13px';
  sched.innerHTML = '<span style="opacity:.75;flex:none">定时备份</span><div id="schedSeg" style="flex:1;display:flex;gap:4px"></div>';
  panel.insertBefore(sched, panel.querySelector('.suite-backup-actions'));
  var OPTS = [[0, '关闭'], [2, '2小时'], [6, '6小时'], [24, '每天']];
  function paintSeg() {
    var cur = Backup.getEveryH();
    $('schedSeg').innerHTML = OPTS.map(function (o) {
      var on = o[0] === cur;
      return '<button data-h="' + o[0] + '" style="flex:1;padding:7px 0;font-size:12px;' + (on ? 'background:rgba(56,189,248,.38);border:1px solid rgba(56,189,248,.9);color:#fff;font-weight:700' : 'background:rgba(255,255,255,.08);border:.5px solid rgba(255,255,255,.18);color:rgba(255,255,255,.75)') + '">' + o[1] + '</button>';
    }).join('');
  }
  paintSeg();
  $('schedSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-h]'); if (!b) return;
    Backup.setEveryH(Number(b.dataset.h)); NB.haptic('selection'); paintSeg(); render();
  });

  var expanded = false;
  async function render() {
    var r = await Backup.list(), box = $('vaultList');
    if (!r.ok) { $('vaultSummary').textContent = '读取备份列表失败'; return; }
    var last = Number(localStorage.getItem('lastAutoBackupAt') || 0);
    var brief = $('vaultBrief'); if (brief) brief.textContent = r.files.length ? (r.files.length + ' 份备份 · 最近 ' + (last ? fmtTime(last) : '尚无')) : '尚无备份,点开查看';
    $('vaultSummary').textContent = r.files.length + ' 份备份 · 最近自动备份:' + (last ? fmtTime(last) : '尚无') + schedText();
    if (!r.files.length) { box.innerHTML = ''; return; }
    var shown = expanded ? r.files.slice(0, 30) : r.files.slice(0, 3);
    box.innerHTML = shown.map(function (f) {
      return '<div style="display:flex;align-items:center;gap:6px;padding:8px 0;border-top:.5px solid rgba(255,255,255,.12);font-size:13px">' +
        '<div style="flex:1;min-width:0"><div>' + fmtTime(f.mtime) + ' · ' + kindOf(f.name) + '</div><div style="opacity:.6;font-size:12px">' + fmtSize(f.size) + '</div></div>' +
        '<button data-a="restore" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">恢复</button>' +
        '<button data-a="share" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">导出</button>' +
        '<button data-a="del" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">删除</button></div>';
    }).join('') + (r.files.length > 3 ? '<button data-a="toggle" style="margin-top:6px;padding:6px 14px;font-size:12px;width:100%">' + (expanded ? '收起' : '展开全部 ' + r.files.length + ' 份') + '</button>' : '');
  }
  $('vaultList').addEventListener('click', async function (e) {
    var t = e.target.closest('button[data-a]'); if (!t) return;
    var n = t.dataset.n, a = t.dataset.a;
    if (a === 'toggle') { expanded = !expanded; return render(); }
    if (a === 'share') { await Backup.shareFile(n); }
    else if (a === 'del') { if (confirm('删除这份备份?\n' + n)) { await Backup.remove(n); render(); } }
    else if (a === 'restore') {
      var r = await Backup.read(n); if (!r.ok) return alert('读取失败');
      try {
        var v = await Backup.validate(r.text), s = v.backup.stats || {};
        if (!confirm('用 ' + fmtTime(Date.parse(v.backup.exportedAt)) + ' 的备份覆盖当前全部数据' + (s.records ? '(' + s.records + ' 条记录)' : '') + '?\n恢复前会自动保存快照,失败会回滚。')) return;
        await Backup.restore(r.text); NB.haptic('success'); alert('恢复完成,页面将刷新。'); location.reload();
      } catch (err) { NB.haptic('error'); alert('恢复失败:' + err.message); }
    }
  });
  render();
})();
