/* audio.js —— WebAudio 全合成音效 + 可选 BGM（零音频资源文件）
   音效：吃食（随连击升调）/ 冲刺（6 套可切换，循环）/ 撞击 / 获胜和弦 / 失败下行音。「音乐」默认关。
   冲刺音色注册表 SPRINTS：新增音色 = 追加一条 {id,name,build}；选择持久化于 localStorage 'iso-snake-sprint'。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const K = Snake.K, bus = Snake.bus;
  let ac = null, soundOn = true, musicOn = false;
  const winds = {};                       // 冲刺呼啸循环节点，按玩家编号
  let bgmTimer = null, bgmStep = 0;
  const BGM_SEQ = [261.63, 329.63, 392.00, 329.63, 246.94, 311.13, 369.99, 311.13]; // C-E-G-E-B-D-F#‑D 轻柔琶音
  const BGM_STEP = 320;                   // ≈ 90 BPM 八分

  function ctx() {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) { return null; }          // 不支持 WebAudio → 整体静默降级
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => ctx(), { passive: true }));

  function env(g, t0, vol, dur) {         // 简易包络：起音 → 指数衰减
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + .012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function tone(type, f0, f1, dur, vol) { // 振荡器音
    if (!soundOn) return; const a = ctx(); if (!a) return;
    try {
      const t0 = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      env(g, t0, vol || .12, dur);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + .02);
    } catch (e) {}
  }
  function noise(dur, vol, f0, f1) {      // 白噪声 → 带通扫频
    const a = ctx(); if (!a) return;
    try {
      const t0 = a.currentTime, n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = a.createBufferSource(); s.buffer = b;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1; f.frequency.setValueAtTime(f0, t0);
      if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = a.createGain(); env(g, t0, vol, dur);
      s.connect(f); f.connect(g); g.connect(a.destination); s.start(t0);
    } catch (e) {}
  }
  /* ---------- 合成原语（冲刺音色共用） ---------- */
  let nbuf = null;
  function nbufGet(a) {                   // 2 秒白噪声循环缓冲，全局复用
    if (!nbuf) {
      nbuf = a.createBuffer(1, Math.floor(a.sampleRate * 2), a.sampleRate);
      const d = nbuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return nbuf;
  }
  function osc(a, type, f0, f1, ramp, t0) { // 振荡器（指数扫频）
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + ramp);
    o.start(t0); return o;
  }
  function nz(a, t0) { const s = a.createBufferSource(); s.buffer = nbufGet(a); s.loop = true; s.start(t0); return s; }
  function filt(a, type, freq, q) { const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q; return f; }
  function sweep(a, f0, f1, q, ramp, t0) { // 带通扫频
    const f = filt(a, 'bandpass', f0, q);
    f.frequency.setValueAtTime(f0, t0);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + ramp);
    return f;
  }
  function fadeIn(a, t0, vol, atk) {      // 起音包络（冲刺节点统一用它淡入）
    const g = a.createGain();
    g.gain.setValueAtTime(.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (atk || .06));
    return g;
  }
  function lay(a, t0, m, node, rel) { const g = fadeIn(a, t0, rel, .06); node.connect(g); g.connect(m); return g; } // 层 → 相对增益 → 总线
  function lfo(a, target, freq, type, depth, t0) { // 调制增益（AM）或频率（颤音）
    const o = a.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = a.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(target); o.start(t0);
    return { o, g };
  }

  /* ---------- 冲刺音色注册表：6 套可选（纯数据驱动，新增只需追加一条） ---------- */
  const SPRINTS = [
    { id: 'b', name: '喷气', build: function (a, t0) { // 三角波中频上扫，柔和通透
      const m = fadeIn(a, t0, .20, .08); m.connect(a.destination);
      const o = osc(a, 'triangle', 180, 760, .45, t0), f = filt(a, 'lowpass', 2400);
      o.connect(f); lay(a, t0, m, f, .9);
      return { srcs: [o], g: m };
    } },
    { id: 'c', name: '蓄能', build: function (a, t0) { // 正弦上扫 + 13Hz 颤音，充能电子感
      const m = fadeIn(a, t0, .20, .08); m.connect(a.destination);
      const o = osc(a, 'sine', 130, 1050, .45, t0); lay(a, t0, m, o, .9);
      return { srcs: [o], g: m, mods: [lfo(a, m.gain, 13, 'sine', .09, t0)] };
    } },
    { id: 'f', name: '街机', build: function (a, t0) { // 方波上扫 + 低八度，8-bit 加速感
      const m = fadeIn(a, t0, .18, .08); m.connect(a.destination);
      const o1 = osc(a, 'square', 110, 880, .4, t0), f1 = filt(a, 'lowpass', 2600); o1.connect(f1); lay(a, t0, m, f1, .8);
      const o2 = osc(a, 'square', 55, 440, .4, t0), f2 = filt(a, 'lowpass', 1400); o2.connect(f2); lay(a, t0, m, f2, .5);
      return { srcs: [o1, o2], g: m, mods: [lfo(a, m.gain, 26, 'triangle', .063, t0)] };
    } },
    { id: 'g', name: '脉冲', build: function (a, t0) { // 带通噪底 + 低频锯齿 + 16Hz 方波脉冲
      const m = fadeIn(a, t0, .24, .08); m.connect(a.destination);
      const n = nz(a, t0), b = sweep(a, 500, 2600, 2, .5, t0); n.connect(b); lay(a, t0, m, b, .7);
      const o = osc(a, 'sawtooth', 70, 210, .5, t0), f = filt(a, 'lowpass', 700); o.connect(f); lay(a, t0, m, f, .5);
      return { srcs: [n, o], g: m, mods: [lfo(a, m.gain, 16, 'square', .19, t0)] };
    } },
    { id: 'h', name: '引擎', build: function (a, t0) { // 三层失谐锯齿 + 低通扫频 + 气流，低频最厚
      const m = fadeIn(a, t0, .24, .08); m.connect(a.destination);
      const s1 = osc(a, 'sawtooth', 55, 180, .55, t0),
            s2 = osc(a, 'sawtooth', 55.55, 181.8, .55, t0),
            s3 = osc(a, 'sawtooth', 54.45, 178.2, .55, t0);
      const f = filt(a, 'lowpass', 300);
      f.frequency.setValueAtTime(300, t0); f.frequency.linearRampToValueAtTime(1700, t0 + .55);
      s1.connect(f); s2.connect(f); s3.connect(f); lay(a, t0, m, f, .9);
      const n = nz(a, t0), b = sweep(a, 400, 2400, 1, .5, t0), ng = fadeIn(a, t0, .22, .06);
      n.connect(b); b.connect(ng); ng.connect(m);
      return { srcs: [s1, s2, s3, n], g: m, mods: [lfo(a, s1.frequency, 7, 'sine', 10, t0)] };
    } },
    { id: 'i', name: '电弧', build: function (a, t0) { // 高通锯齿 + 高频噼啪 + 31Hz 调制，电流感
      const m = fadeIn(a, t0, .20, .08); m.connect(a.destination);
      const o = osc(a, 'sawtooth', 60, 380, .5, t0), hp = filt(a, 'highpass', 200); o.connect(hp); lay(a, t0, m, hp, .85);
      const n = nz(a, t0), b = sweep(a, 2600, 5600, 8, .4, t0), ng = fadeIn(a, t0, .30, .06);
      n.connect(b); b.connect(ng); ng.connect(m);
      return { srcs: [o, n], g: m, mods: [lfo(a, m.gain, 31, 'square', .10, t0)] };
    } }
  ];
  const SPR_IDS = SPRINTS.map(s => s.id), SPR_DEF = 'b';
  let sprintId = SPR_DEF;
  const sprSpec = () => SPRINTS[Math.max(0, SPR_IDS.indexOf(sprintId))];

  function windStart(i) {                 // 冲刺呼啸：按当前选择的音色建循环，冲刺期间持续
    if (!soundOn) return; const a = ctx(); if (!a || winds[i]) return;
    try { winds[i] = sprSpec().build(a, a.currentTime); } catch (e) {}
  }
  function windStop(i) {
    const w = winds[i]; if (!w) return;
    try {
      const a = ctx(), t0 = a ? a.currentTime : 0;
      (w.mods || []).forEach(mm => { // 先摘掉调制，避免释放段增益被 LFO 拉偏
        try { mm.g.gain.cancelScheduledValues(t0); mm.g.gain.setValueAtTime(0, t0); mm.o.stop(t0 + .2); } catch (e) {}
      });
      w.g.gain.cancelScheduledValues(t0);
      w.g.gain.setValueAtTime(Math.max(w.g.gain.value, .0001), t0);
      w.g.gain.exponentialRampToValueAtTime(.0001, t0 + .15);
      w.srcs.forEach(s => { try { s.stop(t0 + .2); } catch (e) {} });
    } catch (e) {}
    delete winds[i];
  }
  function stopAllWinds() { Object.keys(winds).forEach(i => windStop(+i)); }
  /* ---------- BGM：三角波琶音循环，低增益 ---------- */
  function bgmTick() {
    if (!musicOn) return; const a = ctx(); if (!a) return;
    const f = BGM_SEQ[bgmStep++ % BGM_SEQ.length];
    try {
      const t0 = a.currentTime, o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t0);
      env(g, t0, .045, .52);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + .56);
    } catch (e) {}
  }
  function bgmStart() { if (!bgmTimer && musicOn) { bgmTick(); bgmTimer = setInterval(bgmTick, BGM_STEP); } }
  function bgmStop() { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

  function init() {
    soundOn = K.safeGet('iso-snake-snd', '1') !== '0';
    musicOn = K.safeGet('iso-snake-music', '0') === '1';
    const snd = document.getElementById('snd'), mus = document.getElementById('mus');
    const label = (b, on, t) => { b.textContent = t; b.classList.toggle('off', !on); b.title = t + '：' + (on ? '开' : '关'); };   // 短文案省宽度，开关态用 .off 置灰 + title
    label(snd, soundOn, '音效'); label(mus, musicOn, '音乐');
    snd.addEventListener('click', e => {
      soundOn = !soundOn; K.safeSet('iso-snake-snd', soundOn ? '1' : '0'); label(snd, soundOn, '音效'); snd.blur();
      if (!soundOn) stopAllWinds();
    });
    mus.addEventListener('click', e => {
      musicOn = !musicOn; K.safeSet('iso-snake-music', musicOn ? '1' : '0'); label(mus, musicOn, '音乐'); mus.blur();
      musicOn ? bgmStart() : bgmStop();
    });
    sprintId = K.safeGet('iso-snake-sprint', SPR_DEF);       // 冲刺音色：选择持久化，非法值回退默认
    if (SPR_IDS.indexOf(sprintId) < 0) sprintId = SPR_DEF;
    const spr = document.getElementById('spr');
    if (spr) {
      spr.value = sprintId;
      spr.addEventListener('change', () => { sprintId = spr.value; K.safeSet('iso-snake-sprint', sprintId); spr.blur(); });
    }
    bus.on('eat', e => {   // 吃食：基础音高随连击阶梯升调（上限后循环）；金苹果 = 高音闪烁琶音
      if (e.gold) { [880, 1174.66, 1567.98].forEach((f, k) => setTimeout(() => tone('triangle', f, f, .12, .1), k * 55)); return; }
      const h = 440 * Math.pow(2, (Math.min(e.streak, 10) - 1) / 12);
      tone('sine', h, h * 1.5, .18, .16);
    });
    bus.on('sprintOn', e => windStart(e.i));
    bus.on('sprintOff', e => windStop(e.i));
    bus.on('sprintLock', e => { windStop(e.i); tone('square', 300, 120, .22, .06); });
    bus.on('crash', () => { stopAllWinds(); noise(.3, .28, 900, 180); });
    bus.on('win', () => [523.25, 659.25, 783.99].forEach((f, k) => setTimeout(() => tone('triangle', f, f, .24, .14), k * 110))); // 上行大三和弦三连音
    bus.on('lose', () => [392, 261.63].forEach((f, k) => setTimeout(() => tone('sine', f, f * .96, .3, .12), k * 200)));   // 下行双音
    if (musicOn) bgmStart();
  }
  Snake.Audio = { init };
})();