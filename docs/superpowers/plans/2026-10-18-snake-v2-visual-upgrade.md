# 等距贪吃蛇 v2 视觉升级 实现计划

> **For agentic workers:** 本计划采用 Inline 执行（executing-plans 风格），逐任务落地、每任务 `node --check` + 浏览器验证 + 本地 commit。步骤用 `- [ ]` 追踪。

**Goal:** 把 v1 单文件重构为 `src/` 多文件架构，并落地 10 套数据驱动主题、对象池粒子系统、全合成音效 + 可选 BGM，产出 `dist/index.html` 单文件成品交用户验收（验收前不发布 GitHub）。

**Architecture:** 经典（非 module）`<script>` 顺序加载，挂 `window.Snake` 全局命名空间。`core.js` 持有唯一状态 `Snake.S` 与事件总线 `Snake.bus`，表现层（render/particles/audio/themes）只订阅事件与读状态；AI 经 `Snake.hooks.think` 注入，core 不依赖 AI 模块；`build.js` 零依赖把 `src/` 内联打包为 `dist/index.html`。

**Tech Stack:** 原生 HTML/CSS/JS（零依赖）、Node（仅打包脚本）、Windows PowerShell 5、Edge headless（截图）。

**依据:** [设计文档](../specs/2026-10-18-snake-v2-visual-upgrade-design.md)；基线 [index.html](../../../index.html)（37KB 单文件 v1，行号以当前文件为准）。

---

## 0. 全局约定

- 代码与注释用中文；规范门禁：每个 JS 写完跑 `node --check`。
- 每个任务末尾本地 commit（git 已配置 kkkk16689）。**全程不碰远程**（用户要求验收后再发布）。
- `Snake.*` 命名约定（本计划通用接口，后文不再重复解释）：
  - `Snake.K` 常量与纯函数；`Snake.S` 游戏状态（唯一真相）；`Snake.bus` 事件总线；`Snake.hooks` 注入点；`Snake.api` 状态操作。
  - 事件：`resize` `hud` `gameStart` `eat` `sprintOn` `sprintOff` `sprintLock` `crash` `win` `lose` `themeChange`。
- 局部验证命令（PowerShell）：
  - 语法：`Get-ChildItem src/js/*.js | ForEach-Object { node --check $_.FullName }`
  - 打包：`node build.js`
  - 本地服务器：`python -m http.server 8098`（若无 python 再用 `npx http-server -p 8098`）
  - 浏览器走查：browser_use 子代理访问 `http://localhost:8098/src/index.html`（file:// 子代理不支持）
  - 截图：Edge headless（见 Task 12）
- 与 spec 的三个已确认的小偏差（均为落地细节，记录备查）：
  1. `canvas` 调色板字段名落地为 `{f1, f2, edge, grid, glow, food, star, spark}`——f1/f2/edge 即 spec 中 floor 三色的等价体（v1 中它们正是地板双色 + 边缘色）。
  2. core.js 在迁移时一步到位发出全部事件（`eat/crash/win/lose` 带载荷），无监听者时零副作用，Task 9/10 无需再改 core。
  3. 支持 `?theme=id` 与 `?mode=id` URL 参数（便于自动截图与直链分享，`?theme` 不写持久化）。

---

## Task 1: src 骨架 + base.css + build.js

**Files:**
- Create: `src/index.html`、`src/css/base.css`、`build.js`
- Create（占位，各 1 行 `window.Snake = window.Snake || {};`）: `src/js/core.js`、`src/js/themes.js`、`src/js/audio.js`、`src/js/particles.js`、`src/js/render.js`、`src/js/ai.js`、`src/js/input.js`

- [ ] **Step 1: 迁移 HTML 结构** — `src/index.html`：头部 meta 与 `index.html` L1-16 逐字一致，仅 `<style>`（L17-92）换成 `<link rel="stylesheet" href="css/base.css">`；body 结构（L94-127）逐字一致；`</body>` 前插入脚本引用（顺序 = 设计文档 §2.4，bootstrap 内联脚本 Task 6 再加）：

```html
<script src="js/core.js"></script>
<script src="js/themes.js"></script>
<script src="js/audio.js"></script>
<script src="js/particles.js"></script>
<script src="js/render.js"></script>
<script src="js/ai.js"></script>
<script src="js/input.js"></script>
```

- [ ] **Step 2: 迁移样式** — `src/css/base.css` = 基线 `index.html` L17-92 `<style>` 内容逐字复制（`.thms` 主题色点样式 Task 8 再加）。

- [ ] **Step 3: 写 build.js（零依赖打包）** 完整代码：

```js
#!/usr/bin/env node
/* build.js —— 零依赖打包：src/ → dist/index.html 单文件
   规则：按声明顺序把 <link rel="stylesheet"> 与 <script src> 内联替换；文件缺失时报错退出。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = __dirname, SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'dist');
const err = m => { console.error('[build] ' + m); process.exit(1); };
const read = a => { try { return fs.readFileSync(a, 'utf8'); } catch (e) { err('缺失文件: ' + path.relative(ROOT, a)); } };

let html = read(path.join(SRC, 'index.html'));
let cssN = 0, jsN = 0;
html = html.replace(/<link\b[^>]*?\brel=["']stylesheet["'][^>]*?\bhref=["']([^"']+)["'][^>]*?\/?>/gi, (full, href) => {
  cssN++;
  return '<style>\n' + read(path.join(SRC, href)) + '\n</style>'; // 内联在 <head> 原位
});
html = html.replace(/<script\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>\s*<\/script>/gi, (full, src) => {
  jsN++;
  return '<script>\n' + read(path.join(SRC, src)) + '\n</script>'; // 内联在 body 原位，保证执行顺序
});
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('[build] OK → dist/index.html（CSS ×' + cssN + ' · JS ×' + jsN + ' · ' + (Buffer.byteLength(html) / 1024).toFixed(1) + 'KB）');
```

- [ ] **Step 4: 校验**：`node --check build.js`；`node build.js` → 输出 `[build] OK → dist/index.html（CSS ×1 · JS ×7 · …）`；浏览器打开 `dist/index.html` 应显示完整页面布局且控制台无报错（游戏未启动属预期，占位文件为空壳）。
- [ ] **Step 5: Commit**

```bash
git add src/ build.js
git commit -m "chore: 搭建 src 多文件骨架与零依赖打包脚本"
```

---

## Task 2: core.js —— 状态、规则、事件总线

**Files:**
- Modify: `src/js/core.js`（替换占位，完整重写如下）
- 迁移来源: 基线 `index.html` L129-157（config）、L179-267（logic）、L308 的 `interval/tickMs`；`updateHud` 移走（Task 5）、`aiThink` 调用改 hooks、`beep/burst/updateHud` 调用改总线事件

**完整代码（含全部事件载荷，Task 9/10 直接复用）：**

