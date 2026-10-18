# v3 视觉精炼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主题精简 7 套 + 细腻化方向 B（光影层+图案注册表）+ 全模式统一沉浸式布局 A + 画布防拉伸，产出可验收的 v3 视觉成品。

**Architecture:** 延续 v2 架构——经典 script 顺序加载、`window.Snake` 命名空间、事件总线单向通信。新增 `src/js/patterns.js` 纯函数注册表，绘制进 render 的 boardCache 离屏层（每帧零成本）；布局由 `body.im` 类（matchMedia 横屏或 ≥760px）驱动，CSS 沉浸规则自 `body.pk` 迁移；画布尺寸在沉浸下由 JS fit 保比例。

**Tech Stack:** 原生 JS/Canvas/CSS，零依赖；Node 仅跑 build.js 与沙盒校验；Edge headless 截图。

**Spec:** `docs/superpowers/specs/2026-10-18-snake-v3-visual-refine-design.md`

**环境约定：** Windows PowerShell 5（无 `&&`，用 `;`）；本地服务器 `python -m http.server 8098`（若未运行：后台启动之，cwd=项目根）；浏览器走查可用 browser_use 子代理或 Edge headless（干净 profile 免缓存坑）。

---

### Task 1: 主题精简 10 → 7

**Files:**
- Modify: `src/js/themes.js`（LIST 删 3 条目）

- [ ] **Step 1: 删除 retro 条目**

Edit `src/js/themes.js`，old_string:

```js
    { id: 'retro', name: '绿屏', css: { bg: '#06120b', fg: '#d7ffe8', muted: '#6fae8c', f1: '#07180e', f2: '#081c11', edge: '#175236', btn: '#0a2015' },
      canvas: { floorTop: '#0c2214', floorLeft: '#0a1c11', floorRight: '#08170e', grid: 'rgba(52,211,153,.22)', glow: '#34d399', food: '#ffd15c', star: null, spark: '#34d399' } },
```

new_string: 空（整行删除）。

- [ ] **Step 2: 删除 dusk 条目**

old_string:

```js
    { id: 'dusk', name: '暮光', css: { bg: '#171226', fg: '#e9e2ff', muted: '#978bad', f1: '#1f1836', f2: '#241c3e', edge: '#45326e', btn: '#211a3a' },
      canvas: { floorTop: '#261d41', floorLeft: '#21193a', floorRight: '#1c1533', grid: 'rgba(139,92,246,.24)', glow: '#8b5cf6', food: '#f97316', star: '#cdb9ff', spark: '#a78bfa' } },
```

new_string: 空。

- [ ] **Step 3: 删除 abyss 条目**

old_string:

```js
    { id: 'abyss', name: '深渊', css: { bg: '#020610', fg: '#cfe9ff', muted: '#6b86a8', f1: '#04101f', f2: '#051426', edge: '#0d2a4a', btn: '#061629' },
      canvas: { floorTop: '#081b30', floorLeft: '#061629', floorRight: '#051223', grid: 'rgba(14,165,233,.20)', glow: '#0ea5e9', food: '#ff5a5a', star: '#9fd0ff', spark: '#38bdf8' } }
```

new_string:

```js
    { id: 'desert', name: '沙漠', css: { bg: '#faf3e4', fg: '#4a3620', muted: '#9d8a6b', f1: '#f5e8cd', f2: '#efdfc0', edge: '#dcc9a3', btn: '#fffaf0' },
      canvas: { floorTop: '#f5e7ca', floorLeft: '#eeddbb', floorRight: '#e6d2ab', grid: 'rgba(245,158,11,.25)', glow: '#f59e0b', food: '#dc2626', star: null, spark: '#fbbf24' } }
```

（即 abyss 删除后 desert 成为末条目；若 desert 行原本以 `} },` 结尾带逗号，则同步去掉逗号——以文件实际为准，保证 LIST 语法正确。）

- [ ] **Step 4: 校验条目数与语法**

Run: `node --check src/js/themes.js; (Select-String -Path src/js/themes.js -Pattern "\{ id:").Count`
Expected: 无语法报错；计数 `7`。

- [ ] **Step 5: 浏览器校验（含旧记忆回退）**

打开 `http://localhost:8098/src/index.html`，evaluate：
`Snake.theme.list.length + '|' + document.querySelectorAll('.th .dot').length`  Expected: `7|7`
再 evaluate：`localStorage.setItem('snake.theme','abyss'); location.reload()` 后读 `Snake.theme.current.id`  Expected: `neon-night`（回退生效），读完清回：`localStorage.removeItem('snake.theme')`。

