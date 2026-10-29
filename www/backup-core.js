/* 备份核心：整库转储 / 校验 / 恢复 / 自动备份 / 启动自愈。各页面共用。
   数据结构与首页「六系统总备份」完全一致（backupType: management-suite-full-backup），旧备份文件可直接导入。 */
(function () {
  'use strict';
  var DBS = ['financeDB', 'CashAllocationDB', 'CashBoxDB', 'LedgerDB', 'SalaryDB'];
  var SYSTEMS = { finance: ['financeDB', 'CashAllocationDB'], inventory: ['CashBoxDB'], ledger: ['LedgerDB'], payroll: ['SalaryDB'] };
  var NB = function () { return window.NativeBridge; };
  var BK = window.Backup = {};

  function listDbNames() {
    if (!indexedDB.databases) return Promise.resolve(null);
    return indexedDB.databases().then(function (l) { return new Set(l.map(function (x) { return x.name; }).filter(Boolean)); }).catch(function () { return null; });
  }
  function dumpStore(db, name) {
    return new Promise(function (res, rej) {
      try {
        var tx = db.transaction(name, 'readonly'), st = tx.objectStore(name);
        var v = st.getAll(), k = st.getAllKeys();
        tx.oncomplete = function () { var vs = v.result || [], ks = k.result || []; res({ keyPath: st.keyPath, autoIncrement: st.autoIncrement, records: vs.map(function (x, i) { return { key: ks[i], value: x }; }) }); };
        tx.onerror = tx.onabort = function () { rej(tx.error || new Error('读取失败')); };
      } catch (e) { rej(e); }
    });
  }
  function dumpDb(name, existing) {
    return new Promise(function (resolve) {
      if (existing && !existing.has(name)) return resolve({ name: name, exists: false, version: null, stores: {} });
      var created = false, rq = indexedDB.open(name);
      rq.onupgradeneeded = function () { created = true; };
      rq.onerror = function () { resolve({ name: name, exists: false, error: '无法读取', stores: {} }); };
      rq.onblocked = function () { resolve({ name: name, exists: true, error: '被占用', stores: {} }); };
      rq.onsuccess = async function () {
        var db = rq.result;
        if (created && db.objectStoreNames.length === 0) { var ver = db.version; db.close(); indexedDB.deleteDatabase(name); return resolve({ name: name, exists: false, version: ver, stores: {} }); }
        var out = { name: name, exists: true, version: db.version, stores: {} };
        try { for (var sn of Array.from(db.objectStoreNames)) out.stores[sn] = await dumpStore(db, sn); }
        catch (e) { out.error = String(e && e.message || e); }
        finally { db.close(); }
        resolve(out);
      };
    });
  }
  var SKIP_LS = { lastAutoBackupAt: 1, lastAutoTry: 1, backupEveryH: 1, healthDeclined: 1, __mockFiles: 1 };
  function readLS() { var r = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== null && !SKIP_LS[k]) r[k] = localStorage.getItem(k); } return r; }

  function stats(b) {
    var dbs = 0, recs = 0;
    Object.keys(b.systems || {}).forEach(function (s) {
      ((b.systems[s].databases) || []).forEach(function (d) {
        if (d.exists === false) return; dbs++;
        Object.keys(d.stores || {}).forEach(function (n) { recs += (d.stores[n].records || []).length; });
      });
    });
    var bytes = 0;
    Object.keys(b.systems || {}).forEach(function (s) { ((b.systems[s].databases) || []).forEach(function (d) { if (d.exists === false) return; bytes += JSON.stringify(d.stores || {}).length; }); });
    return { dbs: dbs, records: recs, lsKeys: Object.keys(b.localStorageSnapshot || {}).length, bytes: bytes };
  }
  async function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return null;
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  /** 生成完整备份对象（含统计和校验值） */
  BK.snapshot = async function (reason) {
    var existing = await listDbNames(), dumps = {};
    for (var n of DBS) dumps[n] = await dumpDb(n, existing);
    var ls = readLS();
    var b = {
      backupType: 'management-suite-full-backup', version: 1, exportedAt: new Date().toISOString(), reason: reason || 'manual',
      systems: {
        finance: { databases: SYSTEMS.finance.map(function (n) { return dumps[n]; }) },
        splitter: { persistentData: null, note: '大数拆分器不保存持久数据' },
        inventory: { databases: SYSTEMS.inventory.map(function (n) { return dumps[n]; }) },
        ledger: { databases: SYSTEMS.ledger.map(function (n) { return dumps[n]; }) },
        payroll: { databases: SYSTEMS.payroll.map(function (n) { return dumps[n]; }) },
        arrival: { localStorage: { 'fund-arrival-manager-v1': ls['fund-arrival-manager-v1'] == null ? null : ls['fund-arrival-manager-v1'] } }
      },
      localStorageSnapshot: ls
    };
    b.stats = stats(b);
    return b;
  };
  /** 序列化并附校验值：校验的是 stats + 各库内容，写入 integrity 字段 */
  BK.serialize = async function (b) {
    var body = JSON.stringify(Object.assign({}, b, { integrity: undefined }));
    b.integrity = { sha256: await sha256(body), length: body.length };
    return JSON.stringify(b);
  };
  BK.validate = async function (text) {
    var b; try { b = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的 JSON'); }
    if (!b || b.backupType !== 'management-suite-full-backup' || Number(b.version) !== 1) throw new Error('这不是本套件导出的总备份文件');
    var need = ['finance', 'splitter', 'inventory', 'payroll', 'arrival'];
    if (!b.systems || !need.every(function (k) { return k in b.systems; })) throw new Error('备份缺少系统数据');
    if (b.integrity && b.integrity.sha256) {
      var copy = Object.assign({}, b); delete copy.integrity;
      var body = JSON.stringify(Object.assign({}, copy, { integrity: undefined }));
      var h = await sha256(body);
      if (h && h !== b.integrity.sha256) throw new Error('校验失败：文件内容已被改动或损坏');
    }
    var dbs = [];
    ['finance', 'inventory', 'ledger', 'payroll'].forEach(function (s) { dbs = dbs.concat((b.systems[s] && b.systems[s].databases) || []); });
    dbs.forEach(function (d) {
      if (!d || typeof d.name !== 'string' || typeof d.stores !== 'object') throw new Error('备份中的数据库格式不正确');
      Object.keys(d.stores).forEach(function (n) { if (!Array.isArray(d.stores[n].records)) throw new Error('备份中的数据表格式不正确'); });
    });
    return { backup: b, databases: dbs.filter(function (d) { return d.exists !== false; }) };
  };

  function openForRestore(d, existing) {
    return new Promise(function (res, rej) {
      var has = existing ? existing.has(d.name) : true;
      var rq = has ? indexedDB.open(d.name) : indexedDB.open(d.name, Math.max(1, Number(d.version) || 1));
      rq.onupgradeneeded = function () {
        var db = rq.result;
        Object.keys(d.stores).forEach(function (sn) {
          if (!db.objectStoreNames.contains(sn)) { var o = { autoIncrement: !!d.stores[sn].autoIncrement }; if (d.stores[sn].keyPath != null) o.keyPath = d.stores[sn].keyPath; db.createObjectStore(sn, o); }
        });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('无法打开 ' + d.name)); };
      rq.onblocked = function () { rej(new Error(d.name + ' 正被其他页面占用')); };
    });
  }
  function restoreStore(db, sn, sb) {
    return new Promise(function (res, rej) {
      try {
        var tx = db.transaction(sn, 'readwrite'), st = tx.objectStore(sn); st.clear();
        sb.records.forEach(function (r) { if (st.keyPath === null) st.put(r.value, r.key); else st.put(r.value); });
        tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error('恢复失败')); };
      } catch (e) { rej(e); }
    });
  }
  /** 恢复：先做「恢复前快照」，失败则自动回滚 */
  BK.restore = async function (text, opts) {
    opts = opts || {};
    var v = await BK.validate(text);
    var pre = null;
    if (opts.snapshot !== false) {
      pre = await BK.serialize(await BK.snapshot('pre-restore'));
      if (NB() && NB().available) await NB().call('backupWrite', { kind: 'snapshot', text: pre });
    }
    async function apply(parsed) {
      var existing = await listDbNames();
      for (var d of parsed.databases) {
        var db = await openForRestore(d, existing);
        try { for (var sn of Object.keys(d.stores)) { if (!db.objectStoreNames.contains(sn)) throw new Error(d.name + ' 缺少数据表 ' + sn); await restoreStore(db, sn, d.stores[sn]); } }
        finally { db.close(); }
      }
      var ls = parsed.backup.localStorageSnapshot;
      if (ls && typeof ls === 'object') Object.keys(ls).forEach(function (k) { if (typeof ls[k] === 'string') localStorage.setItem(k, ls[k]); });
    }
    try { await apply(v); }
    catch (err) {
      if (pre) { try { await apply(await BK.validate(pre)); } catch (e2) { throw new Error('恢复失败且回滚也失败：' + err.message); } throw new Error('恢复失败，已自动回滚到恢复前状态：' + err.message); }
      throw err;
    }
    return v.backup.stats || stats(v.backup);
  };

  /* ---------- 自动备份 ---------- */
  var lastAutoAt = 0, lastFingerprint = '', busy = false;
  BK.auto = async function (reason, force) {
    if (!(NB() && NB().available)) return { ok: false, error: 'no-native' };
    if (busy) return { ok: false, busy: true };
    busy = true;
    try {
      var b = await BK.snapshot(reason || 'auto');
      if (!b.stats.records && !b.stats.lsKeys) return { ok: false, empty: true };
      // 数据没变就不重复写，避免把滚动保留的旧备份挤掉
      var fp = (await sha256(JSON.stringify(b.systems) + JSON.stringify(b.localStorageSnapshot))) || String(Date.now());
      if (!force && fp === lastFingerprint) return { ok: true, unchanged: true };
      var r = await NB().call('backupWrite', { kind: force === 'manual' ? 'manual' : 'auto', text: await BK.serialize(b) }, 60000);
      if (r.ok) { lastFingerprint = fp; lastAutoAt = Date.now(); localStorage.setItem('lastAutoBackupAt', String(Date.now())); }
      return r;
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    finally { busy = false; }
  };
  BK.list = function () { return NB().call('backupList'); };
  BK.read = function (n) { return NB().call('backupRead', { name: n }, 60000); };
  BK.remove = function (n) { return NB().call('backupDelete', { name: n }); };
  BK.shareFile = function (n) { return NB().call('backupShare', { name: n }); };

  /* ---------- 定时备份 ----------
     iOS 不允许 App 在后台/关闭后运行,所以"定时"= App 开着或回到前台时,距上次备份超过设定间隔就补做一次。
     间隔存在 localStorage.backupEveryH:0=关闭,2 / 6 / 24 小时,默认 6。 */
  BK.getEveryH = function () { var v = localStorage.getItem('backupEveryH'); return v === null ? 6 : Number(v); };
  BK.setEveryH = function (h) { localStorage.setItem('backupEveryH', String(h)); };
  function lastDone() { return Math.max(Number(localStorage.getItem('lastAutoBackupAt') || 0), Number(localStorage.getItem('lastAutoTry') || 0)); }
  BK.nextDue = function () { var h = BK.getEveryH(); return h ? lastDone() + h * 3600 * 1000 : 0; };
  /** 检查是否到点,到点才备份。内容没变化时只更新"已检查"时间,不写文件。 */
  BK.tick = async function (reason) {
    var h = BK.getEveryH(); if (!h) return { ok: false, off: true };
    if (Date.now() < BK.nextDue()) return { ok: false, notDue: true };
    var r = await BK.auto(reason || 'schedule', false);
    // 成功 / 内容没变化 / 当前没有数据:都记一次"已检查",避免每 5 分钟重复检查;失败(写入出错、忙)则不记,下次继续重试
    if (r && (r.ok || r.empty)) localStorage.setItem('lastAutoTry', String(Date.now()));
    return r;
  };
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') BK.tick('foreground'); });
  setInterval(function () { if (document.visibilityState === 'visible') BK.tick('schedule'); }, 5 * 60 * 1000);   // 每 5 分钟只"看一眼是否到点",到点才真备份
  setTimeout(function () { BK.tick('launch'); }, 4000);

  /* ---------- 启动自愈：数据库全空而有备份时，询问是否恢复 ---------- */
  BK.checkHealth = async function () {
    if (!(NB() && NB().available)) return;
    if (sessionStorage.getItem('healthChecked')) return; sessionStorage.setItem('healthChecked', '1');
    var cur = await BK.snapshot('probe');
    if (localStorage.getItem('healthDeclined')) return;       // 用户选择过不恢复
    var l = await BK.list(); if (!l.ok || !l.files.length) return;
    var pick = l.files.find(function (f) { return f.name.indexOf('snapshot_') !== 0; }) || l.files[0];
    var rd = await BK.read(pick.name); if (!rd.ok) return;
    var past; try { past = JSON.parse(rd.text).stats; } catch (e) { return; }
    // 备份里有实质数据,而当前体量不足备份的 25% → 视为疑似数据丢失
    if (!past) return;
    // 疑似丢失 = 备份里有实质数据(≥10 条记录),且当前记录数不到备份的一半,体量也不到 60%
    if (!past.records || past.records < 10) return;
    if (cur.stats.records >= past.records * 0.5) return;
    if (past.bytes && cur.stats.bytes >= past.bytes * 0.6) return;
    var when = new Date(pick.mtime).toLocaleString();
    if (!window.confirm('检测到本地数据明显少于备份(当前约 ' + cur.stats.records + ' 条,备份有 ' + past.records + ' 条),找到了 ' + when + ' 的备份(' + pick.name + ')。\n\n是否从这份备份恢复?')) { localStorage.setItem('healthDeclined', String(Date.now())); return; }
    try { var s = await BK.restore(rd.text); window.alert('已恢复:' + s.dbs + ' 个数据库,' + s.records + ' 条记录。页面将刷新。'); location.reload(); }
    catch (e) { window.alert(e.message); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(BK.checkHealth, 1500); });
  else setTimeout(BK.checkHealth, 1500);
})();