```js
/* core.js —— 游戏规则与状态（唯一真相）
   约束：不碰 DOM / CSS / 音频 / 粒子 / 绘制；对表现层只通过 bus 事件与只读状态 S 通信。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const K = {
    TW: 30, TH: 15,
    get HW() { return K.TW / 2; },
    get HH() { return K.TH / 2; },
    OY: 34,
    MODES: {
      easy:   { n: 12, start: 220, min: 120, accel: 3, lives: 3, players: 1, foods: 1 },
      normal: { n: 12, start: 150, min: 70,  accel: 4, lives: 1, players: 1, foods: 1 },
      pk:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3 },
      ai:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3, ai: true }
    },
    /* 皮肤：玩家身份标识，不随主题变化 */
    SK: [
      { name: '青绿', body: ['#5DCAA5', '#1D9E75', '#0F6E56'], head: ['#E1F5EE', '#5DCAA5', '#1D9E75'] },
      { name: '天蓝', body: ['#85B7EB', '#378ADD', '#185FA5'], head: ['#E6F1FB', '#85B7EB', '#378ADD'] },
      { name: '紫', body: ['#AFA9EC', '#7F77DD', '#534AB7'], head: ['#EEEDFE', '#AFA9EC', '#7F77DD'] },
      { name: '琥珀', body: ['#FAC775', '#EF9F27', '#BA7517'], head: ['#FAEEDA', '#FAC775', '#EF9F27'] },
      { name: '粉', body: ['#F4C0D1', '#D4537E', '#993556'], head: ['#FBEAF0', '#ED93B1', '#D4537E'] },
      { name: '灰', body: ['#D3D1C7', '#888780', '#5F5E5A'], head: ['#F1EFE8', '#B4B2A9', '#888780'] }
    ],
    SPRINT_HEAD: ['#DCEBFF', '#7DB8FF', '#3B82F6'],   // 冲刺时蛇头配色（固定）
    DEAD: ['#F7C1C1', '#E24B4A', '#A32D2D'],
    FOOD: ['#F0997B', '#D85A30', '#993C1D'],
    FOOD_PK: ['#FFFFFF', '#CBD5E1', '#94A3B8'],
    /* 格坐标方向（等距屏上视角） */
    DIRS: { upRight: [0, -1], downRight: [1, 0], downLeft: [0, 1], upLeft: [-1, 0] },
    /* 屏幕方向 → 两个候选格方向；steer() 挑能转弯的那个 */
    SCREEN: {
      up:    [[0, -1], [1, 0]], down: [[0, 1], [-1, 0]],
      left:  [[-1, 0], [0, -1]], right: [[1, 0], [0, 1]]
    }
  };

  /* ---------- 状态（唯一真相，其他模块只读；写入仅经 api） ---------- */
  const S = {
    N: 12, W: 380, H: 240, OX: 190,
    lowFx: false, frameDt: .016,        // lowFx 由 render 检测并写入
    mode: 'easy', pl: [], foods: [], state: 'ready', msg: '', last: 0,
    best: 0, wins: [0, 0], winner: -1, tickN: 0, overAt: 0, skin: [0, 1]
  };

  /* ---------- 事件总线 ---------- */
  const bus = (() => {
    const m = {};
    return {
      on(ev, fn) { (m[ev] = m[ev] || []).push(fn); },
      off(ev, fn) { if (m[ev]) m[ev] = m[ev].filter(f => f !== fn); },
      emit(ev, d) { (m[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error('[bus]', ev, e); } }); }
    };
  })();

  /* ---------- 纯函数工具 ---------- */
  const rand = n => Math.floor(Math.random() * n);
  const safeGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const nm = i => (K.MODES[S.mode].ai ? (i ? 'AI' : '你') : 'P' + (i + 1));
  /* 等距投影：格 (x,y) 顶点的屏幕坐标 */
  const P = (x, y) => [S.OX + (x - y) * K.HW, K.OY + (x + y) * K.HH];
  /* 廉价种子随机（闪电用） */
  const fr = s => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
  /* hex → rgba 字符串 */
  const rgba = (h, a) => 'rgba(' + parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16) + ',' + a + ')';
  /* 由主色派生立方体 [亮, 中, 暗] 三面（食物/发光体用） */
  const shades = (hex, up = .35, down = .45) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const hx = n => '#' + n.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
    return [hx(c.map(v => v + (255 - v) * up)), hex, hx(c.map(v => v * (1 - down)))];
  };

  /* ---------- 游戏逻辑 ---------- */
  function setSize(n) {
    S.N = n; S.W = n * K.TW + 20; S.H = n * K.TH + K.OY + 12; S.OX = S.W / 2;
    bus.emit('resize', { n });           // render 监听并同步 canvas 尺寸
  }
  function loadBest() { S.best = +safeGet('iso-snake-best-' + S.mode, 0) || 0; }
  function spawn(i, p) {
    const two = K.MODES[S.mode].players === 2;
    const y = two ? (i ? S.N - 5 : 4) : 6, xs = two ? (i ? [S.N - 5, S.N - 4, S.N - 3] : [4, 3, 2]) : [3, 2, 1];
    p.body = xs.map(x => ({ x, y })); p.dir = i ? K.DIRS.upLeft : K.DIRS.downRight; p.queue = []; p.dead = false;
  }
  function fillFoods() {
    while (S.foods.length < K.MODES[S.mode].foods) {
      let f;
      do { f = { x: rand(S.N), y: rand(S.N) }; }
      while (S.pl.some(p => p.body.some(s => s.x === f.x && s.y === f.y)) || S.foods.some(o => o.x === f.x && o.y === f.y));
      S.foods.push(f);
    }
  }
  function newGame() {
    const m = K.MODES[S.mode]; setSize(m.n);
    S.tickN = 0; S.lowFx = false; S.frameDt = .016;
    S.pl = [...Array(m.players)].map((_, i) => {
      const p = { score: 0, lives: m.lives, energy: 100, locked: false, hold: false, sprint: false, trail: [], streak: 0, ai: !!m.ai && i === 1 };
      spawn(i, p); return p;
    });
    S.foods = []; fillFoods(); S.state = 'ready'; S.msg = ''; S.winner = -1;
    bus.emit('hud'); bus.emit('gameStart');
  }
  function turn(p, d) {
    const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    if (d[0] === ref[0] && d[1] === ref[1]) return;
    if (d[0] + ref[0] === 0 && d[1] + ref[1] === 0) return;
    if (p.queue.length < 2) p.queue.push(d);
  }
  function steer(p, name) {
    const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    const [c1, c2] = K.SCREEN[name];
    const same = c => c[0] === ref[0] && c[1] === ref[1];
    if (same(c1) || same(c2)) return;
    turn(p, same([-c1[0], -c1[1]]) ? c2 : c1);
  }
  function step() {
    S.tickN++;
    S.pl.forEach((p, i) => { if (p.ai && !p.dead && Snake.hooks.think) Snake.hooks.think(p, i); });
    const dt = tickMs() / 1000;
    S.pl.forEach((p, i) => {   // 冲刺耗能 / 恢复；能量归零锁定到 30
      const was = p.sprint;
      const want = p.hold && p.energy > 0 && !p.locked;
      if (want && !p.sprint) bus.emit('sprintOn', { i });
      p.sprint = want;
      if (want) { p.energy = Math.max(0, p.energy - 45 * dt); if (p.energy === 0) { p.locked = true; p.sprint = false; bus.emit('sprintLock', { i }); } }
      else { p.energy = Math.min(100, p.energy + 18 * dt); if (p.locked && p.energy >= 30) p.locked = false; }
      if (!p.sprint && was) bus.emit('sprintOff', { i });
    });
    const mv = S.pl.map(p => p.sprint || S.tickN % 2 === 0); // 冲刺每 tick 动，平时隔 tick
    const hs = S.pl.map((p, i) => { if (!mv[i]) return null; if (p.queue.length) p.dir = p.queue.shift(); return { x: p.body[0].x + p.dir[0], y: p.body[0].y + p.dir[1] }; });
    const eat = hs.map(h => h ? S.foods.findIndex(f => f.x === h.x && f.y === h.y) : -1);
    const hit = hs.map((h, i) => {
      if (!h) return false;
      if (h.x < 0 || h.y < 0 || h.x >= S.N || h.y >= S.N) return true;
      if (hs.some((o, j) => j !== i && o && o.x === h.x && o.y === h.y)) return true; // 对头相撞
      return S.pl.some((q, j) => (mv[j] && eat[j] < 0 ? q.body.slice(0, -1) : q.body).some(s => s.x === h.x && s.y === h.y));
    });
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0];
      if (hit[0]) {
        p.lives--; p.streak = 0;
        if (p.lives > 0) { spawn(0, p); S.state = 'paused'; S.msg = '撞到了！还剩 ' + p.lives + ' 条命'; bus.emit('hud'); }
        else gameOver();
        return;
      }
    } else if (hit.some(Boolean)) { hit.forEach((h, i) => S.pl[i].dead = h); gameOver(); return; }
    S.pl.forEach((p, i) => {
      if (!hs[i]) return;
      if (p.sprint) { p.trail.push({ x: p.body[0].x, y: p.body[0].y, b: performance.now() }); if (p.trail.length > 14) p.trail.shift(); }
      p.body.unshift(hs[i]);
      if (eat[i] >= 0) { p.score++; p.streak++; bus.emit('eat', { x: S.foods[eat[i]].x, y: S.foods[eat[i]].y, pk: K.MODES[S.mode].players === 2, streak: p.streak, i }); }
      else p.body.pop();
    });
    const eaten = new Set(eat.filter(k => k >= 0));
    S.foods = S.foods.filter((_, k) => !eaten.has(k)); fillFoods();
    bus.emit('hud');
  }
  function gameOver() {
    S.state = 'over'; S.overAt = performance.now();
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0]; p.dead = true;
      if (p.score > S.best) { S.best = p.score; safeSet('iso-snake-best-' + S.mode, S.best); }
      bus.emit('lose', { i: 0 });
    } else {
      const alive = S.pl.map((p, i) => p.dead ? -1 : i).filter(i => i >= 0);
      S.winner = alive.length === 1 ? alive[0] : -1;
      if (S.winner >= 0) S.wins[S.winner]++;
      bus.emit('win', { winner: S.winner });
    }
    const heads = S.pl.filter(p => p.dead).map(p => ({ x: p.body[0].x, y: p.body[0].y }));
    bus.emit('crash', { heads });
    bus.emit('hud');
  }
  const interval = () => { const m = K.MODES[S.mode]; return Math.max(m.min, m.start - S.pl.reduce((a, p) => a + p.score, 0) * m.accel); };
  const tickMs = () => interval() / 2; // 一次普通移动 = 两个 tick（冲刺可每 tick 移动）

  /* ---------- 状态机 api ---------- */
  function start() { if (S.state === 'over') { if (performance.now() - S.overAt < 1200) return; newGame(); } S.state = 'playing'; S.msg = ''; S.last = performance.now(); } // 结算界面 1.2s 锁，防连点跳过
  function togglePause() { if (S.state === 'playing') { S.state = 'paused'; S.msg = ''; } else start(); }
  function press(i, name) { if (S.state !== 'playing') { start(); if (S.state !== 'playing') return; } if (S.pl[i]) steer(S.pl[i], name); }
  const setHold = (i, v) => { if (S.pl[i]) S.pl[i].hold = v; };
  function setMode(m) { S.mode = m; S.wins = [0, 0]; loadBest(); newGame(); bus.emit('hud'); }
  function setSkin(p, k) { S.skin[p] = k; bus.emit('hud'); }
  /* render 每帧调用：追赶式 tick（帧率无关），一帧最多补 3 步 */
  function update(t) {
    if (S.state === 'playing') {
      let n = 0;
      while (S.state === 'playing' && t - S.last >= tickMs() && n++ < 3) { S.last += tickMs(); step(); }
      if (t - S.last > 400) S.last = t;
    }
  }

  const qs = new URLSearchParams(location.search);   // 便于截图/直链分享（?theme= ?mode=），mode 仅初始值
  if (qs.get('mode') && K.MODES[qs.get('mode')]) S.mode = qs.get('mode');

  /* 工具注册进 K 供各表现层模块使用（内部仍用裸名） */
  K.rand = rand; K.safeGet = safeGet; K.safeSet = safeSet; K.nm = nm;
  K.P = P; K.fr = fr; K.rgba = rgba; K.shades = shades;

  Snake.K = K; Snake.S = S; Snake.bus = bus;
  Snake.hooks = { think: null };
  Snake.api = { newGame, reset: () => { loadBest(); newGame(); }, start, togglePause, press, setHold, setMode, setSkin, update };
})();
```