- [ ] **Step 6: Commit ①**

```powershell
git add src/js/themes.js; git commit -m "refactor: 主题精简 10→7（删 绿屏/深渊/暮光，旧记忆自动回退霓虹夜）"
```

---

### Task 2: patterns.js 图案注册表 + 接线（本任务不提交，随 Task 3 合入 commit ②）

**Files:**
- Create: `src/js/patterns.js`
- Modify: `src/index.html`（script 标签）
- Modify: `src/js/themes.js`（7 条目加 pattern 字段）

- [ ] **Step 1: 创建 src/js/patterns.js**

```js
/* patterns.js —— 地板图案注册表（纯函数；由 render 的 paintBoard 在离屏缓存里调用，每帧零成本）
   新增图案 = PAT 加一个函数 + 主题数据写 pattern id；核心/render 零改动。查无 id 静默 no-op。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const K = Snake.K, fr = K.fr;
  function pulse(c, cx, cy, p, x, y) { // 霓虹夜：脉冲网格
    if ((x * 7 + y * 13) % 5) return;
    c.strokeStyle = K.rgba(p.glow, .35); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy - K.HH * .45); c.lineTo(cx + K.HW * .45, cy); c.lineTo(cx, cy + K.HH * .45); c.lineTo(cx - K.HW * .45, cy); c.closePath(); c.stroke();
    c.fillStyle = K.rgba(p.glow, .5); c.fillRect(cx - 1, cy - 1, 2, 2);
  }
  function ice(c, cx, cy, p, x, y) { // 冰川：裂纹
    if (fr(x * 3 + y * 5 + 1) <= .6) return;
    const a = fr(x * 5 + y * 7 + 2) * 6.283;
    c.strokeStyle = K.rgba(p.glow, .3); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * K.HW * .8, cy + Math.sin(a) * K.HH * .8);
    c.lineTo(cx + (fr(x + y * 2) - .5) * 6, cy + (fr(x * 2 + y) - .5) * 4); c.lineTo(cx, cy); c.stroke();
  }
  function circuit(c, cx, cy, p, x, y) { // 赛博：电路走线+节点
    if ((x + y) % 4) return;
    c.strokeStyle = K.rgba(p.glow, .35); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - K.HW * .8, cy); c.lineTo(cx, cy); c.lineTo(cx, cy - K.HH * .8); c.stroke();
    c.fillStyle = K.rgba(p.glow, .5); c.fillRect(cx - 1, cy - 1, 2, 2);
  }
  function sprinkle(c, cx, cy, p, x, y) { // 糖果：糖粒短棒
    for (let i = 0; i < 3; i++) {
      const s = x * 11 + y * 17 + i * 5;
      const bx = cx + (fr(s) - .5) * K.HW * 1.2, by = cy + (fr(s + 1) - .5) * K.HH * 1.2;
      const a = fr(s + 2) * 3.14, len = 2 + fr(s + 3) * 2;
      c.strokeStyle = K.rgba(i % 2 ? p.spark : p.food, .35); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len * .5); c.stroke();
    }
  }
  function moss(c, cx, cy, p, x, y) { // 森林：苔藓斑
    const n = 4 + Math.floor(fr(x * 13 + y * 7) * 3);
    c.fillStyle = K.rgba(p.spark, .3);
    for (let i = 0; i < n; i++) { const s = x * 7 + y * 11 + i * 3; c.fillRect(cx + (fr(s) - .5) * K.HW * 1.4, cy + (fr(s + 1) - .5) * K.HH * 1.4, 1.5, 1.5); }
  }
  function ember(c, cx, cy, p, x, y) { // 熔岩：余烬裂
    c.strokeStyle = K.rgba(p.glow, .3); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - K.HW * .7, cy + (fr(x + y) - .5) * 4);
    c.lineTo(cx - K.HW * .2, cy + (fr(x * 3 + y) - .5) * 5);
    c.lineTo(cx + K.HW * .3, cy + (fr(x + y * 3) - .5) * 5);
    c.lineTo(cx + K.HW * .7, cy + (fr(x * 2 + y * 2) - .5) * 4); c.stroke();
    if (fr(x * 5 + y * 9) > .7) { c.fillStyle = K.rgba(p.food, .5); c.fillRect(cx - 1, cy - 1, 2, 2); }
  }
  function ripple(c, cx, cy, p, x, y) { // 沙漠：沙纹同心弧（下半）
    c.strokeStyle = K.rgba(p.glow, .25); c.lineWidth = 1;
    [.3, .6].forEach(k => { c.beginPath(); c.moveTo(cx - K.HW * k, cy); c.lineTo(cx, cy + K.HH * k); c.lineTo(cx + K.HW * k, cy); c.stroke(); });
  }
  const PAT = { pulse, ice, circuit, sprinkle, moss, ember, ripple };
  Snake.Patterns = { draw: (id, c, cx, cy, p, x, y) => { const f = PAT[id]; if (f) f(c, cx, cy, p, x, y); } };
})();
```

