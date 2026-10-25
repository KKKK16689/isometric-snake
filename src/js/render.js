/* render.js —— 一切 canvas 绘制。只读状态；不改游戏状态（lowFx 检测除外）。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K, bus = Snake.bus, api = Snake.api;
  const $ = id => document.getElementById(id);
  const cv = $('c'); let ctx = cv.getContext('2d');
  /* ---------- Stage 0：清晰度——backing store 按“实际显示尺寸 × 有效比例”重算 ----------
     2.0 一直按逻辑 S.W*dpr（dpr 硬顶 2）开背店，CSS 尺寸却是容器宽度：大屏/横屏 PK 下
     等效比例可能只有 1.0x 左右，位图被放大即糊。改为：先定 CSS 尺寸 → 实测 rect →
     dprEff（受像素预算约束）→ 背店 = round(css × dprEff)。逻辑坐标仍用 S.W/S.H，
     绘制比例 scale = dprEff × k（k = cssW / S.W）。 */
  const MAX_PX_DESKTOP = 8e6, MAX_PX_MOBILE = 4.5e6;    // 像素预算：桌面 8M / 移动 4.5M
  /* ---------- 自适应画质：帧率优先（用户授权「这个帧率你看着来，怎么舒服怎么来」）----------
     实测最贵的是每帧的全画布像素操作（清屏 / 晕影 / 地板贴图），成本随背店面积线性增长；
     弱 GPU、软件光栅或超高分屏下会吃掉 60fps 预算。做法：按窗口统计「漏帧率」（帧间隔 > 25ms
     即 60Hz 下至少漏一帧；预热 90 帧跳过启动尖峰，避免把加载/切主题的瞬时抖动当成设备慢），
     漏帧多就按 0.85 逐档降 dprEff，最低到「1 设备像素 = 1 CSS 像素」（清晰度下限，不会再糊）；
     几乎不漏帧且过了试升冷却再逐档升回。只改背店分辨率，几何 / 配色 / 规则一概不动。 */
  let qScale = 1, qHold = 0, qProbe = 0, qWin = 0, qDrop = 0, qPre = 0, qDirty = false;
  const Q = { min: .5, step: .85, dropMs: 25, dropHi: .08, dropLo: .01, warmup: 45, win: 60, retryMs: 15000 };
  const FPS_ON = /(^|[?&])fps=1(&|$)/.test((typeof location !== 'undefined' && location.search) || '');   // ?fps=1 诊断读数
  let fpsT0 = 0, fpsN = 0, fpsVal = 0;
  let scale = 1;                                        // 逻辑单位 → 设备像素
  let cssK = 1;                                         // CSS 像素 / 逻辑单位
  let lastW = -1, lastH = -1, lastDpr = -1, lastSW = -1, lastSH = -1;  // 变更检测：尺寸没变不重建缓存
  const snap = v => Math.round(v * scale) / scale;      // 静态顶点对齐设备像素（蛇插值坐标不取整，否则抖）
  let boardCache = null;                 // 地板离屏缓存
  let vig = null;                        // 背景晕影渐变缓存（resize/换主题时重建）
  let pal = Snake.theme.current.canvas;  // 当前主题渲染调色板（只读）
  let foodC = K.shades(pal.food);        // 食物立方体三面色（随主题）
  const GHOST_C = ['#F0F2F5', '#C3C9D4', '#98A0AE'];   // 幽灵回放蛇（半透明灰白，不随主题）
  const GOLD = K.shades('#F2B33D');                    // 金苹果三面色（固定金色）
  const PX = (x, y) => S.OX + (x - y) * K.HW, PY = (x, y) => K.OY + (x + y) * K.HH;   // K.P 标量版：逐帧热循环零分配
  const glowCache = new Map();           // 颜色+alpha → 预渲染径向光晕精灵（替代逐帧 createRadialGradient）
  function glowSprite(col, a) {
    const key = col + '|' + a;
    let c = glowCache.get(key);
    if (!c) {
      const px = Math.max(32, Math.min(256, Math.ceil(64 * scale)));   // 精灵按当前设备比例生成（256 上限控显存）
      const s2 = px / 64; c = document.createElement('canvas'); c.width = c.height = px;
      const g2 = c.getContext('2d'), g = g2.createRadialGradient(px / 2, px / 2, 2 * s2, px / 2, px / 2, px / 2);
      g.addColorStop(0, K.rgba(col, a)); g.addColorStop(1, K.rgba(col, 0));
      g2.fillStyle = g; g2.fillRect(0, 0, px, px);
      glowCache.set(key, c);
    }
    return c;
  }
  function glowAt(sx, sy, r, col, a) { ctx.drawImage(glowSprite(col, a), sx - r, sy - r, r * 2, r * 2); }
  function bindTheme() {
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
  bus.on('themeChange', bindTheme);      // 主题热切换：重建地板缓存，对局不中断

  function fitCanvas() { // 沉浸布局按容器保比例 fit（防拉伸）；列式清空内联尺寸回 CSS width:100%
    if (document.body.classList.contains('im')) {
      const m = document.querySelector('main'), aw = m.clientWidth, ah = m.clientHeight, ratio = S.W / S.H;
      const w = Math.min(aw, ah * ratio);
      cv.style.width = w + 'px'; cv.style.height = (w / ratio) + 'px';
    } else { cv.style.width = ''; cv.style.height = ''; }
  }
  function maxPixels(w, h) {   // 像素预算：触屏 / 小屏按移动端上限，其余按桌面
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return (coarse || Math.min(w, h) < 600) ? MAX_PX_MOBILE : MAX_PX_DESKTOP;
  }
  function applyCanvasSize() {
    fitCanvas();                                   // 1) 先定 CSS 尺寸（沉浸 fit / 列式 100%）
    const r = cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    const w = r && r.width > 0 ? r.width : S.W, h = r && r.height > 0 ? r.height : S.H;   // 2) 实测；rect 为 0 回退逻辑尺寸
    const dprEff = Math.max(1, Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(maxPixels(w, h) / Math.max(1, w * h))) * qScale);
    cv.style.aspectRatio = S.W + '/' + S.H;        // 保比例防拉伸（列式布局靠它定高）
    if (w === lastW && h === lastH && dprEff === lastDpr && S.W === lastSW && S.H === lastSH) return;   // 无变化：不重建
    lastW = w; lastH = h; lastDpr = dprEff; lastSW = S.W; lastSH = S.H;
    cv.width = Math.round(w * dprEff); cv.height = Math.round(h * dprEff);
    cssK = w / S.W; scale = dprEff * cssK;         // 逻辑 → CSS → 设备 两级比例
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    boardCache = null; vig = null; glowCache.clear();   // 缓存全部按新背店尺寸重建
  }

  function poly(pts, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function diamond(cx, cy, a, b, col) { poly([[cx, cy - b], [cx + a, cy], [cx, cy + b], [cx - a, cy]], col); }
  /* 以格 (x,y) 为中心的立方块：s 尺寸比 / hgt 高 / zb 抬高 / c=[顶,左,右] / glow 描边光 */
  function cube(x, y, s, hgt, zb, c) {   // 辉光统一改加法通道里绘预渲染精灵（glowAt），不再逐帧 shadowBlur
    const cx = PX(x, y), cy = PY(x, y) + K.HH, a = K.HW * s, b = K.HH * s, top = zb + hgt;
    poly([[cx - a, cy - top], [cx, cy + b - top], [cx, cy + b - zb], [cx - a, cy - zb]], c[1]);
    poly([[cx + a, cy - top], [cx, cy + b - top], [cx, cy + b - zb], [cx + a, cy - zb]], c[2]);
    diamond(cx, cy - top, a, b, c[0]);
  }
  let boardCv = null;                    // 地板离屏画布复用：重建只重画，不再新建 canvas
  function drawBoard() {
    if (!boardCache) {
      if (!boardCv) boardCv = document.createElement('canvas');
      boardCv.width = cv.width; boardCv.height = cv.height;   // 赋 width 同时清屏（与主画布同背店尺寸）
      const main = ctx; ctx = boardCv.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
      try { paintBoard(); } finally { ctx = main; }
      boardCache = boardCv;
    }
    ctx.drawImage(boardCache, 0, 0, S.W, S.H);
  }
  function isDarkBg() { const h = Snake.theme.current.css.bg, c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return (.299 * c[0] + .587 * c[1] + .114 * c[2]) < 128; }
  function sideGrad(a, b, col) { // 侧面平行四边形：顶色→压暗 40% 纵向渐变（细腻层，离屏缓存）
    const g = ctx.createLinearGradient(0, a[1], 0, a[1] + 8);
    g.addColorStop(0, col); g.addColorStop(1, K.shades(col)[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] + 8); ctx.lineTo(a[0], a[1] + 8); ctx.closePath(); ctx.fill();
  }
  function paintBoard() {
    const l = [snap(S.OX - S.N * K.HW), snap(K.OY + S.N * K.HH)], r = [snap(S.OX + S.N * K.HW), snap(K.OY + S.N * K.HH)], b = [snap(S.OX), snap(K.OY + S.N * K.TH)];
    sideGrad(l, b, pal.floorLeft); sideGrad(r, b, pal.floorRight);
    const dark = isDarkBg(), lw = 1 / cssK;   // 网格/倒角线宽 = 1 CSS px（不随显示缩放变粗）
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
      const sx = snap(PX(x, y)), sy = snap(PY(x, y) + K.HH);   // 瓦片中心：对齐设备像素，边缘不虚
      diamond(sx, sy, K.HW, K.HH, (x + y) % 2 ? pal.floorTop : pal.floorRight);
      ctx.strokeStyle = pal.grid; ctx.lineWidth = lw; // 网格线随主题
      ctx.beginPath(); ctx.moveTo(sx, sy - K.HH); ctx.lineTo(sx + K.HW, sy); ctx.lineTo(sx, sy + K.HH); ctx.lineTo(sx - K.HW, sy); ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)'; ctx.lineWidth = lw; // 瓦片倒角：上两边高光
      ctx.beginPath(); ctx.moveTo(sx - K.HW, sy); ctx.lineTo(sx, sy - K.HH); ctx.lineTo(sx + K.HW, sy); ctx.stroke();
      Snake.Patterns.draw(Snake.theme.current.pattern, ctx, sx, sy, pal, x, y); // 主题地板图案（缓存层）
    }
    ctx.strokeStyle = K.rgba(pal.glow, .45); ctx.lineWidth = lw; // 台缘描边光
    ctx.beginPath(); ctx.moveTo(snap(S.OX), snap(K.OY)); ctx.lineTo(r[0], r[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(l[0], l[1]); ctx.closePath(); ctx.stroke();
  }
  /* ---------- 特效（吃食/撞击/胜利特效由 particles.js 对象池负责） ---------- */
  const STARS = Array.from({ length: 40 }, (_, i) => [K.fr(i * 3 + 1), K.fr(i * 3 + 2), K.fr(i * 3 + 3) > .8 ? 2 : 1]);
  function halo(x, y, hgt, col) { // 身体鳞片廉价光晕（无模糊）；调用方保证处于加法通道内
    if (S.lowFx) return;
    const sx = PX(x, y), sy = PY(x, y);
    diamond(sx, sy + K.HH - hgt, K.HW * 1.3, K.HH * 1.3, K.rgba(col, .07));   // Stage 0：降 alpha，减少边缘发软
    diamond(sx, sy + K.HH - hgt, K.HW * 1.7, K.HH * 1.7, K.rgba(col, .035));
  }
  /* ---------- 移动插值：core 记录 p.moveT/moveP（游戏时钟），这里按帧时刻在“上一格→当前格”间线性插值 ---------- */
  const PTS = [[], []];                                   // 每玩家浮点格坐标缓存（逐帧复用，零分配）
  const items = [];                                       // 画家算法排序表（对象池复用，逐帧零分配）
  function segPos(p, j, t, out) {
    const cur = p.body[j], a = p.moveP ? (t - p.moveT) / p.moveP : 1;
    if (a > 0 && a < 1) { // 中段身体来自 body[j+1]；尾段：生长帧原地，否则来自让出的旧尾格
      const from = j < p.body.length - 1 ? p.body[j + 1] : (p.grew ? cur : (p.tailFrom || cur));
      out.x = from.x + (cur.x - from.x) * a; out.y = from.y + (cur.y - from.y) * a;
    } else { out.x = cur.x; out.y = cur.y; }              // a≥1（未动/暂停/结束）停稳在当前格
    return out;
  }
  let shakeT = 0;
  const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };   // 系统「减弱动态」：禁震屏 + 强制降级特效
  bus.on('crash', () => { if (!RM.matches) shakeT = performance.now(); });  // 撞击震屏 ~220ms，尊重系统减弱动态
  const STREAK_C = [0, 1, 2].map(k => {   // 冲刺光轨描边色：alpha 量化 21 档预生成字符串（逐帧零拼接）
    const pre = k === 2 ? 'rgba(220,240,255,' : 'rgba(60,140,255,';
    const arr = []; for (let q = 0; q <= 20; q++) arr.push(pre + (q / 20).toFixed(2) + ')'); return arr;
  });
  const TR = [];                          // 光轨屏坐标缓冲（逐帧复用）
  function streak(p, now, hp) { // 冲刺光轨（头点用插值坐标）
    const n0 = p.trail.length;
    for (let q = 0; q < n0; q++) { const s = p.trail[q]; if (!TR[q]) TR[q] = [0, 0, 0]; TR[q][0] = PX(s.x, s.y); TR[q][1] = PY(s.x, s.y) + K.HH - 6; TR[q][2] = 1 - (now - s.b) / 500; }
    if (p.sprint) { if (!TR[n0]) TR[n0] = [0, 0, 0]; TR[n0][0] = PX(hp.x, hp.y); TR[n0][1] = PY(hp.x, hp.y) + K.HH - 6; TR[n0][2] = 1; }
    const n = n0 + (p.sprint ? 1 : 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[11, .14], [5, .35], [1.8, .9]].forEach(([w, a], k) => {
      for (let i = 1; i < n; i++) {
        const v = a * TR[i][2], q = v >= 1 ? 20 : (v * 20 + .5) | 0;
        ctx.strokeStyle = STREAK_C[k][q];
        ctx.lineWidth = w * (.4 + .6 * TR[i][2]);
        ctx.beginPath(); ctx.moveTo(TR[i - 1][0], TR[i - 1][1]); ctx.lineTo(TR[i][0], TR[i][1]); ctx.stroke();
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
  function lightning(p, cx, cy, t, i, pts) { // 头部闪电 + 沿身电弧（约 18 次/秒换种子；弧端点用插值坐标）
    const seed = Math.floor(t / 55) * 7 + i * 101, n = p.body.length;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let b = 0; b < 3; b++) { const ang = K.fr(seed + b * 13) * 6.283, len = 24 + K.fr(seed + b * 29) * 24; zig(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * .6, seed + b * 7); }
    for (let k = 0; k < (S.lowFx ? 0 : 2); k++) {
      const j = Math.floor(K.fr(seed + k * 17) * Math.max(1, n - 2)), e = pts[Math.min(j + 2, n - 1)];
      zig(PX(pts[j].x, pts[j].y), PY(pts[j].x, pts[j].y) + K.HH - 8, PX(e.x, e.y), PY(e.x, e.y) + K.HH - 8, seed + k * 3);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function seam(p, j, x, y, s, hgt, col) { // 鳞片人字缝，指向蛇头（x,y 为插值浮点格；方向仍取整数格）
    const q = p.body[j - 1]; if (!q) return;
    const c0 = p.body[j];
    const dx = q.x - c0.x, dy = q.y - c0.y; if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    const cx = PX(x, y), cy = PY(x, y) + K.HH - hgt;
    const v = [(dx - dy) * K.HW * s, (dx + dy) * K.HH * s], w = [(-dy - dx) * K.HW * s, (-dy + dx) * K.HH * s];
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(cx + w[0] * .5 - v[0] * .1, cy + w[1] * .5 - v[1] * .1); ctx.lineTo(cx + v[0] * .35, cy + v[1] * .35); ctx.lineTo(cx - w[0] * .5 - v[0] * .1, cy - w[1] * .5 - v[1] * .1);
    ctx.stroke();
  }
  function headFx(p, t, i, hp, pts) { // 眼睛、吐舌、冲刺闪电（头位置用插值坐标）
    const cx = PX(hp.x, hp.y), cy = PY(hp.x, hp.y) + K.HH - 9, dx = p.dir[0], dy = p.dir[1];
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
    if (p.sprint) lightning(p, cx, cy, t, i, pts);
  }
  function overlay(t1, t2, t3) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, S.W, S.H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '600 22px system-ui,sans-serif'; ctx.fillText(t1, S.W / 2, S.H / 2 - 4);
    ctx.font = '14px system-ui,sans-serif'; ctx.fillText(t2, S.W / 2, S.H / 2 + 20);
    if (t3) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '12px system-ui,sans-serif'; ctx.fillText(t3, S.W / 2, S.H / 2 + 42); }
  }
  function draw(t) {
    if (qDirty) { qDirty = false; applyCanvasSize(); }   // 自适应画质换档：在帧首重建，避免半帧换尺寸
    ctx.clearRect(0, 0, S.W, S.H);
    if (pal.star) STARS.forEach((s, i) => { // 无星空主题（亮色）不绘星空
      ctx.fillStyle = K.rgba(pal.star, (.25 + .35 * Math.sin(t / 700 + i)).toFixed(2));
      ctx.fillRect(s[0] * S.W, s[1] * S.H, s[2], s[2]);
    });
    vignette();
    const raw = (t - (draw.t || t)) / 1000, dt = Math.min(.05, raw); draw.t = t;
    if (!document.hidden) { // 后台标签页的巨帧不参与性能判定
      S.frameDt = S.frameDt * .95 + Math.min(.2, raw) * .05;
      if (RM.matches) { S.lowFx = true; S.fxGood = 0; }   // 系统「减弱动态」：特效常降级，不走滞回恢复
      else if (S.frameDt > K.TUNE.lowFxOn) { S.lowFx = true; S.fxGood = 0; }          // 低端机自动关辉光
      else if (S.frameDt < K.TUNE.lowFxOff) { if (S.lowFx && ++S.fxGood >= K.TUNE.lowFxRecover) { S.lowFx = false; S.fxGood = 0; } } // 滞回恢复：卡顿是暂时的
      else S.fxGood = 0;
    }
    if (!document.hidden) {   // 自适应画质：窗口化漏帧统计（不用帧时均值，免得启动尖峰把均值抬高误降档）
      if (qPre < Q.warmup) qPre++;
      else {
        qWin++;
        if (raw * 1000 > Q.dropMs) qDrop++;
        if (qWin >= Q.win) {
          const ratio = qDrop / qWin;
          if (ratio >= Q.dropHi && qScale > Q.min && t > qHold) {          // 漏帧多：降一档分辨率
            qScale = Math.max(Q.min, qScale * (ratio > .35 ? .6 : Q.step));   // 严重掉帧直接大步降，尽快进预算
            qHold = t + 2000; qProbe = t + Q.retryMs; qDirty = true;          // 真正重建放到下一帧开头，避免半帧换尺寸
          } else if (ratio <= Q.dropLo && qScale < 1 && t > qProbe) {      // 几乎不漏帧且过了冷却：试探升回一档
            qScale = Math.min(1, qScale / Q.step); qHold = t + 2000; qProbe = t + Q.retryMs * 1.5; qDirty = true;
          }
          qWin = 0; qDrop = 0;
        }
      }
    }
    const now = performance.now(), fg = K.MODES[S.mode].players === 2 ? '#cbd5e1' : pal.food;
    S.pl.forEach((p, i) => { // 每帧算一次插值坐标，后续所有绘制层共用
      const arr = PTS[i];
      for (let j = 0; j < p.body.length; j++) { if (!arr[j]) arr[j] = { x: 0, y: 0 }; segPos(p, j, t, arr[j]); }
      arr.length = p.body.length;
    });
    const sh = shakeT ? Math.max(0, 1 - (t - shakeT) / 220) : 0;   // 撞击震屏：背景与结算文字不参与，只晃世界层
    if (sh > 0) { ctx.save(); ctx.translate((K.fr(t * 1.31) - .5) * 8 * sh, (K.fr(t * 1.73 + 7) - .5) * 6 * sh); }
    drawBoard();
    ctx.globalCompositeOperation = 'lighter';   // 加法通道一次合批：地板反光/光轨/鳞片光晕/辉光精灵，整通道只切一次 composite
    S.pl.forEach((p, i) => { // 蛇映在地板的光（随插值）
      const c = K.rgba(K.SK[S.skin[i]].body[1], .16), arr = PTS[i];
      if (!S.lowFx) for (let j = 0; j < arr.length; j++) diamond(PX(arr[j].x, arr[j].y), PY(arr[j].x, arr[j].y) + K.HH, K.HW * 1.3, K.HH * 1.3, c);
      let w = 0; for (let q = 0; q < p.trail.length; q++) { if (now - p.trail[q].b < 500) p.trail[w++] = p.trail[q]; } p.trail.length = w;   // 原地压实：逐帧零分配
      streak(p, now, arr[0]);
      if (!S.lowFx) {   // 鳞片光晕（身体）lowFx 关闭；头部辉光始终保留（Stage 0）
        const col = K.SK[S.skin[i]];
        for (let j = 1; j < arr.length; j++) { const k = Math.max(0, (j - (arr.length - 7)) / 7); halo(arr[j].x, arr[j].y, 8 - 3 * k, col.body[1]); }
      }
      if (!p.dead) glowAt(PX(arr[0].x, arr[0].y), PY(arr[0].x, arr[0].y) + K.HH - 9, 22, p.sprint ? pal.glow : K.SK[S.skin[i]].body[1], .5);
    });
    S.foods.forEach(f => { const sx = PX(f.x, f.y), sy = PY(f.x, f.y); diamond(sx, sy + K.HH, K.HW * 1.5, K.HH * 1.5, K.rgba(fg, .18)); glowAt(sx, sy + K.HH, 14 + Math.sin(t / 300) * 4, fg, .4); });   // 食物辉光始终保留（Stage 0）
    if (S.gold) { const sx = PX(S.gold.x, S.gold.y), sy = PY(S.gold.x, S.gold.y); diamond(sx, sy + K.HH, K.HW * 1.8, K.HH * 1.8, 'rgba(242,179,61,.22)'); glowAt(sx, sy + K.HH, 18 + Math.sin(t / 200) * 5, '#F2B33D', .55); }   // 金苹果地板光 + 辉光
    ctx.globalCompositeOperation = 'source-over';
    /* 幽灵回放：半透明灰白蛇，按当前步数逐格推进（数据 = 破纪录局存档的 p0 路径） */
    if (S.ghostOn && S.ghost && S.pl[0] && S.state !== 'over') {
      const total = S.ghost.length >> 1, upto = Math.min(S.myMoves, total);
      if (upto > 0) {
        const len = Math.min(upto, S.pl[0].body.length);
        ctx.globalAlpha = .22;
        for (let j = 0; j < len; j++) {
          const k = upto - 1 - j;
          cube(S.ghost[k * 2], S.ghost[k * 2 + 1], .85 - .25 * (j / len), 7, 0, j === 0 ? ['#FFFFFF', GHOST_C[1], GHOST_C[2]] : GHOST_C);
        }
        ctx.globalAlpha = 1;
      }
    }
    let ic = 0;   // 画家算法排序表：对象池复用，逐帧零分配
    const pushItem = (x, y, i, j, n, head, dead, food, gold) => { let o = items[ic]; if (!o) o = items[ic] = {}; o.x = x; o.y = y; o.i = i; o.j = j; o.n = n; o.head = head; o.dead = dead; o.food = food; o.gold = gold; ic++; };
    S.pl.forEach((p, i) => PTS[i].forEach((s, j) => pushItem(s.x, s.y, i, j, p.body.length, j === 0, p.dead, false, false)));
    S.foods.forEach(f => pushItem(f.x, f.y, 0, 0, 0, false, false, true, false));
    if (S.gold) pushItem(S.gold.x, S.gold.y, 0, 0, 0, false, false, false, true);
    items.length = ic;
    items.sort((a, b) => (a.x + a.y) - (b.x + b.y)); // 画家算法：后 → 前
    for (const o of items) {
      if (o.gold) {   // 金苹果：金色立方，最后 2s 闪烁告警（游戏时钟，暂停不闪走）；辉光已在加法通道绘
        const remaining = K.TUNE.goldTtl - (S.last - S.gold.born);
        const sx = PX(o.x, o.y), sy = PY(o.x, o.y);
        ctx.globalAlpha = remaining < 2000 && Math.floor(remaining / 150) % 2 === 0 ? .3 : 1;
        diamond(sx, sy + K.HH, K.HW * .55, K.HH * .55, 'rgba(0,0,0,.25)');
        cube(o.x, o.y, .62, 9, 3 + Math.sin(t / 220) * 3, GOLD);
        ctx.globalAlpha = 1;
      } else if (o.food) {
        const sx = PX(o.x, o.y), sy = PY(o.x, o.y);
        diamond(sx, sy + K.HH, K.HW * .5, K.HH * .5, 'rgba(0,0,0,.25)');
        cube(o.x, o.y, .55, 8, 3 + Math.sin(t / 250) * 2.5, K.MODES[S.mode].players === 2 ? K.FOOD_PK : foodC);
      } else if (o.head) cube(o.x, o.y, .98, 9, 0, o.dead ? K.DEAD : S.pl[o.i].sprint ? K.SPRINT_HEAD : K.SK[S.skin[o.i]].head);
      else { // 身体鳞片：向尾部渐细 + 人字缝（光晕已在加法通道合批绘）
        const k = Math.max(0, (o.j - (o.n - 7)) / 7), s = .92 - .32 * k, hg = 8 - 3 * k, col = K.SK[S.skin[o.i]];
        cube(o.x, o.y, s, hg, 0, col.body);
        seam(S.pl[o.i], o.j, o.x, o.y, s, hg, col.body[2]);
      }
    }
    S.pl.forEach((p, i) => headFx(p, t, i, PTS[i][0], PTS[i]));
    S.pl.forEach((p, i) => { if (p.sprint) Snake.Fx.trail(p, i, dt); }); // 冲刺拖尾（lowFx 自动关）
    Snake.Fx.update(dt);
    Snake.Fx.draw(ctx);
    const pk = K.MODES[S.mode].players === 2;
    if (pk) S.pl.forEach((p, i) => { // 头顶名牌（随插值）
      const hp = PTS[i][0], sx = PX(hp.x, hp.y), sy = PY(hp.x, hp.y);
      ctx.fillStyle = K.SK[S.skin[i]].body[2]; ctx.fillRect(sx - 12, sy - 26, 24, 15);
      ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(K.nm(i), sx, sy - 15);
    });
    if (sh > 0) ctx.restore();
    const statsLine = (S.daily ? '种子 ' + S.seed + ' · ' : '') + '累计 ' + S.stats.games + ' 局 · ' + S.stats.food + ' 食物 · ' + S.stats.gold + ' 金苹果';   // 结算第三行
    if (S.state === 'ready') overlay(
      S.daily ? '每日挑战 · ' + (K.dateStr(S.seed) || ('种子 ' + S.seed)) : pk ? (K.MODES[S.mode].ai ? '人机对战' : '双人对战') : '等距贪吃蛇',
      pk ? (K.MODES[S.mode].ai ? 'WASD 或方向键 · E/Shift 冲刺 · 点击开始' : 'P1 WASD·E 冲刺   P2 方向键·Enter 冲刺') : S.daily ? '同一种子 · 同一局 · 按方向键开始' : '点击画面或按方向键开始');
    else if (S.state === 'paused') overlay(S.msg || '已暂停', '点击画面或按空格继续');
    else if (S.state === 'over') overlay(
      S.msg || (pk ? (S.winner < 0 ? '平局' : K.MODES[S.mode].ai ? (S.winner ? 'AI 获胜' : '你赢了') : 'P' + (S.winner + 1) + ' 获胜') : '游戏结束 · ' + S.pl[0].score + ' 分'),
      '点击画面重新开始' + (S.daily ? ' · 工具栏可复制成绩' : ''),
      statsLine);
    if (FPS_ON) {   // 诊断读数（?fps=1）：帧率 / 平均帧时 / 画质档 / 背店；字号按 cssK 折算成屏幕上的 ~11px
      fpsN++; if (t - fpsT0 > 500) { fpsVal = Math.round(fpsN * 1000 / (t - fpsT0)); fpsT0 = t; fpsN = 0; }
      const txt = fpsVal + ' fps · ' + (S.frameDt * 1000).toFixed(1) + 'ms · 画质 ' + Math.round(qScale * 100) + '%'
        + (S.lowFx ? ' · lowFx' : '') + ' · ' + cv.width + '×' + cv.height;
      const k = 1 / cssK, fs = 11 * k, pad = 6 * k;
      ctx.font = '600 ' + fs.toFixed(1) + 'px ui-monospace,monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(pad, pad, txt.length * fs * .62 + pad * 2, fs + pad * 1.8);
      ctx.fillStyle = '#7DD3FC'; ctx.fillText(txt, pad * 2, pad * 2 + fs * .82);
    }
  }
  function frame(t) {
    api.update(t);                       // core 追赶式 tick
    try { draw(t); } catch (e) { console.error(e); } // 绘制错误绝不让游戏循环停摆
    if (Snake.uiTick) Snake.uiTick(t);   // UI 状态条/罗盘并入本 rAF（原 input.js 第二条循环已移除）
    requestAnimationFrame(frame);
  }
  function boot() {
    applyCanvasSize();
    bus.on('resize', applyCanvasSize);                       // 模式切换：S.W/S.H 变化
    addEventListener('resize', applyCanvasSize);             // 窗口尺寸变化
    addEventListener('orientationchange', applyCanvasSize);  // 横竖屏切换
    const vv = window.visualViewport;                        // 移动端地址栏收放 / 双指缩放
    if (vv && vv.addEventListener) vv.addEventListener('resize', applyCanvasSize);
    if (typeof ResizeObserver === 'function') {              // 容器尺寸变化（沉浸 fit / 分栏布局）
      const m = document.querySelector('main');
      if (m) new ResizeObserver(applyCanvasSize).observe(m);
    }
    requestAnimationFrame(frame);
  }
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; }, refit: applyCanvasSize };
})();