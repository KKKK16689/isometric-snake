/* render.js —— 一切 canvas 绘制。只读状态；不改游戏状态（lowFx 检测除外）。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K, bus = Snake.bus, api = Snake.api;
  const $ = id => document.getElementById(id);
  const cv = $('c'); let ctx = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let boardCache = null;                 // 地板离屏缓存
  let vig = null;                        // 背景晕影渐变缓存（resize/换主题时重建）
  let pal = Snake.theme.current.canvas;  // 当前主题渲染调色板（只读）
  let foodC = K.shades(pal.food);        // 食物立方体三面色（随主题）
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
  function applyCanvasSize() {
    cv.width = S.W * dpr; cv.height = S.H * dpr; cv.style.aspectRatio = S.W + '/' + S.H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    boardCache = null; vig = null;
    fitCanvas();
  }

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
  /* ---------- 特效（吃食/撞击/胜利特效由 particles.js 对象池负责） ---------- */
  const STARS = Array.from({ length: 40 }, (_, i) => [K.fr(i * 3 + 1), K.fr(i * 3 + 2), K.fr(i * 3 + 3) > .8 ? 2 : 1]);
  function halo(x, y, hgt, col) { // 身体鳞片廉价光晕（无模糊）
    if (S.lowFx) return;
    const [sx, sy] = K.P(x, y);
    ctx.globalCompositeOperation = 'lighter';
    diamond(sx, sy + K.HH - hgt, K.HW * 1.3, K.HH * 1.3, K.rgba(col, .10));
    diamond(sx, sy + K.HH - hgt, K.HW * 1.7, K.HH * 1.7, K.rgba(col, .05));
    ctx.globalCompositeOperation = 'source-over';
  }
  /* ---------- 移动插值：core 记录 p.moveT/moveP（游戏时钟），这里按帧时刻在“上一格→当前格”间线性插值 ---------- */
  const PTS = [[], []];                                   // 每玩家浮点格坐标缓存（逐帧复用，零分配）
  function segPos(p, j, t, out) {
    const cur = p.body[j], a = p.moveP ? (t - p.moveT) / p.moveP : 1;
    if (a > 0 && a < 1) { // 中段身体来自 body[j+1]；尾段：生长帧原地，否则来自让出的旧尾格
      const from = j < p.body.length - 1 ? p.body[j + 1] : (p.grew ? cur : (p.tailFrom || cur));
      out.x = from.x + (cur.x - from.x) * a; out.y = from.y + (cur.y - from.y) * a;
    } else { out.x = cur.x; out.y = cur.y; }              // a≥1（未动/暂停/结束）停稳在当前格
    return out;
  }
  let shakeT = 0;
  bus.on('crash', () => { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) shakeT = performance.now(); });  // 撞击震屏 ~220ms，尊重系统减弱动态
  function streak(p, now, hp) { // 冲刺光轨（头点用插值坐标）
    const pts = p.trail.map(s => { const [sx, sy] = K.P(s.x, s.y); return [sx, sy + K.HH - 6, 1 - (now - s.b) / 500]; });
    if (p.sprint) { const [hx, hy] = K.P(hp.x, hp.y); pts.push([hx, hy + K.HH - 6, 1]); }
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
  function lightning(p, cx, cy, t, i, pts) { // 头部闪电 + 沿身电弧（约 18 次/秒换种子；弧端点用插值坐标）
    const seed = Math.floor(t / 55) * 7 + i * 101, n = p.body.length;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let b = 0; b < 3; b++) { const ang = K.fr(seed + b * 13) * 6.283, len = 24 + K.fr(seed + b * 29) * 24; zig(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len * .6, seed + b * 7); }
    for (let k = 0; k < (S.lowFx ? 0 : 2); k++) {
      const j = Math.floor(K.fr(seed + k * 17) * Math.max(1, n - 2)), e = pts[Math.min(j + 2, n - 1)], a = K.P(pts[j].x, pts[j].y), c = K.P(e.x, e.y);
      zig(a[0], a[1] + K.HH - 8, c[0], c[1] + K.HH - 8, seed + k * 3);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function seam(p, j, x, y, s, hgt, col) { // 鳞片人字缝，指向蛇头（x,y 为插值浮点格；方向仍取整数格）
    const q = p.body[j - 1]; if (!q) return;
    const c0 = p.body[j];
    const dx = q.x - c0.x, dy = q.y - c0.y; if (Math.abs(dx) + Math.abs(dy) !== 1) return;
    const [sx, sy] = K.P(x, y), cx = sx, cy = sy + K.HH - hgt;
    const v = [(dx - dy) * K.HW * s, (dx + dy) * K.HH * s], w = [(-dy - dx) * K.HW * s, (-dy + dx) * K.HH * s];
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(cx + w[0] * .5 - v[0] * .1, cy + w[1] * .5 - v[1] * .1); ctx.lineTo(cx + v[0] * .35, cy + v[1] * .35); ctx.lineTo(cx - w[0] * .5 - v[0] * .1, cy - w[1] * .5 - v[1] * .1);
    ctx.stroke();
  }
  function headFx(p, t, i, hp, pts) { // 眼睛、吐舌、冲刺闪电（头位置用插值坐标）
    const [sx, sy] = K.P(hp.x, hp.y), cx = sx, cy = sy + K.HH - 9, dx = p.dir[0], dy = p.dir[1];
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
  function overlay(t1, t2) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, S.W, S.H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '600 22px system-ui,sans-serif'; ctx.fillText(t1, S.W / 2, S.H / 2 - 4);
    ctx.font = '14px system-ui,sans-serif'; ctx.fillText(t2, S.W / 2, S.H / 2 + 20);
  }
  function draw(t) {
    ctx.clearRect(0, 0, S.W, S.H);
    if (pal.star) STARS.forEach((s, i) => { // 无星空主题（亮色）不绘星空
      ctx.fillStyle = K.rgba(pal.star, (.25 + .35 * Math.sin(t / 700 + i)).toFixed(2));
      ctx.fillRect(s[0] * S.W, s[1] * S.H, s[2], s[2]);
    });
    vignette();
    const raw = (t - (draw.t || t)) / 1000, dt = Math.min(.05, raw); draw.t = t;
    if (!document.hidden) { // 后台标签页的巨帧不参与性能判定
      S.frameDt = S.frameDt * .95 + Math.min(.2, raw) * .05;
      if (S.frameDt > K.TUNE.lowFxOn) { S.lowFx = true; S.fxGood = 0; }          // 低端机自动关辉光
      else if (S.frameDt < K.TUNE.lowFxOff) { if (S.lowFx && ++S.fxGood >= K.TUNE.lowFxRecover) { S.lowFx = false; S.fxGood = 0; } } // 滞回恢复：卡顿是暂时的
      else S.fxGood = 0;
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
    ctx.globalCompositeOperation = 'lighter';
    S.pl.forEach((p, i) => { // 蛇与食物映在地板的光（随插值）
      const c = K.rgba(K.SK[S.skin[i]].body[1], .16), arr = PTS[i];
      if (!S.lowFx) for (let j = 0; j < arr.length; j++) { const [sx, sy] = K.P(arr[j].x, arr[j].y); diamond(sx, sy + K.HH, K.HW * 1.3, K.HH * 1.3, c); }
      p.trail = p.trail.filter(s => now - s.b < 500);
      streak(p, now, arr[0]);
    });
    S.foods.forEach(f => { const [sx, sy] = K.P(f.x, f.y); diamond(sx, sy + K.HH, K.HW * 1.5, K.HH * 1.5, K.rgba(fg, .18)); });
    ctx.globalCompositeOperation = 'source-over';
    const items = [];
    S.pl.forEach((p, i) => PTS[i].forEach((s, j) => items.push({ x: s.x, y: s.y, i, j, n: p.body.length, head: j === 0, dead: p.dead })));
    S.foods.forEach(f => items.push({ x: f.x, y: f.y, food: true }));
    items.sort((a, b) => (a.x + a.y) - (b.x + b.y)); // 画家算法：后 → 前
    for (const o of items) {
      if (o.food) {
        const [sx, sy] = K.P(o.x, o.y);
        diamond(sx, sy + K.HH, K.HW * .5, K.HH * .5, 'rgba(0,0,0,.25)');
        if (!S.lowFx) { // 食物常驻光晕：径向渐变呼吸（非粒子，直接绘制）
          const r0 = 14 + Math.sin(t / 300) * 4;
          const g = ctx.createRadialGradient(sx, sy + K.HH, 2, sx, sy + K.HH, r0);
          g.addColorStop(0, K.rgba(fg, .4)); g.addColorStop(1, K.rgba(fg, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy + K.HH, r0, 0, 6.283); ctx.fill();
        }
        cube(o.x, o.y, .55, 8, 3 + Math.sin(t / 250) * 2.5, K.MODES[S.mode].players === 2 ? K.FOOD_PK : foodC, fg);
      } else if (o.head) cube(o.x, o.y, .98, 9, 0, o.dead ? K.DEAD : S.pl[o.i].sprint ? K.SPRINT_HEAD : K.SK[S.skin[o.i]].head, o.dead ? null : S.pl[o.i].sprint ? pal.glow : K.SK[S.skin[o.i]].body[1]);
      else { // 身体鳞片：向尾部渐细 + 光晕 + 人字缝
        const k = Math.max(0, (o.j - (o.n - 7)) / 7), s = .92 - .32 * k, hg = 8 - 3 * k, col = K.SK[S.skin[o.i]];
        halo(o.x, o.y, hg, col.body[1]);
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
      const hp = PTS[i][0], [sx, sy] = K.P(hp.x, hp.y);
      ctx.fillStyle = K.SK[S.skin[i]].body[2]; ctx.fillRect(sx - 12, sy - 26, 24, 15);
      ctx.fillStyle = '#fff'; ctx.font = '600 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText(K.nm(i), sx, sy - 15);
    });
    if (sh > 0) ctx.restore();
    if (S.state === 'ready') overlay(pk ? (K.MODES[S.mode].ai ? '人机对战' : '双人对战') : '等距贪吃蛇', pk ? (K.MODES[S.mode].ai ? 'WASD 或方向键 · E/Shift 冲刺 · 点击开始' : 'P1 WASD·E 冲刺   P2 方向键·Enter 冲刺') : '点击画面或按方向键开始');
    else if (S.state === 'paused') overlay(S.msg || '已暂停', '点击画面或按空格继续');
    else if (S.state === 'over') overlay(S.msg || (pk ? (S.winner < 0 ? '平局' : K.MODES[S.mode].ai ? (S.winner ? 'AI 获胜' : '你赢了') : 'P' + (S.winner + 1) + ' 获胜') : '游戏结束 · ' + S.pl[0].score + ' 分'), '点击画面重新开始');
  }
  function frame(t) {
    api.update(t);                       // core 追赶式 tick
    try { draw(t); } catch (e) { console.error(e); } // 绘制错误绝不让游戏循环停摆
    requestAnimationFrame(frame);
  }
  function boot() {
    applyCanvasSize();
    bus.on('resize', applyCanvasSize);
    addEventListener('resize', applyCanvasSize); // 窗口尺寸/方向变化重 fit
    requestAnimationFrame(frame);
  }
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; }, refit: fitCanvas };
})();