- [ ] **Step 2: index.html 接线（themes 之后、audio 之前）**

Edit `src/index.html`，old_string:

```html
<script src="js/themes.js"></script>
<script src="js/audio.js"></script>
```

new_string:

```html
<script src="js/themes.js"></script>
<script src="js/patterns.js"></script>
<script src="js/audio.js"></script>
```

- [ ] **Step 3: themes.js 7 条目加 pattern 字段**

对保留 7 条目各做一次 Edit，在条目 `canvas: { ... }` 闭合后追加字段（old/new 仅示差异行，以文件实际整行为准）：
- neon-night：`... spark: '#3b82f6' } },` → `... spark: '#3b82f6' }, pattern: 'pulse' },`
- glacier：`... spark: '#38bdf8' } },` → `... spark: '#38bdf8' }, pattern: 'ice' },`
- cyber：`... spark: '#e879f9' } },` → `... spark: '#e879f9' }, pattern: 'circuit' },`
- candy：`... spark: '#ec4899' } },` → `... spark: '#ec4899' }, pattern: 'sprinkle' },`
- forest：`... spark: '#34d399' } },` → `... spark: '#34d399' }, pattern: 'moss' },`
- lava：`... spark: '#fb923c' } },` → `... spark: '#fb923c' }, pattern: 'ember' },`
- desert：`... spark: '#fbbf24' } }` → `... spark: '#fbbf24' }, pattern: 'ripple' }`

（注意：同一 spark 值可能出现在多条——如 `#3b82f6` 仅 neon-night、`#34d399` 仅 forest（retro 已删）、`#38bdf8` 仅 glacier（abyss 已删）。若 old_string 不唯一，扩大上下文带上该条 id 行。）

- [ ] **Step 4: Node 沙盒测试（7 图案可绘 + 未知 id no-op）**

Run:

```powershell
node -e "const fs=require('fs');const calls=[];const ctx=new Proxy({},{get:(t,k)=>function(){calls.push(k)},set:()=>true});global.window={};global.Snake={K:{HW:15,HH:7.5,fr:s=>{const x=Math.sin(s*127.1)*43758.5453;return x-Math.floor(x)},rgba:(h,a)=>'rgba(1,2,3,'+a+')'}};eval(fs.readFileSync('src/js/patterns.js','utf8'));const p={glow:'#3b82f6',spark:'#34d399',food:'#ff7a45'};['pulse','ice','circuit','sprinkle','moss','ember','ripple','nope'].forEach(id=>{for(let x=0;x<8;x++)for(let y=0;y<8;y++)Snake.Patterns.draw(id,ctx,100,100,p,x,y)});console.log(calls.length>0?('PASS ops='+calls.length):'FAIL')"
```

Expected: `PASS ops=` 后跟正整数（无异常抛出）。

- [ ] **Step 5: 语法检查**

Run: `node --check src/js/patterns.js; node --check src/js/themes.js`
Expected: 无输出。

---

### Task 3: render.js 光影层 + 晕影 + 图案调用 + 防拉伸 fit（结束于 commit ②）

**Files:**
- Modify: `src/js/render.js`

- [ ] **Step 1: 替换 paintBoard 并新增 sideGrad/isDarkBg**

Edit `src/js/render.js`，old_string（现 paintBoard 全文，L49-59）:

