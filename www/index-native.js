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
    paintStatus(r.hasUpdate ? '发现新版本 build ' + r.latest : '已是最新版本');
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

  /* ---- 数据与备份面板 ---- */
  var anchor = document.querySelector('.suite-backup-panel'); if (!anchor) return;
  var panel = document.createElement('div');
  panel.className = 'suite-backup-panel'; panel.id = 'vaultPanel'; panel.style.cssText = 'display:block;margin-top:14px';
  panel.innerHTML =
    '<div class="suite-backup-title">自动备份(App 内保险箱)</div>' +
    '<div class="suite-backup-desc" id="vaultSummary" style="margin:4px 0 10px">读取中…</div>' +
    '<div class="suite-backup-actions" style="margin-bottom:10px">' +
    '<button class="suite-backup-btn" id="vaultNow" type="button"><span>🛡️</span><span>立即备份</span></button>' +
    '<button class="suite-backup-btn" id="vaultHap" type="button"><span>📳</span><span id="vaultHapT"></span></button></div>' +
    '<div id="vaultList"></div>' +
    '<div class="suite-backup-desc" style="margin-top:10px;font-size:12px;line-height:1.6">' +
    '备份保存在 App 沙盒的 Documents/Backups,可在“文件”App → 我的 iPhone → Caja 里看到。<br>' +
    '<b>删除 App 会连同备份一起删除</b>,重要数据请用“导出”分享到 iCloud 云盘、AirDrop 或电脑。</div>';
  anchor.parentNode.insertBefore(panel, anchor.nextSibling);
  function paintHap() { $('vaultHapT').textContent = '触觉反馈:' + (localStorage.getItem('haptics') === '0' ? '关' : '开'); }
  paintHap();
  $('vaultHap').onclick = function () { var on = localStorage.getItem('haptics') === '0'; NB.setHaptics(on); paintHap(); if (on) NB.haptic('success'); };
  $('vaultNow').onclick = async function () {
    var b = this; b.disabled = true; var r = await Backup.auto('manual', 'manual'); b.disabled = false;
    if (r.ok) { NB.haptic('success'); } else { NB.haptic('error'); alert(r.empty ? '当前没有任何数据,未生成备份' : '备份失败:' + (r.error || '')); }
    render();
  };
  async function render() {
    var r = await Backup.list(), box = $('vaultList');
    if (!r.ok) { $('vaultSummary').textContent = '读取备份列表失败'; return; }
    var last = Number(localStorage.getItem('lastAutoBackupAt') || 0);
    $('vaultSummary').textContent = r.files.length + ' 份备份 · 最近自动备份:' + (last ? fmtTime(last) : '尚无');
    if (!r.files.length) { box.innerHTML = '<div class="suite-backup-desc">还没有备份。保存数据、退到后台或每 10 分钟会自动生成。</div>'; return; }
    box.innerHTML = r.files.slice(0, 15).map(function (f) {
      return '<div style="display:flex;align-items:center;gap:6px;padding:8px 0;border-top:.5px solid rgba(255,255,255,.12);font-size:13px">' +
        '<div style="flex:1;min-width:0"><div>' + fmtTime(f.mtime) + ' · ' + kindOf(f.name) + '</div><div style="opacity:.6;font-size:12px">' + fmtSize(f.size) + '</div></div>' +
        '<button data-a="restore" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">恢复</button>' +
        '<button data-a="share" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">导出</button>' +
        '<button data-a="del" data-n="' + f.name + '" style="padding:6px 10px;font-size:12px">删除</button></div>';
    }).join('') + (r.files.length > 15 ? '<div class="suite-backup-desc" style="font-size:12px">仅显示最近 15 份,其余在“文件”App 中。</div>' : '');
  }
  $('vaultList').addEventListener('click', async function (e) {
    var t = e.target.closest('button[data-a]'); if (!t) return;
    var n = t.dataset.n, a = t.dataset.a;
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

  /* App 内使用提示:替换掉网页版里关于 Service Worker / PWA 的说明 */
  var tip = document.querySelector('.info-section .info-text');
  if (tip) tip.innerHTML =
    '• 所有页面已打包在 App 内,<strong>无需联网即可使用</strong>,数据只保存在本机<br>' +
    '• 数据会自动备份到 App 的 Documents/Backups,保存后、退到后台、每 10 分钟各备份一次<br>' +
    '• <strong>删除 App 会同时删掉数据和备份</strong>,请定期用“导出”分享到 iCloud 云盘或电脑<br>' +
    '• <strong>从 Safari / 主屏幕网页版迁入</strong>:先在旧版首页点“导出全部备份”保存文件,装好本 App 后点“恢复全部备份”选择该文件<br>' +
    '• 更新新版:在上方点“立即检查更新”,下载后用 AltStore / Sideloadly 重新签名安装,<strong>覆盖安装前请先导出备份</strong>';
})();
