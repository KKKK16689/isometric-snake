/* integration.test.mjs —— DOM 集成层冒烟测试（零依赖，node --test）
   用最小 DOM / Canvas2D / WebAudio 桩按 src/index.html 的真实顺序加载全部 8 个模块，
   确定性驱动 rAF 帧循环与事件，跑通渲染、输入、音频、主题的完整代码路径。
   抓的是 vm 纯逻辑测试抓不到的集成 bug：元素 id 打错、draw 路径笔误、启动顺序依赖。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const DIR = import.meta.dirname;
const SRC = path.join(DIR, '..', 'src', 'js');
const FILES = ['core', 'themes', 'patterns', 'audio', 'particles', 'render', 'ai', 'input'];   // index.html 的 <script> 顺序
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/* ---------- 最小 DOM 桩 ---------- */
function El(tag) {
  const el = {
    tagName: tag, id: '', children: [], dataset: {}, disabled: false, value: '', title: '',
    textContent: '', innerHTML: '', className: '',
    style: { setProperty(k, v) { this[k] = v; } },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    _h: {},
    addEventListener(t, fn) { (this._h[t] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this[k] = v; },
    blur() {}, focus() {}, select() {}, setPointerCapture() {}, releasePointerCapture() {},
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    firstElementChild: null, parentElement: null, clientWidth: 0, clientHeight: 0,
  };
  return el;
}

function makeDom(opts = {}) {
  const C = { fillRect: 0, drawImage: 0, fillText: 0 };   // 绘制计数器：证明渲染管线真的跑了
  const grad = { addColorStop() {} };
  const noop = () => {};
  function makeCtx(cvEl) {
    const N = { fillRect: 0, fill: 0, stroke: 0, clearRect: 0, drawImage: 0 };   // 本画布计数器：验证“静态层不逐帧重画”
    return {
      _n: N,
      canvas: cvEl,
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
      shadowBlur: 0, shadowColor: '', font: '', textAlign: 'start', textBaseline: 'alphabetic',
      filter: 'none', lineCap: 'butt', lineJoin: 'miter', imageSmoothingEnabled: true,
      save: noop, restore: noop, translate: noop, scale: noop, rotate: noop, setTransform: noop, transform: noop,
      clearRect: () => { N.clearRect++; }, fillRect: () => { C.fillRect++; N.fillRect++; }, strokeRect: noop,
      beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop, rect: noop,
      quadraticCurveTo: noop, bezierCurveTo: noop, fill: () => { N.fill++; }, stroke: () => { N.stroke++; }, clip: noop, setLineDash: noop,
      fillText: () => { C.fillText++; }, strokeText: noop, measureText: t => ({ width: (t ? String(t).length : 0) * 8 }),
      drawImage: () => { C.drawImage++; N.drawImage++; },
      createRadialGradient: () => grad, createLinearGradient: () => grad, createPattern: () => null,
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: noop,
    };
  }
  function makeCanvas(el) { el.width = 300; el.height = 150; el.getContext = () => (el._ctx ||= makeCtx(el)); return el; }

  /* 固定元素树：与 src/index.html 一一对应；未知 id 返回 null（打错 id 会当场炸出来） */
  const byId = {};
  ['hl', 'hr', 'fs', 'snd', 'mus', 'vib', 'daily', 'ghost', 'copy', 'aiLv', 'hint', 'toast', 'live'].forEach(id => { byId[id] = El('span'); byId[id].id = id; });
  byId.spr = El('select'); byId.spr.id = 'spr'; byId.spr.value = 'b';
  const cv = byId.c = El('canvas'); makeCanvas(cv);
  const eb0 = El('div'), eb1 = El('div'); eb0.firstElementChild = El('i'); eb1.firstElementChild = El('i');
  const pad0 = El('div'), pad1 = El('div'); pad0.dataset.p = '0'; pad1.dataset.p = '1';
  const sp0 = El('button'), sp1 = El('button'); sp0.parentElement = pad0; sp1.parentElement = pad1;
  const dataBtns = [];
  [pad0, pad1].forEach(pad => ['up', 'left', 'down', 'right'].forEach(s => { const b = El('button'); b.dataset.s = s; b.parentElement = pad; dataBtns.push(b); }));
  const cmp0 = El('div'), cmp1 = El('div'), hd0 = El('i'), hd1 = El('i'), fd0 = El('b'), fd1 = El('b');
  const sw0 = El('div'), sw1 = El('div'); sw0.dataset.p = '0'; sw1.dataset.p = '1';
  const modeBtns = ['easy', 'normal', 'pk', 'ai'].map(m => { const b = El('button'); b.dataset.m = m; return b; });
  const mainEl = El('main'); mainEl.clientWidth = opts.main?.w ?? 1280; mainEl.clientHeight = opts.main?.h ?? 900;
  /* Stage 0：canvas 实测尺寸——沉浸模式取 fitCanvas 写入的内联像素；列式回退 opts.rect → main 尺寸 */
  const rect = { width: opts.rect?.width ?? 0, height: opts.rect?.height ?? 0 };
  cv.getBoundingClientRect = () => {
    const sw = parseFloat(cv.style.width) || 0, sh = parseFloat(cv.style.height) || 0;
    const rw = (sw > 0 && sh > 0) ? sw : (rect.width || mainEl.clientWidth);
    const rh = (sw > 0 && sh > 0) ? sh : (rect.height || mainEl.clientHeight);
    return { width: rw, height: rh, top: 0, left: 0, right: rw, bottom: rh, x: 0, y: 0 };
  };
  mainEl.getBoundingClientRect = () => ({ width: mainEl.clientWidth, height: mainEl.clientHeight, top: 0, left: 0, right: mainEl.clientWidth, bottom: mainEl.clientHeight, x: 0, y: 0 });
  cv.offsetParent = mainEl;                            // Stage 0.1：动态层按静态层的 offsetParent 定位（真实页面里是 .stage 或 main）
  const thEl = El('div'), metaEl = El('meta');
  const qsaMap = {
    '.eb': [eb0, eb1], '.pad .sp': [sp0, sp1], '.cmp .hd': [hd0, hd1], '.cmp .fd': [fd0, fd1], '.cmp': [cmp0, cmp1],
    '.sw': [sw0, sw1], '.pad button[data-s]': dataBtns, '.mode button[data-m]': modeBtns,
  };
  const qsMap = { 'main': mainEl, 'meta[name="theme-color"]': metaEl, '.th': thEl };
  const docH = {}, created = [];   // created：createElement 产出的元素（含 Stage 0.1 的动态层画布 #cd）
  const document_ = {
    hidden: false, fullscreenElement: null,
    documentElement: El('html'), body: El('body'),
    getElementById: id => byId[id] ?? null,
    querySelector: sel => qsMap[sel] ?? null,
    querySelectorAll: sel => qsaMap[sel] ?? [],
    createElement: tag => { const el = tag === 'canvas' ? makeCanvas(El(tag)) : El(tag); created.push(el); return el; },
    addEventListener: (t, fn) => { (docH[t] ||= []).push(fn); },
    execCommand: () => true, exitFullscreen: noop,
  };

  /* 确定性时钟与定时器：setInterval 只登记不触发（BGM 不参与断言，测试进程不挂起） */
  const store = new Map(Object.entries(opts.store || {}));
  let timers = [], tid = 1, rafCb = null;
  const copied = [], vibes = [];
  const sb = { __t: 1000 };
  sb.window = sb;
  sb.console = console;
  sb.URLSearchParams = URLSearchParams;
  sb.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
  sb.location = { search: opts.search || '', protocol: 'http:', href: 'http://127.0.0.1:8642/' };
  sb.performance = { now: () => sb.__t };
  sb.navigator = { userAgent: 'node', standalone: false, vibrate: ms => { vibes.push(ms); return true; }, clipboard: { writeText: t => { copied.push(t); return Promise.resolve(); } } };
  sb.devicePixelRatio = opts.dpr ?? 2; sb.innerWidth = 1280; sb.innerHeight = 900;
  sb.document = document_;
  sb.matchMedia = q => ({
    media: q,
    matches: /prefers-reduced-motion/.test(q) ? !!opts.reduce
      : /display-mode: standalone/.test(q) ? !!opts.standalone
      : /pointer: coarse/.test(q) ? !!opts.coarse
      : /orientation|min-width/.test(q) ? opts.wide !== false : false,
    addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop,
  });
  const winH = {};
  sb.addEventListener = (t, fn) => { (winH[t] ||= []).push(fn); };
  sb.removeEventListener = noop;
  const roList = [], vvH = {};                        // Stage 0：容器观察者 / 视觉视口事件登记（测试可手动触发）
  sb.ResizeObserver = class { constructor(cb) { this.cb = cb; roList.push(this); } observe() {} unobserve() {} disconnect() {} };
  sb.visualViewport = { width: 0, height: 0, addEventListener: (t, fn) => { (vvH[t] ||= []).push(fn); }, removeEventListener: noop };
  sb.requestAnimationFrame = cb => { rafCb = cb; return 1; };
  sb.cancelAnimationFrame = () => { rafCb = null; };
  sb.setTimeout = (cb, ms) => { const id = tid++; timers.push({ id, due: sb.__t + (+ms || 0), cb }); return id; };
  sb.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
  sb.setInterval = () => tid++;
  sb.clearInterval = noop;
  const param = () => ({ value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop, cancelScheduledValues: noop, setTargetAtTime: noop });
  const node = extra => Object.assign({ connect: noop, disconnect: noop, start: noop, stop: noop }, extra);
  sb.AudioContext = class {
    constructor() { this.state = 'running'; this.sampleRate = 44100; this.destination = node({}); }
    get currentTime() { return sb.__t / 1000; }
    resume() { return Promise.resolve(); }
    createOscillator() { return node({ type: 'sine', frequency: param() }); }
    createGain() { return node({ gain: param() }); }
    createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d, length: n, numberOfChannels: ch, sampleRate: 44100 }; }
    createBufferSource() { return node({ buffer: null, loop: false }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(), Q: param(), gain: param() }); }
  };

  vm.createContext(sb);
  if (opts.scripts) for (const s of opts.scripts) vm.runInContext(s.code, sb, { filename: s.name });   // 构建产物模式：直接执行内联脚本（含启动块）
  else for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), sb, { filename: f + '.js' });

  /* ---------- 驱动辅助 ---------- */
  function flushTimers() {
    for (;;) {
      const due = timers.filter(t => t.due <= sb.__t).sort((a, b) => a.due - b.due);
      if (!due.length) return;
      const t = due[0]; timers = timers.filter(x => x.id !== t.id); t.cb();
    }
  }
  function drive(n, dt = 16.7) { for (let i = 0; i < n; i++) { sb.__t += dt; const cb = rafCb; rafCb = null; if (cb) cb(sb.__t); flushTimers(); } }
  function fireWin(t, ev) { (winH[t] || []).forEach(fn => fn(ev)); }
  function fireDoc(t, ev) { (docH[t] || []).forEach(fn => fn(ev)); }
  function fireEl(el, t, ev) { (el._h[t] || []).forEach(fn => fn(Object.assign({ currentTarget: el, target: el, preventDefault: noop, stopPropagation: noop }, ev))); }
  const clickEl = el => fireEl(el, 'click', {});
  const key = code => fireWin('keydown', { code, preventDefault: noop });
  const keyUp = code => fireWin('keyup', { code, preventDefault: noop });

  return { sb, S: sb.Snake.S, api: sb.Snake.api, byId, C, copied, vibes, store, created, drive, fireWin, fireDoc, fireEl, clickEl, key, keyUp, flushTimers, document: document_, modeBtns, dataBtns, sp0, sp1, cv, thEl, mainEl, rect, roList, vvH };
}