- [ ] **Step 2: 校验** `node --check src/js/core.js`
- [ ] **Step 3: Commit** `git add src/js/core.js && git commit -m "refactor: 抽出 core.js——状态、规则与事件总线（行为不变）"`

---

## Task 3: render.js —— 等距渲染（迁移）

**Files:**
- Modify: `src/js/render.js`（替换占位）
- 迁移来源: 基线 L159-177（canvas 初始化与 setSize 的 canvas 部分）、L416-452（P/poly/diamond/cube/board）、L453-538（星空/粒子/光效）、L539-599（draw/frame/boot，去掉 updateBars）

**完整代码：**

```js
/* render.js —— 一切 canvas 绘制。只读状态；不改游戏状态（lowFx 检测除外）。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K, bus = Snake.bus, api = Snake.api;
  const $ = id => document.getElementById(id);
  const cv = $('c'); let ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let boardCache = null;                 // 地板离屏缓存
  let theme = {};                        // 迁移期：读 CSS 变量（Task 8 改为主题调色板）

  function applyCanvasSize() {
    cv.width = S.W * dpr; cv.height = S.H * dpr; cv.style.aspectRatio = S.W + '/' + S.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardCache = null;
  }
  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    theme = { f1: s.getPropertyValue('--f1').trim(), f2: s.getPropertyValue('--f2').trim(), edge: s.getPropertyValue('--edge').trim() };
    boardCache = null;
  }
  readTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true });

  function poly(pts, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function diamond(cx, cy, a, b, col) { poly([[cx, cy - b], [cx + a, cy], [cx, cy + b], [cx - a, cy]], col); }
  /* 以格 (x,y) 为中心的立方块：s 尺寸比 / hgt 高 / zb 抬高 / c=[顶,左,右] / glow 描边光 */
  function cube(x, y, s, hgt, zb, c, glow) {
    const [sx, sy] = K.P(x, y), cx = sx, cy = sy + K.HH, a = K.HW * s, b = K.HH * s, top = zb + hgt;
    poly([[cx - a, cy - top], [cx, cy + b - top], [cx, cy + b - zb], [cx - a, cy - zb]], c[1]);
    poly([[cx + a, cy - top], [cx, cy + b - top], [cx, cy + b - zb], [cx + a, cy - zb]], c[2]);
    if (glow && !S.lowFx) { ctx.shadowColor = glow; ctx.shadowBlur = 10; }
    diamond(cx, cy - top, a, b, c[0]);
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  }
  function drawBoard() {
    if (!boardCache) {
      const main = ctx, oc = document.createElement('canvas');
      oc.width = S.W * dpr; oc.height = S.H * dpr; ctx = oc.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { paintBoard(); } finally { ctx = main; }
      boardCache = oc;
    }
    ctx.drawImage(boardCache, 0, 0, S.W, S.H);
  }
  function paintBoard() {
    const l = [S.OX - S.N * K.HW, K.OY + S.N * K.HH], r = [S.OX + S.N * K.HW, K.OY + S.N * K.HH], b = [S.OX, K.OY + S.N * K.TH];
    poly([l, b, [b[0], b[1] + 8], [l[0], l[1] + 8]], theme.edge);
    poly([r, b, [b[0], b[1] + 8], [r[0], r[1] + 8]], theme.edge);
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
      const [sx, sy] = K.P(x, y);
      diamond(sx, sy + K.HH, K.HW, K.HH, (x + y) % 2 ? theme.f1 : theme.f2);
      ctx.strokeStyle = 'rgba(80,220,255,.2)'; ctx.lineWidth = 1; // 霓虹网格（Task 8 换主题色）
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + K.HW, sy + K.HH); ctx.lineTo(sx, sy + 2 * K.HH); ctx.lineTo(sx - K.HW, sy + K.HH); ctx.closePath(); ctx.stroke();
    }
  }
  /* ---------- 夜景与特效（迁移期与 v1 完全一致） ---------- */
  const STARS = Array.from({ length: 40 }, (_, i) => [K.fr(i * 3 + 1), K.fr(i * 3 + 2), K.fr(i * 3 + 3) > .8 ? 2 : 1]);
  const parts = [];
  function burst(x, y, col) { // 吃食火花（Task 9 迁入粒子池）
    const [sx, sy] = K.P(x, y);
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.283, v = 30 + Math.random() * 60; parts.push({ x: sx, y: sy + K.HH - 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6 - 20, life: .6 + Math.random() * .3, age: 0, col }); }
  }
  function drawParts(dt) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.age += dt;
      if (q.age > q.life) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 90 * dt;
      ctx.fillStyle = K.rgba(q.col, (1 - q.age / q.life).toFixed(2)); ctx.beginPath(); ctx.arc(q.x, q.y, 1.8, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function halo(x, y, hgt, col) { // 身体鳞片廉价光晕（无模糊）
    if (S.lowFx) return;
    const [sx, sy] = K.P(x, y);
    ctx.globalCompositeOperation = 'lighter';
    diamond(sx, sy + K.HH - hgt, K.HW * 1.3, K.HH * 1.3, K.rgba(col, .10));
    diamond(sx, sy + K.HH - hgt, K.HW * 1.7, K.HH * 1.7, K.rgba(col, .05));
    ctx.globalCompositeOperation = 'source-over';
  }
  function streak(p, now) { // 冲刺光轨
    const pts = p.trail.map(s => { const [sx, sy] = K.P(s.x, s.y); return [sx, sy + K.HH - 6, 1 - (now - s.b) / 500]; });
    if (p.sprint) { const [hx, hy] = K.P(p.body[0].x, p.body[0].y); pts.push([hx, hy + K.HH - 6, 1]); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[11, .14], [5, .35], [1.8, .9]].forEach(([w, a], k) => {
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = (k === 2 ? 'rgba(220,240,255,' : 'rgba(60,140,255,') + (a * pts[i][2]).toFixed(2) + ')';
        ctx.lineWidth = w * (.4 + .6 * pts[i][2]);
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
    });
  }
  function zig(x1, y1, x2, y2, seed) { // 单条锯齿闪电
    const pts = [[x1, y1]];
    for (let k = 1; k < 5; k++) { const f = k / 5; pts.push([x1 + (x2 - x1) * f + (K.fr(seed + k) - .5) * 14, y1 + (y2 - y1) * f + (K.fr(seed + k * 3) - .5) * 9]); }
    pts.push([x2, y2]);
    [['rgba(80,150,255,.55)', 4], ['#eaf4ff', 1.3]].forEach(([c, w]) => {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
      pts.forEach((q, n) => n ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke();
    });
  }
  function lightning(p, cx, cy, t, i) { // 头部闪电 + 沿身电弧（约 18 次/秒换种子）
    const seed = Math.floor(t / 55) * 7 + i * 101, n = p.body.length;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let b = 0; b < 3; b++) { const ang = K.fr(seed + b * 13) * 6.283, len = 24 + K.fr(seed + b * 29) * 24; zig(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * .6, seed + b * 7); }
    for (let k = 0; k < (S.lowFx ? 0 : 2); k++) {
      const j = Math.floor(K.fr(seed + k * 17) * Math.max(1, n - 2)), a = K.P(p.body[j].x, p.body[j].y), c = K.P(p.body[Math.min(j + 2, n - 1)].x, p.body[Math.min(j + 2, n - 1)].y);
      zig(a[0], a[1] + K.HH - 8, c[0], c[1] + K.HH - 8, seed + k * 3);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function seam(p, j, x, y, s, hgt, col) { // 鳞片人字缝，指向蛇头
    const q = p.body[j - 1]; if (!q) return;
    const dx = q.x - x, dy = q.y - y; if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    const [sx, sy] = K.P(x, y), cx = sx, cy = sy + K.HH - hgt;
    const v = [(dx - dy) * K.HW * s, (dx + dy) * K.HH * s], w = [(-dy - dx) * K.HW * s, (-dy + dx) * K.HH * s];
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(cx + w[0] * .5 - v[0] * .1, cy + w[1] * .5 - v[1] * .1); ctx.lineTo(cx + v[0] * .35, cy + v[1] * .35); ctx.lineTo(cx - w[0] * .5 - v[0] * .1, cy - w[1] * .5 - v[1] * .1);
    ctx.stroke();
  }
  function headFx(p, t, i) { // 眼睛、吐舌、冲刺闪电
    const h = p.body[0], [sx, sy] = K.P(h.x, h.y), cx = sx, cy = sy + K.HH - 9, dx = p.dir[0], dy = p.dir[1];
    const v = [(dx - dy) * K.HW, (dx + dy) * K.HH], w = [(-dy - dx) * K.HW, (-dy + dx) * K.HH];
    if (!p.dead) {
      [-1, 1].forEach(sg => {
        const ex = cx + v[0] * .28 + w[0] * .26 * sg, ey = cy + v[1] * .28 + w[1] * .26 * sg;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#0a1a2a'; ctx.beginPath(); ctx.arc(ex + v[0] * .06, ey + v[1] * .06, .9, 0, 6.283); ctx.fill();
      });
      const fl = Math.max(0, Math.sin(t / 90));
      if (fl > .2) {
        const bx = cx + v[0] * .6, by = cy + v[1] * .6, ex = bx + v[0] * .45 * fl, ey = by + v[1] * .45 * fl;
        ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
        ctx.moveTo(ex, ey); ctx.lineTo(ex + v[0] * .12 + w[0] * .14, ey + v[1] * .12 + w[1] * .14);
        ctx.moveTo(ex, ey); ctx.lineTo(ex + v[0] * .12 - w[0] * .14, ey + v[1] * .12 - w[1] * .14); ctx.stroke();
      }
    }
    if (p.sprint) lightning(p, cx, cy, t, i);
  }
  function overlay(t1, t2) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, S.W, S.H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '600 22px system-ui,sans-serif'; ctx.fillText(t1, S.W / 2, S.H / 2 - 4);
    ctx.font = '14px system-ui,sans-serif'; ctx.fillText(t2, S.W / 2, S.H / 2 + 20);
  }
  function draw(t) {
    ctx.clearRect(0, 0, S.W, S.H);
    STARS.forEach((s, i) => { ctx.fillStyle = 'rgba(200,220,255,' + (.25 + .35 * Math.sin(t / 700 + i)).toFixed(2) + ')'; ctx.fillRect(s[0] * S.W, s[1] * S.H, s[2], s[2]); });
    drawBoard();
    const raw = (t - (draw.t || t)) / 1000, dt = Math.min(.05, raw); draw.t = t;
    S.frameDt = S.frameDt * .95 + Math.min(.2, raw) * .05; if (S.frameDt > .032) S.lowFx = true; // 低端机自动关辉光
    const now = performance.now(), fg = K.MODES[S.mode].players === 2 ? '#cbd5e1' : '#ff7a45';
    ctx.globalCompositeOperation = 'lighter';
    S.pl.forEach((p, i) => { // 蛇与食物映在地板的光
      const c = K.rgba(K.SK[S.skin[i]].body[1], .16);
      if (!S.lowFx) p.body.forEach(s => { const [sx, sy] = K.P(s.x, s.y); diamond(sx, sy + K.HH, K.HW * 1.3, K.HH * 1.3, c); });
      p.trail = p.trail.filter(s => now - s.b < 500);
      streak(p, now);
    });
    S.foods.forEach(f => { const [sx, sy] = K.P(f.x, f.y); diamond(sx, sy + K.HH, K.HW * 1.5, K.HH * 1.5, K.rgba(fg, .18)); });
    ctx.globalCompositeOperation = 'source-over';
    const items = [];
    S.pl.forEach((p, i) => p.body.forEach((s, j) => items.push({ x: s.x, y: s.y, i, j, n: p.body.length, head: j === 0, dead: p.dead })));
    S.foods.forEach(f => items.push({ x: f.x, y: f.y, food: true }));
    items.sort((a, b) => (a.x + a.y) - (b.x + b.y)); // 画家算法：后 → 前
    for (const o of items) {
      if (o.food) {
        const [sx, sy] = K.P(o.x, o.y);
        diamond(sx, sy + K.HH, K.HW * .5, K.HH * .5, 'rgba(0,0,0,.25)');
        cube(o.x, o.y, .55, 8, 3 + Math.sin(t / 250) * 2.5, K.MODES[S.mode].players === 2 ? K.FOOD_PK : K.FOOD, fg);
      } else if (o.head) cube(o.x, o.y, .98, 9, 0, o.dead ? K.DEAD : S.pl[o.i].sprint ? K.SPRINT_HEAD : K.SK[S.skin[o.i]].head, o.dead ? null : S.pl[o.i].sprint ? '#3B82F6' : K.SK[S.skin[o.i]].body[1]);
      else { // 身体鳞片：向尾部渐细 + 光晕 + 人字缝
        const k = Math.max(0, (o.j - (o.n - 7)) / 7), s = .92 - .32 * k, hg = 8 - 3 * k, col = K.SK[S.skin[o.i]];
        halo(o.x, o.y, hg, col.body[1]);
        cube(o.x, o.y, s, hg, 0, col.body);
        seam(S.pl[o.i], o.j, o.x, o.y, s, hg, col.body[2]);
      }
    }
    S.pl.forEach((p, i) => headFx(p, t, i));
    drawParts(dt);
    const pk = K.MODES[S.mode].players === 2;
    if (pk) S.pl.forEach((p, i) => { // 头顶名牌
      const [sx, sy] = K.P(p.body[0].x, p.body[0].y);
      ctx.fillStyle = K.SK[S.skin[i]].body[2]; ctx.fillRect(sx - 12, sy - 26, 24, 15);
      ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(K.nm(i), sx, sy - 15);
    });
    if (S.state === 'ready') overlay(pk ? (K.MODES[S.mode].ai ? '人机对战' : '双人对战') : '等距贪吃蛇', pk ? (K.MODES[S.mode].ai ? 'WASD 或方向键 · E/Shift 冲刺 · 点击开始' : 'P1 WASD·E 冲刺   P2 方向键·Enter 冲刺') : '点击画面或按方向键开始');
    else if (S.state === 'paused') overlay(S.msg || '已暂停', '点击画面或按空格继续');
    else if (S.state === 'over') overlay(pk ? (S.winner < 0 ? '平局' : K.MODES[S.mode].ai ? (S.winner ? 'AI 获胜' : '你赢了') : 'P' + (S.winner + 1) + ' 获胜') : '游戏结束 · ' + S.pl[0].score + ' 分', '点击画面重新开始');
  }
  function frame(t) {
    api.update(t);                       // core 追赶式 tick
    try { draw(t); } catch (e) { console.error(e); } // 绘制错误绝不让游戏循环停摆
    requestAnimationFrame(frame);
  }
  function boot() {
    applyCanvasSize();
    bus.on('resize', applyCanvasSize);
    requestAnimationFrame(frame);
  }
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; } };
})();
```