```js
  function paintBoard() {
    const l = [S.OX - S.N * K.HW, K.OY + S.N * K.HH], r = [S.OX + S.N * K.HW, K.OY + S.N * K.HH], b = [S.OX, K.OY + S.N * K.TH];
    poly([l, b, [b[0], b[1] + 8], [l[0], l[1] + 8]], pal.floorLeft);
    poly([r, b, [b[0], b[1] + 8], [r[0], r[1] + 8]], pal.floorRight);
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
      const [sx, sy] = K.P(x, y);
      diamond(sx, sy + K.HH, K.HW, K.HH, (x + y) % 2 ? pal.floorTop : pal.floorRight);
      ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; // 网格线随主题
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + K.HW, sy + K.HH); ctx.lineTo(sx, sy + 2 * K.HH); ctx.lineTo(sx - K.HW, sy + K.HH); ctx.closePath(); ctx.stroke();
    }
  }
```

new_string:

```js
  function isDarkBg() { const h = Snake.theme.current.css.bg, c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return (.299 * c[0] + .587 * c[1] + .114 * c[2]) < 128; }
  function sideGrad(a, b, col) { // 侧面平行四边形：顶色→压暗 40% 纵向渐变（细腻层，离屏缓存）
    const g = ctx.createLinearGradient(0, a[1], 0, a[1] + 8);
    g.addColorStop(0, col); g.addColorStop(1, K.shades(col)[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] + 8); ctx.lineTo(a[0], a[1] + 8); ctx.closePath(); ctx.fill();
  }
  function paintBoard() {
    const l = [S.OX - S.N * K.HW, K.OY + S.N * K.HH], r = [S.OX + S.N * K.HW, K.OY + S.N * K.HH], b = [S.OX, K.OY + S.N * K.TH];
    sideGrad(l, b, pal.floorLeft); sideGrad(r, b, pal.floorRight);
    const dark = isDarkBg();
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
      const [sx, sy] = K.P(x, y);
      diamond(sx, sy + K.HH, K.HW, K.HH, (x + y) % 2 ? pal.floorTop : pal.floorRight);
      ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; // 网格线随主题
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + K.HW, sy + K.HH); ctx.lineTo(sx, sy + 2 * K.HH); ctx.lineTo(sx - K.HW, sy + K.HH); ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; // 瓦片倒角：上两边高光
      ctx.beginPath(); ctx.moveTo(sx - K.HW, sy + K.HH); ctx.lineTo(sx, sy); ctx.lineTo(sx + K.HW, sy + K.HH); ctx.stroke();
      Snake.Patterns.draw(Snake.theme.current.pattern, ctx, sx, sy + K.HH, pal, x, y); // 主题地板图案（缓存层）
    }
    ctx.strokeStyle = K.rgba(pal.glow, .45); ctx.lineWidth = 1; // 台缘描边光
    ctx.beginPath(); ctx.moveTo(S.OX, K.OY); ctx.lineTo(r[0], r[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(l[0], l[1]); ctx.closePath(); ctx.stroke();
  }
```

- [ ] **Step 2: 晕影缓存 + 绘制时机**

Edit `src/js/render.js`，old_string:

```js
  let boardCache = null;                 // 地板离屏缓存
```

new_string:

```js
  let boardCache = null;                 // 地板离屏缓存
  let vig = null;                        // 背景晕影渐变缓存（resize/换主题时重建）
```

Edit，old_string:

```js
    pal = Snake.theme.current.canvas;
    foodC = K.shades(pal.food);
    boardCache = null;
  }
```

new_string:

```js
    pal = Snake.theme.current.canvas;
    foodC = K.shades(pal.food);
    boardCache = null; vig = null;
  }
  function vignette() { // 背景径向晕影：暗主题压边、浅主题暖灰压边
    if (!vig) {
      vig = ctx.createRadialGradient(S.W / 2, S.H / 2, S.H * .3, S.W / 2, S.H / 2, S.H * .85);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, isDarkBg() ? 'rgba(0,0,0,.35)' : 'rgba(90,70,70,.10)');
    }
    ctx.fillStyle = vig; ctx.fillRect(0, 0, S.W, S.H);
  }
```

Edit draw()，old_string:

```js
    drawBoard();
    const raw = (t - (draw.t || t)) / 1000, dt = Math.min(.05, raw); draw.t = t;
```

new_string:

```js
    vignette();
    drawBoard();
    const raw = (t - (draw.t || t)) / 1000, dt = Math.min(.05, raw); draw.t = t;
```

（晕影位于星空之后、棋盘之前：上一步插入点在 drawBoard 前即满足，因星空绘制在其上文。）

- [ ] **Step 3: applyCanvasSize 防拉伸 fit + refit 导出 + window resize**