function boot(H) {   // 与 src/index.html 内联启动块完全一致的顺序
  const { Snake } = H.sb;
  Snake.theme.init(); Snake.Ai.init(); Snake.Audio.init(); Snake.UI.init(); Snake.Render.boot(); Snake.api.reset();
}
function safeSteer(S, p) {   // 注入一个安全转向（非掉头、界内、不压身）
  const h = p.body[0], occ = new Set(); p.body.forEach(s => occ.add(s.x * 1024 + s.y));
  for (const d of DIRS) {
    if (d[0] === -p.dir[0] && d[1] === -p.dir[1]) continue;
    const nx = h.x + d[0], ny = h.y + d[1];
    if (nx < 0 || ny < 0 || nx >= S.N || ny >= S.N || occ.has(nx * 1024 + ny)) continue;
    p.queue = [d]; return true;
  }
  return false;
}
const nextDir = p => (p.queue.length ? p.queue[p.queue.length - 1] : p.dir);
/* Stage 0 契约：像素预算（移动 4.5M / 桌面 8M）与 dprEff 公式（与 render.js 同式，做回归锚点） */
const MAX_PX = (w, h, coarse) => ((coarse || Math.min(w, h) < 600) ? 4.5e6 : 8e6);
function dprEffFor(w, h, dpr, coarse) { return Math.max(1, Math.min(dpr, 3, Math.sqrt(MAX_PX(w, h, coarse) / Math.max(1, w * h)))); }
/* 自动驾驶：每帧保命转向 + 把食物放到下一步落点（确定性吃食）；over 自动重开 */
function autoPlay(H, frames, { feed = true } = {}) {
  const { S, api } = H;
  let eats = 0; H.sb.Snake.bus.on('eat', () => eats++);
  for (let i = 0; i < frames; i++) {
    if (S.state === 'over') { api.newGame(); api.start(); }
    if (S.state === 'paused') api.togglePause();
    const p = S.pl[0];
    if (p && S.state === 'playing') {
      let d = nextDir(p); const h = p.body[0];
      const nx = h.x + d[0], ny = h.y + d[1];
      const occ = new Set(); p.body.forEach(s => occ.add(s.x * 1024 + s.y));
      if (nx < 0 || ny < 0 || nx >= S.N || ny >= S.N || occ.has(nx * 1024 + ny)) { safeSteer(S, p); d = nextDir(p); }
      if (feed && S.state === 'playing') { S.foods.length = 1; S.foods[0] = { x: h.x + d[0], y: h.y + d[1] }; }
    }
    H.drive(1);
  }
  return eats;
}