- [ ] **Step 2: 注意点**：P/poly 中 `K.P` 引用 core；`draw.t` 静态属性保留；`updateBars()` 调用移除（Task 5 由 UI 自驱 rAF）。
- [ ] **Step 3: 校验** `node --check src/js/render.js`
- [ ] **Step 4: Commit** `git add src/js/render.js && git commit -m "refactor: 抽出 render.js——等距渲染与特效（行为不变）"`

---

## Task 4: ai.js —— 敌方 AI（迁移）

**Files:**
- Modify: `src/js/ai.js`（替换占位）
- 迁移来源: 基线 L268-306（DLIST/cellKey/AI_LV/aiScan/aiThink）+ L391 的 aiLv 按钮接线

**完整代码：**

```js
/* ai.js —— 敌方蛇控制决策（洪水填充 + 危险回避）。原样迁移，不改算法。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K;
  const DLIST = Object.values(K.DIRS);
  const cellKey = (x, y) => x * 1024 + y; // 格哈希；N ≤ 1024 安全
  const AI_LV = [
    { name: '简单', err: .08, sprint: false, near: 0, minE: 100 }, // 偶尔随机安全步，永不冲刺
    { name: '普通', err: .02, sprint: true, near: 6, minE: 50 },
    { name: '困难', err: 0, sprint: true, near: 9, minE: 30 }
  ];
  let aiLevel = 1;
  function aiScan(blocked, sx, sy) { // 洪水填充：空间大小 + 最近食物距离
    const seen = new Set([cellKey(sx, sy)]), q = [[sx, sy, 0]]; let fd = 1e9;
    for (let i = 0; i < q.length; i++) {
      const [x, y, d] = q[i];
      if (fd === 1e9 && S.foods.some(f => f.x === x && f.y === y)) fd = d;
      for (const dd of DLIST) {
        const nx = x + dd[0], ny = y + dd[1], k = cellKey(nx, ny);
        if (nx < 0 || ny < 0 || nx >= S.N || ny >= S.N || blocked.has(k) || seen.has(k)) continue;
        seen.add(k); q.push([nx, ny, d + 1]);
      }
    }
    return { area: q.length, fd };
  }
  function think(p, idx) { // 每 tick 调用：挑最安全且趋向食物的走法，并决策冲刺
    const lv = AI_LV[aiLevel], h = p.body[0], blocked = new Set(), risky = new Set();
    S.pl.forEach(q => q.body.forEach((s, k) => { if (k === q.body.length - 1 && q.body.length > 1) return; blocked.add(cellKey(s.x, s.y)); })); // 对手尾巴即将让位
    S.pl.forEach((q, j) => { if (j !== idx && !q.dead) DLIST.forEach(d => risky.add(cellKey(q.body[0].x + d[0], q.body[0].y + d[1]))); }); // 对手蛇头可能落点
    const moves = DLIST.filter(d => !(d[0] + p.dir[0] === 0 && d[1] + p.dir[1] === 0)).map(d => {
      const x = h.x + d[0], y = h.y + d[1], k = cellKey(x, y);
      if (x < 0 || y < 0 || x >= S.N || y >= S.N || blocked.has(k)) return null;
      const s = aiScan(blocked, x, y), roomy = s.area >= p.body.length + 3; // 绝不钻进逃不出的口袋
      return { d, s, score: (roomy ? 1000 - Math.min(s.fd, 500) : s.area) - (risky.has(k) ? 60 : 0) };
    }).filter(Boolean);
    if (!moves.length) return;
    let pick = moves.sort((a, b) => b.score - a.score)[0];
    if (Math.random() < lv.err) pick = moves[Math.floor(Math.random() * moves.length)];
    p.queue = [pick.d];
    p.hold = lv.sprint && pick.s.fd <= lv.near && p.energy > lv.minE && !p.locked;
  }
  function init() {
    Snake.hooks.think = think;
    document.getElementById('aiLv').addEventListener('click', e => {
      aiLevel = (aiLevel + 1) % AI_LV.length;
      e.currentTarget.textContent = 'AI ' + AI_LV[aiLevel].name;
      e.currentTarget.blur();
    });
  }
  Snake.Ai = { init };
})();
```