Edit，old_string:

```js
  function applyCanvasSize() {
    cv.width = S.W * dpr; cv.height = S.H * dpr; cv.style.aspectRatio = S.W + '/' + S.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardCache = null;
  }
```

new_string:

```js
  function fitCanvas() { // 沉浸布局按容器保比例 fit（防拉伸）；列式清空内联尺寸回 CSS width:100%
    if (document.body.classList.contains('im')) {
      const m = document.querySelector('main'), aw = m.clientWidth, ah = m.clientHeight, ratio = S.W / S.H;
      const w = Math.min(aw, ah * ratio);
      cv.style.width = w + 'px'; cv.style.height = (w / ratio) + 'px';
    } else { cv.style.width = ''; cv.style.height = ''; }
  }
  function applyCanvasSize() {
    cv.width = S.W * dpr; cv.height = S.H * dpr; cv.style.aspectRatio = S.W + '/' + S.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardCache = null; vig = null;
    fitCanvas();
  }
```

Edit boot/导出，old_string:

```js
  function boot() {
    applyCanvasSize();
    bus.on('resize', applyCanvasSize);
    requestAnimationFrame(frame);
  }
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; } };
```

new_string:

```js
  function boot() {
    applyCanvasSize();
    bus.on('resize', applyCanvasSize);
    addEventListener('resize', applyCanvasSize); // 窗口尺寸/方向变化重 fit
    requestAnimationFrame(frame);
  }
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; }, refit: fitCanvas };
```

- [ ] **Step 4: 校验与打包**

Run: `node --check src/js/render.js; node build.js`
Expected: `[build] OK → dist/index.html（CSS ×1 · JS ×8 · …）`（JS 数变 8）。

- [ ] **Step 5: 浏览器校验（图案生效 + 无报错）**

打开 `http://localhost:8098/src/index.html?autostart=1`（若缓存干扰：evaluate 换链 `document.querySelectorAll('script[src]')` 不必——直接用 Edge headless 干净 profile 截图肉眼复检更稳）：
Edge headless 截一张：`--window-size=1280,900 --virtual-time-budget=3000 --user-data-dir=$env:TEMP\snake-v3-t3 --screenshot=... png ...?theme=cyber&autostart=1`，Read 图片确认：电路走线可见、瓦片倒角/台缘光/晕影可见、无开始遮罩。console 无 error（headless stderr 无 page error 行）。

- [ ] **Step 6: Commit ②**

```powershell
git add src/js/patterns.js src/index.html src/js/themes.js src/js/render.js; git commit -m "feat: 细腻化方向 B——光影四件进离屏缓存 + 7 套地板图案注册表（每帧零成本、可扩展）+ 画布 fit 防拉伸"
```

---

### Task 4: 布局 A —— body.im 统一沉浸式（结束于 commit ③）

**Files:**
- Modify: `src/js/input.js`（wideMQ + im 类 + refit 调用）
- Modify: `src/css/base.css`（选择器迁移 + 单人悬浮位 + .th 沉浸悬浮 + 竖屏 :not(.im)）

- [ ] **Step 1: input.js syncModeUi 升级**

Edit `src/js/input.js`，old_string:

```js
    function syncModeUi() { // body 类与按钮高亮跟随 S.mode（点击与 URL ?mode= 两个入口共用）
      document.body.classList.toggle('pk', K.MODES[S.mode].players === 2);
      document.body.classList.toggle('ai', !!K.MODES[S.mode].ai);
      document.querySelectorAll('.mode button[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === S.mode));
    }
```

new_string:

```js
    const wideMQ = window.matchMedia ? matchMedia('(orientation: landscape), (min-width: 760px)') : { matches: false, addEventListener() {} };
    function syncModeUi() { // body 类与按钮高亮跟随 S.mode + 视口（点击与 URL ?mode= 两个入口共用）
      document.body.classList.toggle('pk', K.MODES[S.mode].players === 2);
      document.body.classList.toggle('ai', !!K.MODES[S.mode].ai);
      document.body.classList.toggle('im', wideMQ.matches); // 横屏/宽屏 → 统一沉浸式
      document.querySelectorAll('.mode button[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === S.mode));
      if (Snake.Render.refit) Snake.Render.refit();
    }
    wideMQ.addEventListener('change', syncModeUi);
```

- [ ] **Step 2: base.css 沉浸选择器迁移 body.pk → body.im**