/* ---------- 用例 ---------- */
test('集成：启动 + 键盘开局 + 确定性吃食 + 连击 HUD + 震动', () => {
  const H = makeDom(); boot(H);
  H.drive(30);                                   // ready 覆盖层渲染
  assert.equal(H.S.state, 'ready');
  assert.ok(H.C.fillRect > 0 && H.C.drawImage > 0, '渲染管线未执行');
  assert.ok(H.byId.hl.innerHTML.includes('得分'), 'HUD 未更新');

  H.key('KeyW');                                 // 方向键自动开局（core.press 先 start）
  assert.equal(H.S.state, 'playing');
  const eats = autoPlay(H, 260);                 // ≈4s：确定性连吃
  assert.ok(eats >= 2, '吃食路径未触发（eats=' + eats + '）');
  assert.ok(H.byId.hl.innerHTML.includes('连击'), '连击未上 HUD');
  assert.ok(H.vibes.length > 0, '吃食震动未触发');
  H.key('Space'); assert.equal(H.S.state, 'paused');
  H.key('Space'); assert.equal(H.S.state, 'playing');
  H.drive(30);
});

test('集成：UI 按钮全点一遍（音效/音乐/震动/全屏/提示/AI 档/模式/每日/幽灵/复制）', () => {
  const H = makeDom(); boot(H);
  H.clickEl(H.byId.snd); assert.equal(H.byId.snd.textContent, '音效');
  assert.ok(H.byId.snd.classList.contains('off'), '音效关闭后应置灰'); assert.equal(H.byId.snd.title, '音效：关');
  H.clickEl(H.byId.snd); assert.ok(!H.byId.snd.classList.contains('off'), '音效开启后应恢复');
  H.clickEl(H.byId.mus); assert.ok(!H.byId.mus.classList.contains('off'));
  H.drive(20);
  H.clickEl(H.byId.mus); assert.ok(H.byId.mus.classList.contains('off'));
  H.clickEl(H.byId.vib); assert.ok(H.byId.vib.classList.contains('off'), '震动关闭后应置灰');
  assert.equal(H.store.get('iso-snake-vib'), '0');
  H.clickEl(H.byId.vib); assert.ok(H.vibes.includes(12), '开启震动未确认反馈');
  H.clickEl(H.byId.fs);                          // 无 requestFullscreen → 弹主屏提示
  assert.ok(H.byId.hint.classList.contains('show'));
  H.clickEl(H.byId.hint); assert.ok(!H.byId.hint.classList.contains('show'));
  const lv0 = H.byId.aiLv.textContent;
  H.clickEl(H.byId.aiLv); assert.notEqual(H.byId.aiLv.textContent, lv0);
  H.clickEl(H.byId.aiLv); H.clickEl(H.byId.aiLv);
  const pk = H.modeBtns.find(b => b.dataset.m === 'pk');
  H.clickEl(pk);
  assert.equal(H.S.mode, 'pk');
  assert.ok(H.document.body.classList.contains('pk'));
  H.clickEl(H.modeBtns.find(b => b.dataset.m === 'normal'));
  H.clickEl(H.byId.daily);
  assert.ok(H.S.daily && H.S.seed > 0);
  assert.ok(H.byId.toast.textContent.includes('每日挑战') && H.byId.toast.classList.contains('show'));
  H.drive(130);                                  // >1800ms：toast 自动隐藏
  assert.ok(!H.byId.toast.classList.contains('show'));
  H.clickEl(H.byId.ghost);                       // 无存档 → 提示且不切换
  assert.ok(H.byId.toast.textContent.includes('还没有幽灵数据'));
  assert.equal(H.S.ghostOn, false);
  H.clickEl(H.byId.copy);
  H.drive(2);
  assert.ok(H.copied.length === 1 && H.copied[0].includes('等距贪吃蛇'), '复制文案异常: ' + H.copied[0]);
});