- [ ] **Step 2: 校验** `node --check src/js/ai.js`
- [ ] **Step 3: Commit** `git add src/js/ai.js && git commit -m "refactor: 抽出 ai.js——洪水填充 AI（算法原样，仅接线 hooks）"`

---

## Task 5: input.js —— 输入归一化 + HUD

**Files:**
- Modify: `src/js/input.js`（替换占位）
- 迁移来源: 基线 L320-348（start/togglePause/press/键盘/模式按钮）、L350-375（皮肤选择/全屏）、L392-414（updateBars/滑动）；`updateHud` 自 core（L309-318）移入并订阅 `hud` 事件

**完整代码：**

```js
/* input.js —— 输入归一化为方向指令 + HUD/状态条等 DOM 更新。
   键盘/触屏按钮/滑动/暂停 → api；不直接改渲染与音频。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = Snake.S, K = Snake.K, bus = Snake.bus, api = Snake.api;

  const K1 = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right' };
  const K2 = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };
  const SPKEYS = { ShiftLeft: 0, KeyE: 0, ShiftRight: 1, Enter: 1, Slash: 1 }; // Shift 易串键，给足替代键

  /* ---------- HUD ---------- */
  function updateHud() {
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0];
      $('hl').innerHTML = '得分 <b>' + p.score + '</b> <span class="lives">' + '♥'.repeat(p.lives) + '</span>';
      $('hr').innerHTML = '最高 <b>' + S.best + '</b>';
    } else {
      $('hl').innerHTML = '<span style="color:' + K.SK[S.skin[0]].body[1] + ';font-weight:600">' + K.nm(0) + '</span> 胜 <b>' + S.wins[0] + '</b> · 长 ' + S.pl[0].body.length;
      $('hr').innerHTML = '长 ' + S.pl[1].body.length + ' · 胜 <b>' + S.wins[1] + '</b> <span style="color:' + K.SK[S.skin[1]].body[1] + ';font-weight:600">' + K.nm(1) + '</span>';
    }
  }
  const ebs = document.querySelectorAll('.eb'), sps = document.querySelectorAll('.pad .sp'),
        hds = document.querySelectorAll('.cmp .hd'), fds = document.querySelectorAll('.cmp .fd'), cmps = document.querySelectorAll('.cmp');
  function updateBars() {
    S.pl.forEach((p, i) => {
      if (!ebs[i]) return;
      ebs[i].firstElementChild.style.width = Math.round(p.energy) + '%';
      ebs[i].classList.toggle('lock', p.locked); ebs[i].classList.toggle('on', p.sprint);
      sps[i].classList.toggle('on', p.sprint);
      // 罗盘：箭头 = 朝向，橙点 = 最近食物（均按屏上视角）
      const d = p.dir, h = p.body[0];
      hds[i].style.transform = 'rotate(' + (Math.atan2((d[0] + d[1]) * K.HH, (d[0] - d[1]) * K.HW) * 57.3).toFixed(0) + 'deg)';
      let f = null, bd = 1e9;
      S.foods.forEach(o => { const m = Math.abs(o.x - h.x) + Math.abs(o.y - h.y); if (m < bd) { bd = m; f = o; } });
      if (f) { const ex = f.x - h.x, ey = f.y - h.y; fds[i].style.transform = 'rotate(' + (Math.atan2((ex + ey) * K.HH, (ex - ey) * K.HW) * 57.3).toFixed(0) + 'deg)'; }
      cmps[i].style.setProperty('--hc', K.SK[S.skin[i]].body[1]);
    });
  }

  /* ---------- 皮肤选择 ---------- */
  function drawSwatches() {
    document.querySelectorAll('.sw').forEach(box => {
      const p = +box.dataset.p; box.innerHTML = '';
      K.SK.forEach((s, k) => {
        const b = document.createElement('button');
        b.className = 'dot' + (S.skin[p] === k ? ' on' : ''); b.style.background = s.body[1];
        b.disabled = S.skin[1 - p] === k; b.setAttribute('aria-label', 'P' + (p + 1) + ' 颜色 ' + s.name);
        b.addEventListener('click', () => { b.blur(); api.setSkin(p, k); drawSwatches(); });
        box.appendChild(b);
      });
    });
  }

  /* ---------- 全屏 / 主屏提示 ---------- */
  const hint = $('hint'), showHint = () => hint.classList.add('show');
  const fullscreen = e => {
    e.currentTarget.blur();
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!rq) return showHint();
    try { const r = rq.call(el); if (r && r.catch) r.catch(showHint); } catch (err) { showHint(); }
  };

  function init() {
    hint.addEventListener('click', () => hint.classList.remove('show'));
    if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) $('fs').style.display = 'none';
    $('fs').addEventListener('click', fullscreen);

    addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'KeyP') { e.preventDefault(); api.togglePause(); return; }
      const sp = SPKEYS[e.code];
      if (sp !== undefined) { e.preventDefault(); if (S.state !== 'playing') api.start(); api.setHold(S.mode === 'pk' ? sp : 0, true); return; }
      const k1 = K1[e.code], k2 = K2[e.code];
      if (k1 || k2) { e.preventDefault(); api.press(k1 ? 0 : (S.mode === 'pk' ? 1 : 0), k1 || k2); }
    });
    addEventListener('keyup', e => { const s = SPKEYS[e.code]; if (s !== undefined) api.setHold(S.mode === 'pk' ? s : 0, false); });
    addEventListener('blur', () => S.pl.forEach(p => p.hold = false));

    document.querySelectorAll('.pad button[data-s]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); api.press(+b.parentElement.dataset.p, b.dataset.s); }));
    document.querySelectorAll('.pad .sp').forEach(b => { // 按住冲刺
      const i = +b.parentElement.dataset.p;
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} if (S.state !== 'playing') api.start(); api.setHold(i, true); });
      ['pointerup', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => api.setHold(i, false)));
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    document.querySelectorAll('.mode button[data-m]').forEach(b => b.addEventListener('click', () => {
      b.blur(); api.setMode(b.dataset.m);
      document.body.classList.toggle('pk', K.MODES[S.mode].players === 2);
      document.body.classList.toggle('ai', !!K.MODES[S.mode].ai);
      document.querySelectorAll('.mode button[data-m]').forEach(x => x.classList.toggle('on', x === b));
    }));
    drawSwatches();

    // 棋盘滑动转向 / 点按暂停
    let sx0 = 0, sy0 = 0;
    const cv = $('c');
    cv.addEventListener('pointerdown', e => { sx0 = e.clientX; sy0 = e.clientY; });
    cv.addEventListener('pointerup', e => {
      const dx = e.clientX - sx0, dy = e.clientY - sy0;
      if (Math.hypot(dx, dy) < 20) return api.togglePause();
      if (S.mode !== 'pk') api.press(0, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });

    bus.on('hud', updateHud);
    (function ui() { updateBars(); requestAnimationFrame(ui); })(); // 状态条/罗盘每帧同步
  }
  Snake.UI = { init, updateHud };
})();
```

- [ ] **Step 2: 校验** `node --check src/js/input.js`
- [ ] **Step 3: Commit** `git add src/js/input.js && git commit -m "refactor: 抽出 input.js——输入归一化与 HUD（行为不变）"`

---

## Task 6: audio.js 迁移 + 引导脚本

**Files:**
- Modify: `src/js/audio.js`（替换占位）、`src/index.html`（加内联引导脚本）
- 迁移来源: 基线 L377-390（ac/soundOn/initAudio/beep/snd 按钮）；v1 音效只有两处 beep（冲刺启动 & 能量锁死），由总线的 `sprintOn`/`sprintLock` 事件复制原声

**audio.js 完整代码（迁移版；Task 10 整体升级）：**

```js
/* audio.js —— WebAudio 全合成音效（迁移版：与 v1 行为一致；Task 10 升级） */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const bus = Snake.bus;
  let ac = null, soundOn = true;
  function initCtx() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
  }
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, initCtx, { passive: true }));
  function beep(f1, f2, dur, vol) {
    if (!soundOn || !ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f1, n); o.frequency.exponentialRampToValueAtTime(f2, n + dur);
      g.gain.setValueAtTime(vol, n); g.gain.exponentialRampToValueAtTime(0.001, n + dur);
      o.connect(g); g.connect(ac.destination); o.start(n); o.stop(n + dur);
    } catch (e) {}
  }
  function init() {
    const snd = document.getElementById('snd');
    snd.addEventListener('click', e => { soundOn = !soundOn; e.currentTarget.textContent = '音效 ' + (soundOn ? '开' : '关'); e.currentTarget.blur(); });
    bus.on('sprintOn', () => beep(220, 720, .14, .05));
    bus.on('sprintLock', () => beep(300, 120, .2, .05));
  }
  Snake.Audio = { init };
})();
```

**src/index.html 引导脚本**（`</body>` 前、最后一段）：

```html
<script>
(function () {
  'use strict';
  Snake.Ai.init();
  Snake.Audio.init();
  Snake.UI.init();
  Snake.Render.boot();
  Snake.api.reset();
})();
</script>
```