对 `src/css/base.css` L51-74 沉浸块逐条替换选择器（规则体不变）：`body.pk main{position:relative…}`、`body.pk{touch-action:none;overflow:hidden}`、`body.pk main{touch-action:none}`、`body.pk h1,body.pk .tip{…}`、`body.pk .stage{…}`、`body.pk .hud{…}`、`body.pk .mode{…}`、`body.pk .mode button{…}`、`body.pk .pad{…}`、`body.pk .pad[data-p="0"]{…}`、`body.pk .pad[data-p="1"]{…}`、`body.pk .pad button{…}`、`body.pk .sw{…}`、`body.pk .dot{…}`、`body.pk .cmp{…}`、`body.pk .cmp[data-p="0"]{…}`、`body.pk .cmp[data-p="1"]{…}`、`body.pk .eb{…}`、`body.pk .eb[data-p="0"]{…}`、`body.pk .eb[data-p="1"]{…}`、`body.pk .sw[data-p="0"]{…}`、`body.pk .sw[data-p="1"]{…}` 全部 `body.pk` → `body.im`。
保留不动：`body.ai .pad[data-p="1"],body.ai .cmp[data-p="1"]{display:none}`。
canvas 规则改为：`body.im canvas{max-width:100%;max-height:100%;align-self:center}`（宽高由 fitCanvas 内联像素值给定）。

- [ ] **Step 3: base.css 删除旧 .th 隐藏 + 新增沉浸悬浮规则**

Edit，old_string:

```css
body.pk .th{display:none}
```

new_string: 空（删除该行）。

在沉浸块末尾（`body.im .sw[data-p="1"]{right:10px}` 之后）追加：

```css
body.im .th{position:absolute;top:36px;right:10px;display:flex;flex-wrap:nowrap;gap:6px;margin:0;z-index:2} /* 沉浸下主题点悬浮右上，可换主题 */
body.im .th .dot{width:20px;height:20px}
body.im:not(.pk) .pad[data-p="0"]{left:auto;right:10px} /* 单人沉浸：pad 右下 */
body.im:not(.pk) .eb[data-p="0"]{left:auto;right:10px;top:64px} /* 单人沉浸：能量条右上让位主题点 */
```

- [ ] **Step 4: base.css 竖屏媒体块改 :not(.im)**

Edit，old_string:

```css
@media (orientation:portrait){body.pk{overflow:auto}body.pk main{height:auto;display:block;padding:16px}body.pk .hud,body.pk .mode{position:static;transform:none;margin:0 0 8px}body.pk .mode button{font-size:14px;padding:6px 16px}body.pk .stage{display:none}body.pk .rotate{display:block}}
```

new_string:

```css
@media (orientation:portrait){body.pk:not(.im){overflow:auto}body.pk:not(.im) main{height:auto;display:block;padding:16px}body.pk:not(.im) .hud,body.pk:not(.im) .mode{position:static;transform:none;margin:0 0 8px}body.pk:not(.im) .mode button{font-size:14px;padding:6px 16px}body.pk:not(.im) .stage{display:none}body.pk:not(.im) .rotate{display:block}}
```

- [ ] **Step 5: 校验 + 四象限走查**

Run: `node build.js`
Edge headless 三张（干净 user-data-dir）：
1. `--window-size=1280,900 .../src/index.html?mode=easy&autostart=1` → 肉眼：沉浸布局、画布吃满高度无拉伸、右上主题点行可见、pad 右下。
2. `--window-size=390,844 .../src/index.html?mode=easy&autostart=1` → 肉眼：列式（标题+棋盘+pad 纵排）。
3. `--window-size=390,844 .../src/index.html?mode=pk` → 肉眼：竖屏双人列式 + 「请把手机横过来」提示。
4. `--window-size=844,390 .../src/index.html?mode=easy&autostart=1` → 肉眼：横屏单人沉浸。
另 dump-dom 校验类：`--window-size=1280,900 --dump-dom ...?mode=easy` 提取 `<body[^>]*>` 期望含 `im`；`--window-size=390,844 --dump-dom ...?mode=easy` 期望不含 `im`。

- [ ] **Step 6: Commit ③**

```powershell
git add src/js/input.js src/css/base.css dist/index.html; git commit -m "feat: 统一沉浸式布局 A——横屏/宽屏全模式沉浸（body.im）、沉浸可换主题、竖屏双人回退列式提示"
```