test('集成：触屏（pad/滑动/点按）+ 冲刺键 + resize + 切后台暂停', () => {
  const H = makeDom(); boot(H);
  H.api.start(); H.drive(10);
  H.fireEl(H.dataBtns[0], 'pointerdown', {});    // pad 方向键
  H.fireEl(H.sp0, 'pointerdown', { pointerId: 1 });
  assert.equal(H.S.pl[0].hold, true);
  H.fireEl(H.sp0, 'pointerup', {});
  assert.equal(H.S.pl[0].hold, false);
  H.fireEl(H.sp0, 'contextmenu', {});
  H.key('ShiftLeft'); assert.equal(H.S.pl[0].hold, true);
  H.keyUp('ShiftLeft'); assert.equal(H.S.pl[0].hold, false);
  H.fireWin('blur', {});
  // 滑动转向：60px 横向
  H.fireEl(H.cv, 'pointerdown', { clientX: 100, clientY: 100 });
  H.drive(3);
  H.fireEl(H.cv, 'pointerup', { clientX: 170, clientY: 100 });
  H.drive(2);
  // 滑动转向现在「越过阈值」就生效，不必等抬手（手感：少等一整个手势的时间）
  let pressed = null; const realPress = H.sb.Snake.api.press;
  H.sb.Snake.api.press = (i, name) => { pressed = name; return realPress(i, name); };
  H.fireEl(H.cv, 'pointerdown', { clientX: 100, clientY: 100, pointerType: 'touch' });
  H.fireEl(H.cv, 'pointermove', { clientX: 140, clientY: 100, pointerType: 'touch', buttons: 0 });
  assert.equal(pressed, 'right', '越过阈值应立即转向（不必等抬手）');
  pressed = null;
  H.fireEl(H.cv, 'pointermove', { clientX: 200, clientY: 100, pointerType: 'touch', buttons: 0 });
  assert.equal(pressed, null, '同一次手势只触发一次转向');
  H.fireEl(H.cv, 'pointerup', { clientX: 200, clientY: 100, pointerType: 'touch' });
  assert.equal(H.S.state, 'playing', '滑动手势抬手不应误触暂停');
  H.fireEl(H.cv, 'pointerdown', { clientX: 300, clientY: 300, pointerType: 'mouse' });
  H.fireEl(H.cv, 'pointermove', { clientX: 400, clientY: 300, pointerType: 'mouse', buttons: 0 });
  assert.equal(pressed, null, '鼠标未按下时移动不应转向');
  H.sb.Snake.api.press = realPress;
  // 点按暂停：<16px 且 <300ms
  H.fireEl(H.cv, 'pointerdown', { clientX: 200, clientY: 200 });
  H.drive(1);
  H.fireEl(H.cv, 'pointerup', { clientX: 204, clientY: 204 });
  assert.equal(H.S.state, 'paused', '点按未暂停');
  H.api.togglePause();
  // resize：canvas 背店按“实测显示尺寸 × dprEff”重设（Stage 0）
  H.sb.innerWidth = 900; H.mainEl.clientWidth = 900; H.mainEl.clientHeight = 640; H.fireWin('resize', {});
  const rect = H.cv.getBoundingClientRect();
  assert.equal(H.cv.width, Math.round(rect.width * dprEffFor(rect.width, rect.height, 2, false)), '背店宽度应等于 rect×dprEff');
  assert.equal(H.cv.height, Math.round(rect.height * dprEffFor(rect.width, rect.height, 2, false)), '背店高度应等于 rect×dprEff');
  H.drive(10);
  // 切后台自动暂停
  H.document.hidden = true; H.fireDoc('visibilitychange', {});
  assert.equal(H.S.state, 'paused', '切后台未暂停');
  H.document.hidden = false;
  H.api.togglePause(); H.drive(10);
});