- [ ] **Step 2: 校验** `node --check src/js/audio.js`；`node build.js`
- [ ] **Step 3: 基线行为走查（browser_use 子代理，`http://localhost:8098/src/index.html`）**：
  1. 简单模式：方向键开玩、吃食计分、撞墙掉命（剩 2 命暂停提示）、3 命耗尽结算、最高分刷新记忆；
  2. 普通/双人/人机三档都能开始、游玩、正常判定胜负；AI 正常吃食；
  3. 冲刺：E 键积分能量、能量归零锁定；冲刺启动/锁死两声 beep 与 v1 一致；音效开关按钮生效；
  4. 皮肤选择、双人不同色互斥生效；全屏按钮、点按暂停、滑动转向正常；移动端竖屏出现横屏提示。
- [ ] **Step 4: Commit** `git add src/js/audio.js src/index.html && git commit -m "refactor: 抽出 audio.js 与引导脚本，完成多文件迁移（行为与 v1 一致）"`

---

## Task 7: themes.js —— 10 套数据驱动主题

**Files:**
- Modify: `src/js/themes.js`（替换占位，完整重写）、`src/index.html`（加主题色点行、引导加 `Snake.Themes.init()`）、`src/css/base.css`（变量重构 + 主题点样式）、`src/js/render.js`（改读主题调色板）

- [ ] **Step 1: themes.js 完整代码**

```js
/* themes.js —— 主题 = 纯数据注册表。新增主题：往 THEMES 数组追加一个对象即可，零逻辑改动。
   主题数据：css 7 变量（UI 用）+ canvas 8 色（render 只读此对象，不写死颜色）。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const KEY = 'snake.theme';
  const THEMES = [
    { id: 'neon-night', name: '霓虹夜',
      css: { bg: '#060a14', fg: '#e6ecff', muted: '#7f8fb5', f1: '#0a1122', f2: '#0c142a', edge: '#1b2a55', btn: '#0d1530' },
      canvas: { f1: '#0a1122', f2: '#0c142a', edge: '#1b2a55', grid: 'rgba(80,220,255,.2)', glow: '#3b82f6', food: '#ff7a45', star: '#c8dcff', spark: '#60a5fa' } },
    { id: 'glacier', name: '冰川',
      css: { bg: '#eef6fa', fg: '#243447', muted: '#64748b', f1: '#dbeef7', f2: '#cfe5f2', edge: '#a7c8dd', btn: '#ffffff' },
      canvas: { f1: '#dbeef7', f2: '#cfe5f2', edge: '#a7c8dd', grid: 'rgba(56,180,248,.25)', glow: '#38bdf8', food: '#ff6b6b', star: null, spark: '#7dd3fc' } },
    { id: 'cyber', name: '赛博',
      css: { bg: '#0d0221', fg: '#f5e9ff', muted: '#9d7bd8', f1: '#150733', f2: '#19083c', edge: '#2d1366', btn: '#1e0b4d' },
      canvas: { f1: '#150733', f2: '#19083c', edge: '#2d1366', grid: 'rgba(232,121,249,.25)', glow: '#e879f9', food: '#facc15', star: '#e0b3ff', spark: '#c084fc' } },
    { id: 'candy', name: '糖果',
      css: { bg: '#fff5f9', fg: '#5c2233', muted: '#b06a80', f1: '#ffe4ee', f2: '#ffd6e6', edge: '#f3b8cd', btn: '#ffffff' },
      canvas: { f1: '#ffe4ee', f2: '#ffd6e6', edge: '#f3b8cd', grid: 'rgba(236,72,153,.22)', glow: '#ec4899', food: '#22c55e', star: null, spark: '#f472b6' } },
    { id: 'retro', name: '经典绿屏',
      css: { bg: '#06120b', fg: '#b7ffd9', muted: '#5c8f74', f1: '#0a1f12', f2: '#0c2416', edge: '#1d4a33', btn: '#0e2b1c' },
      canvas: { f1: '#0a1f12', f2: '#0c2416', edge: '#1d4a33', grid: 'rgba(52,211,153,.22)', glow: '#34d399', food: '#ffd15c', star: null, spark: '#6ee7b7' } },
    { id: 'lava', name: '熔岩',
      css: { bg: '#160707', fg: '#ffe4d6', muted: '#b0806e', f1: '#2a0d0d', f2: '#301010', edge: '#5a1f1f', btn: '#381414' },
      canvas: { f1: '#2a0d0d', f2: '#301010', edge: '#5a1f1f', grid: 'rgba(249,115,22,.25)', glow: '#f97316', food: '#fbbf24', star: '#ffc9a3', spark: '#fb923c' } },
    { id: 'forest', name: '森林翡翠',
      css: { bg: '#0c1610', fg: '#d9f2e2', muted: '#6f9c83', f1: '#101f16', f2: '#12241a', edge: '#1f4533', btn: '#162b1f' },
      canvas: { f1: '#101f16', f2: '#12241a', edge: '#1f4533', grid: 'rgba(16,185,129,.22)', glow: '#10b981', food: '#f59e0b', star: '#cdeee0', spark: '#34d399' } },
    { id: 'dusk', name: '暮光紫',
      css: { bg: '#171226', fg: '#eae4ff', muted: '#8d81b8', f1: '#1f1733', f2: '#231a3a', edge: '#37295f', btn: '#2a2050' },
      canvas: { f1: '#1f1733', f2: '#231a3a', edge: '#37295f', grid: 'rgba(139,92,246,.25)', glow: '#8b5cf6', food: '#f97316', star: '#d5cbff', spark: '#a78bfa' } },
    { id: 'desert', name: '沙漠琥珀',
      css: { bg: '#faf3e4', fg: '#5c4723', muted: '#a08c62', f1: '#f3e6c8', f2: '#ecdbba', edge: '#d8c39a', btn: '#fffdf6' },
      canvas: { f1: '#f3e6c8', f2: '#ecdbba', edge: '#d8c39a', grid: 'rgba(245,158,11,.28)', glow: '#f59e0b', food: '#dc2626', star: null, spark: '#fbbf24' } },
    { id: 'abyss', name: '深渊',
      css: { bg: '#020610', fg: '#d6ecff', muted: '#5f86a8', f1: '#04101f', f2: '#051426', edge: '#0c2b4d', btn: '#081a33' },
      canvas: { f1: '#04101f', f2: '#051426', edge: '#0c2b4d', grid: 'rgba(14,165,233,.2)', glow: '#0ea5e9', food: '#ff5a5a', star: '#9cc8ff', spark: '#38bdf8' } }
  ];
  const DEFAULTS = THEMES[0];
  let current = DEFAULTS;

  function apply(id, persist = true) {
    const t = THEMES.find(x => x.id === id);
    if (!t) { console.warn('[themes] 未知主题 id: ' + id + '，回退默认'); current = DEFAULTS; }
    else current = t;
    const r = document.documentElement.style;
    for (const k in current.css) r.setProperty('--' + k, current.css[k]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', current.css.bg);
    if (persist) Snake.K.safeSet(KEY, current.id);   // ?theme= 直链不落盘
    drawDots();
    Snake.bus.emit('themeChange', current);   // render 重建地板缓存
  }
  function buildDots() {
    const box = document.getElementById('thms');
    if (!box) return;
    THEMES.forEach(t => {
      const b = document.createElement('button');
      b.className = 'tdot'; b.style.background = t.css.bg; b.setAttribute('aria-label', t.name);
      b.addEventListener('click', () => { b.blur(); apply(t.id); });
      box.appendChild(b);
    });
    drawDots();
  }
  function drawDots() {
    document.querySelectorAll('#thms .tdot').forEach((b, i) => b.classList.toggle('on', THEMES[i] === current));
  }
  function init() {
    buildDots();
    const q = new URLSearchParams(location.search).get('theme');
    apply(q || Snake.K.safeGet(KEY, '') || DEFAULTS.id, !q);
  }
  Snake.Themes = { list: THEMES, init, apply, get current() { return current; } };
})();
```

- [ ] **Step 2: base.css 变量重构 + 主题点样式**

  - 删除基线 L21-24 的三行：`@media (prefers-color-scheme:dark)…`、`:root[data-theme="dark"]{…}`、`html:root:root:root{…}`；
  - 将 L18 的 `:root` 值改为霓虹夜默认值（`--bg:#060a14;--fg:#e6ecff;--muted:#7f8fb5;--f1:#0a1122;--f2:#0c142a;--edge:#1b2a55;--btn:#0d1530`，其余 box-sizing/safe-area 保留）——保证 JS 未执行时首屏即默认主题；
  - 追加主题点样式（`.mode` 规则后）：

```css
.thms{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:0 0 10px}
.tdot{width:22px;height:22px;border-radius:50%;border:2px solid var(--edge);padding:0;cursor:pointer;touch-action:manipulation}
.tdot:hover{transform:scale(1.15)}
.tdot.on{border-color:var(--fg);box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--fg)}
body.pk .thms{display:none}
```

- [ ] **Step 3: index.html** —— `.mode` 块后加入 `<div class="thms" id="thms"></div>`；引导脚本第一行加 `Snake.Themes.init();`（置于 `Snake.Ai.init()` 之前）。