---

### Task 5: 全量验收 + 截图候选（结束于 commit ④）

**Files:**
- Modify: `screenshots/*.png`（重截）

- [ ] **Step 1: 8 项走查（src 与 dist 关键项）**

browser 走查清单（evaluate 片段）：
1. PC 单人沉浸比例：`const r=document.getElementById('c').getBoundingClientRect();JSON.stringify({ok:Math.abs(r.width/r.height-Snake.S.W/Snake.S.H)<.02,im:document.body.classList.contains('im')})` → `{"ok":true,"im":true}`
2. 无滚动条：`document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight` → true
3. 沉浸换主题：`Snake.theme.apply('lava',false);Snake.theme.current.id` → lava；console 无 error；再切回 neon-night
4. 图案随主题重建：切 cyber 后截图肉眼见电路走线
5. lowFx：`Snake.S.lowFx=true` 对局 5s 无 error，图案仍可见（缓存层），恢复 false
6. URL 入口回归：`?mode=pk` dump-dom body 含 `pk im`；`?mode=ai` 含 `pk ai im`
7. 双人桌面不回归：pk 截图双 pad 左右、名牌在
8. dist 一致性：`http://localhost:8098/dist/index.html?autostart=1` 重复 1、2、3 项

- [ ] **Step 2: 重截候选图 5 张**

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$shots = @(@('neon-night','?theme=neon-night&autostart=1'), @('cyber','?theme=cyber&autostart=1'), @('candy','?theme=candy&autostart=1'), @('desert','?theme=desert&autostart=1'), @('lava-pk','?theme=lava&mode=pk&autostart=1'))
$i = 20; foreach ($s in $shots) { Start-Process -FilePath $edge -ArgumentList @('--headless=new','--disable-gpu','--hide-scrollbars','--window-size=1280,900','--virtual-time-budget=2500','--no-first-run',"--user-data-dir=$env:TEMP\snake-v3-shot-$i","--screenshot=d:\WorkBuddy\贪吃蛇\screenshots\$($s[0]).png","http://localhost:8098/src/index.html$($s[1])") -Wait -NoNewWindow | Out-Null; $i++ }
```

（旧 lava.png 被 lava-pk.png 取代后可 `DeleteFile` 删旧 lava.png；desert 为新候选。）

- [ ] **Step 3: 人眼复检 5 张 PNG**

Read 每张：确认 沉浸构图、图案可见、光影层可见、无遮罩、无拉伸。不合格者调 `--virtual-time-budget` 或主题重截。

- [ ] **Step 4: Commit ④**

```powershell
git add screenshots/; git commit -m "assets: v3 细腻化主题截图候选 5 张（单人沉浸构图，待用户挑选）"
```

- [ ] **Step 5: 交付验收汇报**

向用户汇报：本地试玩入口（src 双击 / dist 单文件）、5 张截图 computer:// 链接、本轮变更清单（7 主题/图案注册表/光影层/布局 A/防拉伸）、**发布仍暂停**等验收；验收通过后另开迭代做部署+排行榜。

---

## 自审结论

- **Spec 覆盖**：§1 主题精简（Task 1）；§2.1 光影层四件（Task 3 Step 1-2）；§2.2 注册表+7 图案+扩展性（Task 2）；§3.1 im 类与四象限（Task 4 Step 1/5）；§3.2 CSS 迁移与悬浮位（Task 4 Step 2-4）；§3.3 fit 判据（Task 3 Step 3 + Task 5 走查 1）；§4 回退（patterns no-op 内置、matchMedia 兜底 Task 4 Step 1、旧记忆回退 Task 1 Step 5）；§5 验收 8 项（Task 5 Step 1）+ 截图（Step 2-3）；提交 4 笔对应 Task 1/3/4/5。无缺口。
- **占位符**：无 TBD/TODO；所有代码全文给出；命令含期望输出。
- **类型一致性**：`Snake.Patterns.draw(id,ctx,cx,cy,pal,x,y)` 在 patterns.js 定义与 render 调用一致；`Snake.Render.refit` 定义（Task 3）先于 input.js 使用（Task 4，带存在性守卫）；`pattern` 字段名 themes/render 一致；`im` 类名 input/css 一致。
- **已知坑提示**：浏览器走查谨防 heuristic 缓存假阴性——优先 Edge headless 干净 `--user-data-dir`；agent 浏览器需换链破缓存。