test('集成：主题全遍历（7 主题 × 7 地板图案 + 色点点击 + 元数据同步）', () => {
  const H = makeDom(); boot(H);
  const list = H.sb.Snake.theme.list;
  assert.equal(list.length, 7);
  for (const t of list) {
    H.sb.Snake.theme.apply(t.id);
    H.drive(5);                                  // 触发地板缓存重建 + Patterns.draw
    assert.equal(H.sb.Snake.theme.current.id, t.id);
  }
  assert.equal(H.document.documentElement.dataset.theme, list[list.length - 1].id);
  H.clickEl(H.thEl.children[2]);                 // 色点点击 → 应用并持久化
  assert.equal(H.sb.Snake.theme.current.id, list[2].id);
  assert.equal(H.store.get('iso-snake-theme'), list[2].id);
  H.drive(10);
  assert.ok(H.C.drawImage > 0);
});

test('集成：旧存储键一次性迁移（snake.* 偏好 → iso-snake-*，旧键保留）', () => {
  const H = makeDom({ store: { 'snake.theme': 'cyber', 'snake.snd': '0', 'snake.music': '1', 'snake.sprint': 'g' } });
  boot(H);
  assert.equal(H.store.get('iso-snake-theme'), 'cyber');
  assert.equal(H.store.get('iso-snake-snd'), '0');
  assert.equal(H.store.get('iso-snake-music'), '1');
  assert.equal(H.store.get('iso-snake-sprint'), 'g');
  assert.equal(H.store.get('snake.theme'), 'cyber');        // 旧键保留不删（回滚安全）
  assert.equal(H.sb.Snake.theme.current.id, 'cyber');       // 迁移后的主题真生效
  assert.ok(H.byId.snd.classList.contains('off'));          // 音效关闭状态生效
  assert.equal(H.byId.snd.title, '音效：关');
  assert.ok(!H.byId.mus.classList.contains('off'));         // 音乐开启状态生效
  H.drive(5);
  // 新键已有值时不被旧键覆盖
  const H2 = makeDom({ store: { 'snake.theme': 'lava', 'iso-snake-theme': 'candy' } });
  boot(H2);
  assert.equal(H2.store.get('iso-snake-theme'), 'candy');
  assert.equal(H2.sb.Snake.theme.current.id, 'candy');
});