- [ ] **Step 4: render.js 改读主题调色板** —— 修改点：

  1. 删除 `readTheme` 函数、`readTheme()` 调用、`matchMedia(...)` 监听、`MutationObserver` 监听共 4 处；`theme` 改为 `Snake.Themes.current.canvas` 的只读引用，函数内统一用 `const T = () => Snake.Themes.current.canvas;`，地板绘制处取 `T().f1/f2/edge`，`themeChange` 事件时 `boardCache = null`（`bus.on('themeChange', () => { boardCache = null; })`）；
  2. `paintBoard`：`theme.f1/theme.f2/theme.edge` → `T().f1/T().f2/T().edge`；网格 `'rgba(80,220,255,.2)'` → `T().grid`；
  3. `draw` 星空：`STARS.forEach` 前加 `const T = () => Snake.Themes.current.canvas;` 并在循环外判断 `if (T().star)`；颜色 `'rgba(200,220,255,'+α+')'` → `K.rgba(T().star, α)`；
  4. `draw` 中 `fg` 与食物、头光晕：
     - `const fg = K.MODES[S.mode].players === 2 ? '#cbd5e1' : '#ff7a45';` → `const fg = T().glow;`
     - 食物立方颜色 `K.FOOD` → `K.shades(T().food)`（pk 仍用 `K.FOOD_PK`）；
     - 头光晕 `'#3B82F6'` → `T().glow`；
  5. `streak`：两处硬编码色改为 `K.rgba(T().glow, …)` 与 `'rgba(220,240,255,…)'` → `K.rgba(K.shades(T().glow)[0], …)`（`const T` 由 `draw` 传入或经 `Snake.Themes.current` 读取）；
  6. `lightning`/`zig`：`'rgba(80,150,255,.55)'` → `K.rgba(T().glow, .55)`；`'#eaf4ff'` → `K.shades(T().glow)[0]`。

- [ ] **Step 5: 校验** `node --check src/js/themes.js src/js/render.js`；`node build.js`。
- [ ] **Step 6: 走查**（`http://localhost:8098/src/index.html`）：10 个主题点显示且底色为该主题 bg；逐个点击：CSS 变量、地板双色、网格色、食物色、星空有无、`<meta name="theme-color">` 全部生效；对局进行中切换不打断游戏；刷新后主题记忆生效；`?theme=cyber` 直达且不覆盖持久化记忆（记忆优先）。`dist/index.html` 与 src 行为一致。
- [ ] **Step 7: Commit** `git add src/ && git commit -m "feat: 10 套数据驱动主题皮肤，可切换可记忆，渲染全面主题化"`

---

## Task 8: particles.js —— 对象池粒子系统 + 食物光晕

**Files:**
- Modify: `src/js/particles.js`（替换占位，完整重写）、`src/js/render.js`（删除 parts/burst/drawParts，整合食物光晕脉冲）

- [ ] **Step 1: particles.js 完整代码**

```js
/* particles.js —— 固定容量对象池（256，超限覆盖最旧），不产生 GC 压力。
   只听 bus 事件出特效，不改游戏状态；lowFx 按 spec §2.2 表降级。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const CAP = 256;
  const pool = Array.from({ length: CAP }, () => ({})); // 预填充空对象，Object.assign 第一发不抛
  let head = 0, count = 0;
  let fw = []; // 排队中的烟花 [{at, x, y, col}]
  const K = Snake.K, S = Snake.S, bus = Snake.bus;

  function spawn(o) {
    const p = pool[head]; head = (head + 1) % CAP; if (count < CAP) count++;
    Object.assign(p, { vx: 0, vy: 0, g: 90, life: .5, age: 0 }, o);
  }
  /* 向四周喷溅 n 粒；colFn(i) 返回色值 */
  function emit(x, y, n, speed, lift, life, colFn) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = speed * (.4 + Math.random());
      spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - lift, life: life * (.7 + Math.random() * .6), col: colFn(i) });
    }
  }
  function eat(d) { // 吃食爆炸：12 粒（lowFx 减半），food + spark 色
    const n = S.lowFx ? 6 : 12;
    const [sx, sy] = K.P(d.x, d.y);
    const c = Snake.Themes.current.canvas;
    emit(sx, sy + K.HH - 6, n, 60, 20, .75, i => (i % 2 ? c.spark : c.food));
  }
  function crash(d) { // 撞击火花：每个蛇头 20 粒（lowFx 减半）
    const n = S.lowFx ? 10 : 20;
    const spark = Snake.Themes.current.canvas.spark;
    (d.heads || []).forEach(h => {
      const [sx, sy] = K.P(h.x, h.y);
      emit(sx, sy + K.HH - 6, n, 80, 30, .8, () => spark);
    });
  }
  function win(d) { // 胜利烟花：3 轮 × 14 粒（lowFx 1 轮），多种 spark 衍生色
    const rounds = S.lowFx ? 1 : 3;
    const c = Snake.Themes.current.canvas;
    const cols = [c.spark, K.shades(c.spark)[0], c.food, '#ffffff', c.glow];
    for (let r = 0; r < rounds; r++) {
      const x = S.OX + (r - (rounds - 1) / 2) * S.W * .24, y = K.OY + S.H * .22 - r * 26;
      for (let b = 0; b < 14; b++) fw.push({ at: performance.now() + r * 420 + Math.random() * 80, x, y, col: cols[(r * 3 + b) % cols.length] });
    }
  }
  function trailTick() { // 冲刺拖尾：每帧沿蛇身 1-2 粒 spark 短光点（lowFx 关闭，保留电弧）
    if (S.lowFx) return;
    const spark = Snake.Themes.current.canvas.spark;
    S.pl.forEach(p => {
      if (!p.sprint || p.body.length < 2) return;
      for (let k = 0; k < 2; k++) {
        const j = 1 + K.rand(p.body.length - 1);
        const [sx, sy] = K.P(p.body[j].x, p.body[j].y);
        spawn({ x: sx + (Math.random() - .5) * 10, y: sy + K.HH - 6, vx: (Math.random() - .5) * 30, vy: -20 - Math.random() * 20, life: .25, col: spark });
      }
    });
  }
  function draw(ctx, dt) { // render 每帧调用
    while (fw.length && performance.now() >= fw[0].at) { const q = fw.shift(); emit(q.x, q.y, 14, 70, 30, .9, () => q.col); }
    if (!count) return;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const q = pool[(head - count + i + CAP) % CAP];
      q.age += dt;
      if (q.age >= q.life) continue;
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += q.g * dt;
      const k = 1 - q.age / q.life;
      ctx.fillStyle = K.rgba(q.col, k.toFixed(2));
      const r = 2.2 * k;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function reset() { count = 0; fw = []; }

  bus.on('eat', eat);
  bus.on('crash', crash);
  bus.on('win', win);
  bus.on('gameStart', reset);
  Snake.Particles = { draw, trailTick, reset };
})();
```

- [ ] **Step 2: render.js 整合** —— 修改点：

  1. 删除 `const parts = []`、`burst`、`drawParts` 三块；`drawParts(dt)` 调用 → `Snake.Particles.trailTick(); Snake.Particles.draw(ctx, dt);`（位置保持：`headFx` 之后、pk 名牌之前）；
  2. 食物光晕脉冲（spec §2.2「食物常驻光晕」，非粒子，直接绘制；lowFx 静态）——替换 draw 中 `S.foods.forEach(...)` 一行：

```js
  S.foods.forEach(f => {
    const [sx, sy] = K.P(f.x, f.y);
    const a = S.lowFx ? .18 : .12 + .08 * Math.sin(t / 300 + f.x * 3 + f.y * 5);
    diamond(sx, sy + K.HH, K.HW * 1.5, K.HH * 1.5, K.rgba(T().glow, a.toFixed(2)));
  });
```

- [ ] **Step 3: 校验** `node --check src/js/particles.js src/js/render.js`；`node build.js`。
- [ ] **Step 4: 走查**：吃食爆炸（food+spark 色）、双人/人机获胜 3 轮烟花、撞击扇面火花、冲刺拖尾粒子 + 原电弧并存、食物光晕呼吸；DevTools CPU 6x 节流：`lowFx` 生效——粒子减半/关闭、无报错、帧率回升。
- [ ] **Step 5: Commit** `git add src/ && git commit -m "feat: 对象池粒子系统（吃食/撞击/烟花/冲刺拖尾）与食物光晕，lowFx 降级"`

---

## Task 9: audio.js 升级 —— 完整音效 + 可选 BGM

**Files:**
- Modify: `src/js/audio.js`（完整重写）、`src/index.html`（`.mode` 行加 `<button id="mus">音乐 关</button>`）

**完整代码：**

