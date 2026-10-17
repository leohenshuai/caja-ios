/* 自制键盘增强:底部加「复制 / 粘贴」两个按钮 + 键盘声音设置(语速、音量)。
   新按钮用 data-act 而不是 data-k,页面自己的数字输入逻辑不会碰到它们。 */
(function () {
  'use strict';
  var kp = document.getElementById('vk-keypad');
  if (!kp || kp.__extra) return; kp.__extra = true;
  var NB = window.NativeBridge;

  /* ---------- 复制 / 粘贴 按钮 ---------- */
  var bar = document.createElement('div');
  bar.className = 'vk-extra';
  bar.innerHTML =
    '<button type="button" data-act="copy">复制</button>' +
    '<button type="button" data-act="paste">粘贴</button>';
  kp.appendChild(bar);

  function target() {                     // 当前正在输入的框(键盘只对 text/number 输入框生效)
    var a = document.activeElement;
    return a && a.tagName === 'INPUT' ? a : null;
  }
  function toast(msg) {
    var t = document.querySelector('.toast');
    if (t) { t.textContent = msg; t.className = 'toast success show'; clearTimeout(t._k); t._k = setTimeout(function () { t.classList.remove('show'); }, 1400); }
  }
  function writeClip(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('no clipboard'));
  }
  function readClip() {
    if (navigator.clipboard && navigator.clipboard.readText) return navigator.clipboard.readText();
    return Promise.reject(new Error('no clipboard'));
  }
  function doCopy() {
    var el = target(); if (!el) return;
    var s = el.selectionStart, e = el.selectionEnd;
    var text = (s != null && e != null && s !== e) ? el.value.slice(s, e) : el.value;   // 有选区复制选区,否则复制整个输入框
    if (!text) { toast('输入框是空的'); return; }
    writeClip(text).then(function () { toast('已复制:' + (text.length > 14 ? text.slice(0, 14) + '…' : text)); if (NB && NB.haptic) NB.haptic('success'); })
      .catch(function () { toast('复制失败'); if (NB && NB.haptic) NB.haptic('error'); });
  }
  function doPaste() {
    var el = target(); if (!el) return;
    readClip().then(function (text) {
      if (!text) { toast('剪贴板是空的'); return; }
      // 只允许键盘本来就能输入的字符:数字、小数点、千分位逗号、空格(空格用于"求和"写法)。
      // 含其他符号(+ - * / 字母 汉字等)时,只提取其中的数字部分,并提示用户,避免把算式拼成一个错误的大数。
      var raw = String(text).trim();
      var hasOther = /[^\d.,\s\u00a0]/.test(raw);
      var clean = raw.replace(/[^\d.,\s\u00a0]/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (hasOther) { var m = raw.match(/\d[\d,]*(?:\.\d+)?/g); clean = m ? m.join(' ') : ''; }
      if (!clean) { toast('剪贴板里没有可粘贴的数字'); if (NB && NB.haptic) NB.haptic('warning'); return; }
      var s = el.selectionStart != null ? el.selectionStart : el.value.length;
      var e = el.selectionEnd != null ? el.selectionEnd : s;
      el.value = el.value.slice(0, s) + clean + el.value.slice(e);
      var pos = s + clean.length; try { el.setSelectionRange(pos, pos); } catch (_) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));            // 让实时求和、千分位等原有逻辑照常工作
      toast('已粘贴' + (hasOther ? '(已提取其中的数字)' : ''));
      if (NB && NB.haptic) NB.haptic('success');
    }).catch(function () { toast('无法读取剪贴板'); if (NB && NB.haptic) NB.haptic('error'); });
  }
  function onAct(e) {
    var b = e.target.closest && e.target.closest('button[data-act]'); if (!b) return;
    var act = b.dataset.act;
    if (act !== 'copy' && act !== 'paste') return;                         // 齿轮等其它按钮交给各自的处理函数
    e.preventDefault(); e.stopPropagation();
    if (b.__t && Date.now() - b.__t < 400) return; b.__t = Date.now();    // pointerup 与 click 去重
    if (act === 'copy') doCopy(); else doPaste();
  }
  // 与页面自己的键盘事件同样的拦截方式:阻止失焦,避免点按钮时输入框丢焦点
  bar.addEventListener('pointerdown', function (e) { e.preventDefault(); if (NB && NB.haptic) NB.haptic('medium'); if (NB && NB.available) NB.call('sound', { type: 'tap' }); }, true);
  bar.addEventListener('pointerup', onAct, true);
  bar.addEventListener('click', onAct, true);
  bar.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
  bar.addEventListener('touchend', function (e) { e.preventDefault(); }, { passive: false });

  /* ---------- 键盘声音设置:语速 / 音量 ---------- */
  if (!(NB && NB.available)) return;
  var gear = document.createElement('button');
  gear.type = 'button'; gear.className = 'vk-gear'; gear.dataset.act = 'gear'; gear.textContent = '⚙︎'; gear.title = '键盘声音设置';
  bar.appendChild(gear);
  var panel = document.createElement('div');
  panel.className = 'vk-voice-panel';
  panel.innerHTML =
    '<div class="vvp-row"><span>语速</span><input type="range" id="vvpRate" min="0.6" max="1.8" step="0.05"><b id="vvpRateV"></b></div>' +
    '<div class="vvp-row"><span>音量</span><input type="range" id="vvpVol" min="0" max="1" step="0.05"><b id="vvpVolV"></b></div>' +
    '<div class="vvp-row vvp-btns"><button type="button" data-act="vvptest">试听 "一二三"</button><button type="button" data-act="vvpreset">恢复默认</button><button type="button" data-act="vvpclose">完成</button></div>';
  kp.appendChild(panel);
  var rate = panel.querySelector('#vvpRate'), vol = panel.querySelector('#vvpVol');
  function paint() {
    rate.value = NB.getVoiceRate(); vol.value = NB.getVoiceVol();
    panel.querySelector('#vvpRateV').textContent = Number(rate.value).toFixed(2) + '×';
    panel.querySelector('#vvpVolV').textContent = Math.round(vol.value * 100) + '%';
  }
  function testSay() {
    ['1', '2', '3'].forEach(function (k, i) { setTimeout(function () { NB.call('speak', { text: k, key: k, rate: NB.getVoiceRate(), vol: NB.getVoiceVol() }); }, i * 260); });
  }
  rate.addEventListener('input', function () { NB.setVoiceRate(Number(rate.value)); paint(); });
  vol.addEventListener('input', function () { NB.setVoiceVol(Number(vol.value)); paint(); });
  rate.addEventListener('change', testSay); vol.addEventListener('change', testSay);
  function onPanel(e) {
    var b = e.target.closest && e.target.closest('button[data-act]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.__t && Date.now() - b.__t < 400) return; b.__t = Date.now();
    var a = b.dataset.act;
    if (a === 'gear') { panel.classList.toggle('open'); paint(); }
    else if (a === 'vvpclose') panel.classList.remove('open');
    else if (a === 'vvptest') testSay();
    else if (a === 'vvpreset') { NB.setVoiceRate(1.0); NB.setVoiceVol(1.0); paint(); testSay(); }
  }
  [panel, gear].forEach(function (n) {
    n.addEventListener('pointerdown', function (e) { if (!(e.target.tagName === 'INPUT')) e.preventDefault(); }, true);
    n.addEventListener('pointerup', onPanel, true);
    n.addEventListener('click', onPanel, true);
  });
  // 键盘收起时一并收起设置面板
  new MutationObserver(function () { if (!kp.classList.contains('vk-show')) panel.classList.remove('open'); }).observe(kp, { attributes: true, attributeFilter: ['class'] });
  paint();
})();