test('集成：四模式巡回 + 冲刺音色全遍历 + 音乐开关', () => {
  const H = makeDom(); boot(H);
  for (const mode of ['easy', 'normal', 'pk', 'ai']) {
    H.api.setMode(mode); H.api.start();
    const before = H.C.fillRect;
    autoPlay(H, 220, { feed: mode !== 'pk' });   // pk 三份食物由核心自管，不覆写
    assert.ok(H.C.fillRect > before, mode + '：未产生绘制');
  }
  // 冲刺音色 6 套全跑（SPRINTS build/stop 路径）
  H.api.setMode('normal'); H.api.start(); H.drive(10);
  for (const id of ['b', 'c', 'f', 'g', 'h', 'i']) {
    H.byId.spr.value = id; H.fireEl(H.byId.spr, 'change', {});
    assert.equal(H.store.get('iso-snake-sprint'), id);
    H.api.setHold(0, true); H.drive(12); H.api.setHold(0, false); H.drive(6);
  }
  H.clickEl(H.byId.mus); H.drive(30); H.clickEl(H.byId.mus);   // BGM 开/关（interval 桩不触发，仅覆盖启停）
});

test('集成：死亡结算全流程（over 覆盖层/播报/复制/重开锁/最佳落盘）+ 金苹果 + 幽灵渲染', () => {
  const ghost = JSON.stringify({ score: 3, ts: Date.now(), path: [5, 5, 6, 6, 7, 7, 8, 8] });
  const H = makeDom({ store: { 'iso-snake-ghost-normal': ghost } }); boot(H);
  H.api.setMode('normal');                       // 默认模式是 easy；幽灵/最佳分键都按 normal 预置
  H.api.start(); H.drive(10);
  // 幽灵渲染路径
  H.api.setGhostOn(true); H.S.myMoves = 3; H.drive(10);
  assert.ok(H.S.ghost, '幽灵存档未加载');
  // 金苹果：放到下一步落点，确定性拾取
  autoPlay(H, 30);
  const p = H.S.pl[0];
  let d = nextDir(p); const h = p.body[0];
  let nx = h.x + d[0], ny = h.y + d[1];
  if (nx < 0 || ny < 0 || nx >= H.S.N || ny >= H.S.N) { safeSteer(H.S, p); d = nextDir(p); nx = h.x + d[0]; ny = h.y + d[1]; }
  H.S.gold = { x: nx, y: ny, born: H.S.last - 4800 };   // 剩 1.2s → 覆盖闪烁分支
  H.drive(40);
  assert.equal(H.S.stats.gold >= 1 || H.S.gold === null, true, '金苹果未被拾取');
  // 撞墙死亡：不再转向
  for (let i = 0; i < 600 && H.S.state !== 'over'; i++) {
    if (H.S.state === 'paused') H.api.togglePause();
    H.drive(1);
  }
  assert.equal(H.S.state, 'over');
  assert.ok(H.S.resultText.length > 0);
  assert.ok(H.store.has('iso-snake-best2-normal'), '最佳分未落盘');
  assert.ok(H.byId.live.textContent.includes('游戏结束'), '读屏播报缺失: ' + H.byId.live.textContent);
  const txtBefore = H.C.fillText;
  H.drive(30);                                   // over 覆盖层持续渲染
  assert.ok(H.C.fillText > txtBefore);
  H.clickEl(H.byId.copy); H.drive(2);
  assert.ok(H.copied.some(t => t === H.S.resultText), '结算复制文案不符');
  // 1200ms 重开锁
  H.key('KeyW'); assert.equal(H.S.state, 'over', '重开锁失效');
  H.drive(90);                                   // >1.5s
  H.key('KeyW'); assert.notEqual(H.S.state, 'over');
});

test('集成：每日挑战/种子/主题 URL 参数直达', () => {
  const H = makeDom({ search: '?daily=1&seed=777' }); boot(H);
  assert.equal(H.S.daily, true);
  assert.equal(H.S.seed, 777);
  assert.equal(H.S.mode, 'normal');
  H.drive(20);                                   // ready 覆盖层每日徽章
  H.api.start(); H.drive(60);
  assert.equal(H.S.state, 'playing');
  const H2 = makeDom({ search: '?theme=cyber' }); boot(H2);
  assert.equal(H2.sb.Snake.theme.current.id, 'cyber');
  H2.drive(10);
});