```js
/* audio.js —— WebAudio 全合成（无资源文件）。bus 事件驱动；不支持 WebAudio 时整体静默 no-op。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const bus = Snake.bus, K = Snake.K;
  let ac = null, sfx = true, music = false, bgmTimer = null;
  const sprints = {};   // i → 冲刺呼啸节点组

  function initCtx() {
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, initCtx, { passive: true }));
  const safeGet = K.safeGet, safeSet = K.safeSet;

  /* ---------- 合成原语 ---------- */
  function tone(f1, f2, dur, vol, type, when) { // 振荡器扫频
    if (!sfx || !ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime + (when || 0);
      o.type = type || 'sawtooth'; o.frequency.setValueAtTime(f1, n); o.frequency.exponentialRampToValueAtTime(f2, n + dur);
      g.gain.setValueAtTime(vol, n); g.gain.exponentialRampToValueAtTime(0.001, n + dur);
      o.connect(g); g.connect(ac.destination); o.start(n); o.stop(n + dur + .02);
    } catch (e) {}
  }
  function noiseHit(dur, vol, cut, when) { // 白噪声短脉冲 + 低通
    if (!sfx || !ac) return;
    try {
      const n = ac.currentTime + (when || 0), len = Math.max(1, (dur * ac.sampleRate) | 0);
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cut, n); f.frequency.exponentialRampToValueAtTime(Math.max(80, cut * .2), n + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(vol, n); g.gain.exponentialRampToValueAtTime(0.001, n + dur);
      src.connect(f); f.connect(g); g.connect(ac.destination); src.start(n);
    } catch (e) {}
  }
  function startWhoosh(i) { // 冲刺呼啸：循环噪声 + 低通扫频 LFO
    if (!sfx || !ac || sprints[i]) return;
    try {
      const len = (ac.sampleRate * .5) | 0, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 1.2;
      const lfo = ac.createOscillator(); lfo.frequency.value = 7;
      const lg = ac.createGain(); lg.gain.value = 380;
      lfo.connect(lg); lg.connect(f.frequency);
      const g = ac.createGain(); g.gain.value = .05;
      src.connect(f); f.connect(g); g.connect(ac.destination);
      src.start(); lfo.start();
      sprints[i] = { src, f, lfo, g, gain: g };
    } catch (e) {}
  }
  function stopWhoosh(i) {
    const s = sprints[i]; if (!s) return;
    try {
      s.g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + .15);
      setTimeout(() => { try { s.src.stop(); s.lfo.stop(); } catch (e) {} }, 200);
    } catch (e) {}
    sprints[i] = null;
  }

  /* ---------- 事件声音 ---------- */
  function onEat(d) { // 正弦短促音；基础音高随连击升调，12 阶梯后循环
    const step = Math.min((d.streak - 1) % 12, 11);
    tone(392 * Math.pow(1.059463, step), 392 * Math.pow(1.059463, step) * 1.5, .1, .09, 'sine');
  }
  function onSprintOn(d) { startWhoosh(d.i); tone(220, 720, .14, .05); }
  function onSprintOff(d) { stopWhoosh(d.i); }
  function onSprintLock() { tone(300, 120, .2, .05); }
  function onCrash() { noiseHit(.25, .3, 1400); }
  function onWin() { // 上行大三和弦三连音
    [261.63, 329.63, 392].forEach((f, i) => tone(f, f, .16, .1, 'triangle', i * .12));
  }
  function onLose() { // 下行双音
    [330, 220].forEach((f, i) => tone(f, f * .85, .22, .09, 'triangle', i * .18));
  }

  /* ---------- BGM：轻柔琶音循环（三角波、低增益、约 90 BPM，默认关） ---------- */
  const CHORDS = [[261.63, 329.63, 392, 523.25], [220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23], [196, 246.94, 293.66, 392]]; // C-Am-F-G
  function bgmNote() {
    if (!music || !ac) return;
    try {
      const c = CHORDS[(bgmNote.k = (bgmNote.k || 0) + 1) % CHORDS.length];
      c.forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime + i * .07;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, n); g.gain.linearRampToValueAtTime(.028, n + .02); g.gain.exponentialRampToValueAtTime(0.001, n + .5);
        o.connect(g); g.connect(ac.destination); o.start(n); o.stop(n + .55);
      });
    } catch (e) {}
  }
  function bgmStart() { if (bgmTimer) return; initCtx(); bgmNote(); bgmTimer = setInterval(bgmNote, 667); }
  function bgmStop() { clearInterval(bgmTimer); bgmTimer = null; }

  function init() {
    sfx = safeGet('snake.sfx', '1') !== '0';
    music = safeGet('snake.music', '0') === '1';
    const snd = document.getElementById('snd'), mus = document.getElementById('mus');
    snd.textContent = '音效 ' + (sfx ? '开' : '关');
    mus.textContent = '音乐 ' + (music ? '开' : '关');
    snd.addEventListener('click', e => { sfx = !sfx; safeSet('snake.sfx', sfx ? '1' : '0'); e.currentTarget.textContent = '音效 ' + (sfx ? '开' : '关'); e.currentTarget.blur(); });
    mus.addEventListener('click', e => {
      music = !music; safeSet('snake.music', music ? '1' : '0');
      e.currentTarget.textContent = '音乐 ' + (music ? '开' : '关'); e.currentTarget.blur();
      if (music) bgmStart(); else bgmStop();
    });
    if (music) bgmStart(); // 已记忆开启时自动续播（浏览器策略允许时）
    bus.on('eat', onEat);
    bus.on('sprintOn', onSprintOn);
    bus.on('sprintOff', onSprintOff);
    bus.on('sprintLock', onSprintLock);
    bus.on('crash', onCrash);
    bus.on('win', onWin);
    bus.on('lose', onLose);
  }
  Snake.Audio = { init };
})();
```

- [ ] **Step 2: 校验** `node --check src/js/audio.js`；`node build.js`。
- [ ] **Step 3: 走查**：吃食连击音阶爬升（12 阶后循环）；按住冲刺有呼啸，松开即停、能量锁死有提示音；撞击/获胜/失败三音正确；音乐开关独立生效、默认关、BGM 约 90BPM 轻柔；两开关刷新后记忆；首次点击前无任何自动发声（AudioContext 手势解锁）。
- [ ] **Step 4: Commit** `git add src/ && git commit -m "feat: 全合成音效升级（连击阶梯/冲刺呼啸/胜负旋律）与可选琶音 BGM，开关状态记忆"`

---

## Task 10: 终验 —— 构建一致性、lowFx、移动端、AI 回归

- [ ] **Step 1: 静态语法**：`Get-ChildItem src/js/*.js | ForEach-Object { node --check $_.FullName }` 全部无输出通过。
- [ ] **Step 2: 打包一致性走查**（`node build.js` 后，浏览器同清单走查 `http://localhost:8098/dist/index.html`，与 src 行为逐项一致：4 模式、10 主题、粒子、音效、记忆）。
- [ ] **Step 3: 专项回归**：
  1. AI 回归：人机三档各对局一局，AI 吃食/预判/冲刺正常（本次未改 AI 算法，仅确认迁移无损）；
  2. lowFx：CPU 6x 节流下自动降级且无报错；恢复后不影响后续对局；
  3. 移动端：DevTools 模拟 iPhone，横屏 pk 布局、竖屏横屏提示、触屏按钮、滑动转向正常；
  4. 隐私模式：无痕窗口打开无报错，主题回退默认霓虹夜，记忆不落盘；
  5. 键盘盲区：WASD（P1）+ 方向键（P2/单人）+ 空格/点按暂停 + Shift/E/Enter 冲刺全通道正常。
- [ ] **Step 4: 修复走查发现的问题后** Commit：`git add -A && git commit -m "test: v2 全量走查通过（构建一致性/lowFx/移动端/AI 回归）"`

---

## Task 11: 截图候选 + 交用户验收（不碰 GitHub）

- [ ] **Step 1: 截图工具**（Edge headless，无需安装任何依赖）：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (!(Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
& $edge --headless --disable-gpu --hide-scrollbars --window-size=1280,900 `
  --screenshot="d:\WorkBuddy\贪吃蛇\screenshots\neon-night.png"    "http://localhost:8098/src/index.html?theme=neon-night"
& $edge --headless --disable-gpu --hide-scrollbars --window-size=1280,900 `
  --screenshot="d:\WorkBuddy\贪吃蛇\screenshots\cyber.png"         "http://localhost:8098/src/index.html?theme=cyber"
& $edge --headless --disable-gpu --hide-scrollbars --window-size=1280,900 `
  --screenshot="d:\WorkBuddy\贪吃蛇\screenshots\candy.png"         "http://localhost:8098/src/index.html?theme=candy"
& $edge --headless --disable-gpu --hide-scrollbars --window-size=1280,900 `
  --screenshot="d:\WorkBuddy\贪吃蛇\screenshots\lava.png"          "http://localhost:8098/src/index.html?theme=lava&mode=pk"
```

（每张图调用之间加 `--user-data-dir` 临时目录参数可避免 profile 锁冲突：追加 `--user-data-dir="$env:TEMP\snake-shot-<序号>"`；若截图空白可加 `--virtual-time-budget=4000`。最终确认 4 张图内容含棋盘、蛇、食物与对应主题配色。）

- [ ] **Step 2: 人眼复检 + 补充**：查看 4 张截图，若构图不佳换主题/窗口尺寸重截；候选保持 3-5 张、命名含主题 id。
- [ ] **Step 3: Commit**：`git add screenshots/ && git commit -m "assets: v2 主题截图候选（待用户挑选）"`
- [ ] **Step 4: 交付验收**：向用户汇报——本地成品 `src/`（双击 `index.html` 即玩）与单文件 `dist/index.html`、4 张截图候选路径、10 主题/粒子/音效清单；**明确告知发布已暂停，等用户验收意见**。用户认可后按 yeet 流程发布（另开任务）；有意见按反馈回改。

---

## 自审结论

- **Spec 覆盖**：§2.1 主题（Task 7：10 套表、切换点 UI、记忆、meta 同步、回退默认）；§2.2 粒子（Task 8：池 256、5 效果、lowFx 表、食物光晕脉冲）；§2.3 音频（Task 9：6 类音 + BGM 默认关 + 两开关记忆 + 手势解锁）；§2.4 架构（Task 1-6：目录/加载顺序/全局命名空间/事件总线/build.js）；§4 错误处理（safeGet/safeSet/主题回退/no-op 音频/池满覆盖/build 缺失报错均落地）；§6 测试（各任务验证步 + Task 10 全量）。未覆盖项：§2.5 发布（用户已叫停，验收后另开任务）、§8 后续批次（明确不做）。
- **占位符**：无 TBD/TODO；所有新增代码全文给出。
- **类型/命名一致性**：`Snake.S/Snake.K/Snake.bus/Snake.api/Snake.hooks` 全计划统一；`theme.current.canvas` 字段 `{f1,f2,edge,grid,glow,food,star,spark}` 在 themes.js、particles.js、render.js 三处引用一致；事件名与载荷（`eat{x,y,pk,streak,i}` / `crash{heads}` / `win{winner}`）与 core.js 发射端一致。
- **正文偏差记录**：见 §0 约定第 3 条（canvas 字段命名、事件一步到位、URL 参数）。