test('集成：减弱动态（reduced-motion）→ 强制降级特效 + 禁震动', () => {
  const H = makeDom({ reduce: true }); boot(H);
  H.api.setMode('normal');                       // easy 掉命会进 paused 复活流程，这里要一撞即终
  H.key('KeyW'); H.drive(40);
  assert.equal(H.S.lowFx, true, 'reduced-motion 未强制 lowFx');
  autoPlay(H, 120);                              // 吃食若干
  assert.equal(H.vibes.length, 0, 'reduced-motion 下不应震动');
  for (let i = 0; i < 600 && H.S.state !== 'over'; i++) { H.drive(1); }   // 撞墙：震屏被 RM 门跳过
  assert.equal(H.S.state, 'over');
  H.drive(20);
});

/* ---------- 9. 构建产物端到端：直接执行根目录 index.html 的全部内联 <script>（8 模块 + 启动块），
      验证用户实际拿到的交付物本身可运行（内联顺序、build.js 替换完整性） ---------- */
test('集成：构建产物 index.html 端到端（内联脚本直跑）', () => {
  const html = fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8');
  assert.ok(!/<script\b[^>]*\bsrc=/.test(html), '构建产物不应残留外部 <script src>');
  assert.ok(!/<link\b[^>]*\brel=["']stylesheet["']/i.test(html), '构建产物不应残留外部样式表');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m, i) => ({ name: 'index.html#script' + i, code: m[1] }));
  assert.ok(scripts.length >= 9, `内联脚本块数 ${scripts.length} 应 ≥ 9（8 模块 + 启动块）`);
  const H = makeDom({ scripts });                 // 启动块随内联脚本自动执行 → 不再手动 boot
  const { Snake } = H.sb;
  for (const k of ['S', 'K', 'api', 'bus', 'theme', 'Audio', 'UI', 'Render', 'Ai', 'hooks']) assert.ok(Snake[k], `Snake.${k} 导出缺失`);
  assert.equal(H.S.state, 'ready', '启动块应完成 api.reset()');
  H.key('KeyW'); H.drive(30);
  assert.equal(H.S.state, 'playing');
  const p = H.S.pl[0];
  autoPlay(H, 120);                               // 确定性喂食
  assert.ok(H.C.fillRect > 0 && H.C.drawImage > 0, '产物应有真实渲染调用');
  assert.ok(p.body.length >= 4, `蛇应生长（实际 ${p.body.length}）`);
  assert.ok(H.vibes.length > 0, '吃食震动应触发');
});

/* ---------- 10. Stage 0 清晰度：背店按实际显示尺寸 × dprEff 重算（分辨率不再被拉伸糊化） ---------- */
test('Stage 0：backing store = 实测显示尺寸 × dprEff（像素预算 / 高倍屏 / 事件重建 / rect 兜底）', () => {
  const profiles = [
    { name: '1024×768@2 桌面', main: { w: 1024, h: 768 }, dpr: 2 },
    { name: '390×844@3 手机', main: { w: 390, h: 844 }, dpr: 3, coarse: true },
    { name: '1920×1080@1 桌面', main: { w: 1920, h: 1080 }, dpr: 1 },
    { name: '1200×2000@3 平板（4.5M 预算封顶）', main: { w: 1200, h: 2000 }, dpr: 3, coarse: true },
  ];
  for (const p of profiles) {
    const H = makeDom({ main: p.main, dpr: p.dpr, coarse: p.coarse });   // 沉浸布局：fitCanvas 定 CSS 尺寸后实测
    boot(H);
    const r = H.cv.getBoundingClientRect();
    const eff = dprEffFor(r.width, r.height, p.dpr, !!p.coarse);
    assert.ok(Math.abs(H.cv.width - r.width * eff) <= 1, `${p.name}：背店宽度应 ≈ rect×dprEff（${r.width}×${eff}）`);
    assert.ok(Math.abs(H.cv.height - r.height * eff) <= 1, `${p.name}：背店高度应 ≈ rect×dprEff`);
    assert.ok(Math.abs(r.width / r.height - H.S.W / H.S.H) < .01, `${p.name}：CSS 尺寸应保持逻辑比例`);
    H.drive(3);
    assert.ok(H.C.drawImage > 0, `${p.name}：未执行渲染`);
  }
  // 高倍屏不再被硬顶在 2（2.0 的 dpr = min(devicePixelRatio, 2) 会让 3x 屏糊掉）
  const H3 = makeDom({ main: { w: 390, h: 844 }, dpr: 3, coarse: true }); boot(H3);
  assert.ok(H3.cv.width / H3.cv.getBoundingClientRect().width > 2.5, '3x 屏背店比例应 > 2.5');
  // 2.0 的旧公式（固定 S.W*dpr）在宽屏下背店远小于显示像素 → 本用例锁死修复
  const Hw = makeDom({ main: { w: 1920, h: 1080 }, dpr: 1 }); boot(Hw);
  assert.ok(Hw.cv.width > Hw.S.W * 2, '宽屏背店应远超逻辑尺寸（旧公式会只有 S.W×1）');
  // 事件重建：orientationchange / visualViewport resize / ResizeObserver
  const H = makeDom({ main: { w: 900, h: 700 }, dpr: 2 }); boot(H);
  const w0 = H.cv.width;
  H.mainEl.clientWidth = 1500; H.mainEl.clientHeight = 1000; H.fireWin('orientationchange', {});
  assert.notEqual(H.cv.width, w0, 'orientationchange 未重算背店');
  const w1 = H.cv.width;
  H.mainEl.clientHeight = 800; (H.vvH.resize || []).forEach(fn => fn());
  assert.notEqual(H.cv.width, w1, 'visualViewport resize 未重算背店');
  const w2 = H.cv.width;
  H.mainEl.clientWidth = 600; H.mainEl.clientHeight = 500; H.roList.forEach(ro => ro.cb());
  assert.notEqual(H.cv.width, w2, 'ResizeObserver 未重算背店');
  // 横屏 PK（844×390 @3 手机横屏）：18 格棋盘 + 沉浸 fit 下背店同样按 rect×dprEff
  const Hpk = makeDom({ main: { w: 844, h: 390 }, dpr: 3, coarse: true }); boot(Hpk);
  Hpk.api.setMode('pk'); Hpk.drive(5);
  assert.equal(Hpk.S.N, 18);
  const rp = Hpk.cv.getBoundingClientRect();
  const effp = dprEffFor(rp.width, rp.height, 3, true);
  assert.ok(Math.abs(Hpk.cv.width - rp.width * effp) <= 1, '横屏 PK 背店宽度应 ≈ rect×dprEff');
  assert.ok(Math.abs(Hpk.cv.height - rp.height * effp) <= 1, '横屏 PK 背店高度应 ≈ rect×dprEff');
  assert.ok(Hpk.C.drawImage > 0, '横屏 PK 未渲染');
  // rect 全 0（元素未布局）回退逻辑尺寸：不出现 0×0 或 NaN 背店
  const Hz = makeDom({ wide: false, rect: { width: 0, height: 0 }, dpr: 2 }); boot(Hz);
  assert.ok(Hz.cv.width > 0 && Hz.cv.height > 0 && Number.isFinite(Hz.cv.width), 'rect 为 0 时未回退逻辑尺寸');
  Hz.drive(2);
  assert.ok(Hz.C.drawImage > 0);
});

/* ---------- 11. 自适应画质：帧时间连续偏慢降背店，平稳不误降，富余且过冷却后试探回升 ---------- */
test('自适应画质：连续掉帧自动降分辨率（一般不低于 1:1，严重掉帧可软到 0.75 倍换流畅），平稳不误降，富余后试探回升', () => {
  const H = makeDom({ main: { w: 1024, h: 768 }, dpr: 2 }); boot(H);
  const w0 = H.cv.width;
  assert.ok(w0 > 0, '初始背店应已建立');
  H.drive(40);                                     // 预热 + 平稳 60fps：不应降档
  assert.equal(H.cv.width, w0, '平稳 60fps 不应降档');
  for (let i = 0; i < 160; i++) H.drive(1, 40);    // 连续 40ms 大帧（≈25fps）：一个决策窗口后应降档
  assert.ok(H.cv.width < w0, '连续掉帧后应自动降分辨率');
  for (let i = 0; i < 300; i++) H.drive(1, 40);    // 持续严重掉帧（漏帧率≈100% > 35%）：可一路降到 0.75 倍 CSS
  const r = H.cv.getBoundingClientRect();
  assert.ok(H.cv.width >= Math.round(r.width * 0.75) - 1, `软渲染也不应低于 0.75 倍 CSS（${H.cv.width} vs ${r.width}）`);
  assert.ok(H.cv.width <= Math.round(r.width * 1.5), `严重掉帧应已明显降档（${H.cv.width}）`);
  // 帧时间富余 + 越过试升冷却 → 升回一档，且清晰度地板回到 1:1 以上
  H.sb.__t += 20000; H.drive(1, 40);
  H.drive(300, 6);                                 // 6ms 富余帧
  const r2 = H.cv.getBoundingClientRect();
  assert.ok(H.cv.width > Math.round(r2.width) + 1, `富余帧 + 冷却结束后应试探升回（${H.cv.width} vs 1:1=${r2.width}）`);
});
