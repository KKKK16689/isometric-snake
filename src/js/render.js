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
     即 60Hz 下至少漏一帧；预热 45 帧跳过启动尖峰，避免把加载/切主题的瞬时抖动当成设备慢），
     漏帧多就按 0.85 逐档降 dprEff，最低到「1 设备像素 = 1 CSS 像素」（清晰度下限，不会再糊）；
     只有在 dpr=1 的屏幕上、且漏帧率超过 35% 时，才允许再降到 0.75 倍 CSS（略软换流畅，回升即复原）。
     几乎不漏帧且过了试升冷却再逐档升回。只改背店分辨率，几何 / 配色 / 规则一概不动。 */
  let qScale = 1, qHold = 0, qProbe = 0, qWin = 0, qDrop = 0, qPre = 0, qDirty = false, qFloor = 1;
  const Q = { min: .5, step: .85, dropMs: 25, dropHi: .08, dropLo: .01, warmup: 45, win: 60, retryMs: 30000, softMin: 1 };   // retryMs：升档冷却 30s——每次换档都要重建背店（一帧尖峰），别太频繁
  const BUILD = 'stage5.0';   // 构建标记：?fps=1 读数里显示，便于确认浏览器拿到的是哪一版（排查 SW 缓存/旧标签页）
  const FPS_ON = /(^|[?&])fps=1(&|$)/.test((typeof location !== 'undefined' && location.search) || '');   // ?fps=1 诊断读数
  const QFIX = (() => {   // ?q=0.4~1：固定画质倍率（并用它关掉自适应降档），给用户做清晰度/流畅度 A/B
    const m = /(^|[?&])q=([0-9.]+)/.exec((typeof location !== 'undefined' && location.search) || '');
    const v = m ? parseFloat(m[2]) : 0;
    return v >= .4 && v <= 1 ? v : 0;
  })();
  let fpsT0 = 0, fpsN = 0, fpsVal = 0;
  let scale = 1;                                        // 逻辑单位 → 设备像素
  let cssK = 1, cssW = 0, cssH = 0;                     // CSS 像素 / 逻辑单位；cssW/H = 实测 CSS 尺寸（诊断读数用）
  let lastW = -1, lastH = -1, lastDpr = -1, lastSW = -1, lastSH = -1;  // 变更检测：尺寸没变不重建缓存
  const snap = v => Math.round(v * scale) / scale;      // 静态顶点对齐设备像素（蛇插值坐标不取整，否则抖）
  let boardCache = null;                 // 地板离屏缓存
  let vig = null;                        // 背景晕影渐变缓存（resize/换主题时重建）
  let pal = Snake.theme.current.canvas;  // 当前主题渲染调色板（只读）
  let foodC = K.shades(pal.food);        // 食物立方体三面色（随主题）
  const GHOST_C = ['#F0F2F5', '#C3C9D4', '#98A0AE'];   // 幽灵回放蛇（半透明灰白，不随主题）
  const GOLD = K.shades('#F2B33D');                    // 金苹果三面色（固定金色）
  let camOX = 0, camOY = 0;   // 世界→屏幕偏移：远征相机用；经典模式恒 0（逐帧绘制与 2.0 完全一致）
  const PX = (x, y) => S.OX + (x - y) * K.HW - camOX, PY = (x, y) => K.OY + (x + y) * K.HH - camOY;   // K.P 标量版：逐帧热循环零分配
  /* 相机：把 core 每帧算好的 S.camCX/camCY 投到画布中心（经典模式直接归零） */
  function camUpdate() {
    if (!S.T) { camOX = 0; camOY = 0; return; }
    const c = K.P(S.camCX, S.camCY), px = 1 / (scale || 1);   // 一个设备像素对应的逻辑长度
    camOX = Math.round((c[0] - S.W / 2) / px) * px;           // 偏移对齐设备像素：静态地块不抖，实体仍走亚像素
    camOY = Math.round((c[1] - S.H / 2) / px) * px;
  }
  const MARGIN = 4;   // 静态层比视口多画 4 格，相机越过 margin 才重建（重建越稀，跟随时越不容易卡顿）
  const ITEM_MARGIN = 1;   // items 只多算 1 格：不可见格不参与逐帧绘制（规格 §4）
  let bX0 = 0, bY0 = 0, bX1 = -1, bY1 = -1;   // 当前静态层覆盖的格范围
  function viewBounds(mg = MARGIN) {
    if (!S.T) return { x0: 0, y0: 0, x1: S.N - 1, y1: S.N - 1 };   // 经典：整块棋盘
    const half = S.VIEW_N / 2;
    return {
      x0: Math.max(0, Math.floor(S.camCX - half) - mg), y0: Math.max(0, Math.floor(S.camCY - half) - mg),
      x1: Math.min(S.N - 1, Math.ceil(S.camCX + half) + mg), y1: Math.min(S.N - 1, Math.ceil(S.camCY + half) + mg)
    };
  }
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
    const base = Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(maxPixels(w, h) / Math.max(1, w * h)));   // 设备/预算上限
    const dprEff = QFIX ? Math.max(.4, base * QFIX) : Math.max(qFloor, base * qScale);   // qFloor 默认 1（1 设备像素 = 1 CSS 像素，保清晰）；只有持续严重掉帧才放宽到 softMin
    cv.style.aspectRatio = S.W + '/' + S.H;        // 保比例防拉伸（列式布局靠它定高）
    cssW = w; cssH = h;
    if (w === lastW && h === lastH && dprEff === lastDpr && S.W === lastSW && S.H === lastSH) return;   // 无变化：不重建
    lastW = w; lastH = h; lastDpr = dprEff; lastSW = S.W; lastSH = S.H;
    cv.width = Math.round(w * dprEff); cv.height = Math.round(h * dprEff);
    cssK = w / S.W; scale = dprEff * cssK;         // 逻辑 → CSS → 设备 两级比例
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (mmCv) {   // 小地图同样按设备像素重设背店（固定 96 CSS px 见方）
      mmCv.width = mmCv.height = Math.round(96 * dprEff); mmCtx.setTransform(dprEff, 0, 0, dprEff, 0, 0);
    }
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
  let boardCv = null;                    // 静态层离屏画布：经典＝整块棋盘；远征＝比视口大一圈的「世界区域」
  let bWOX = 0, bWOY = 0;                // 远征静态层左上角对应的世界逻辑坐标（与相机无关）
  let bRegion = null;                    // 远征静态层覆盖的格范围
  const BMARGIN = 2;                     // 区域比视口每边多留的格数（相机越界时只平移 + 补边条）
  function worldBox(b) {                 // 格范围 → 世界包围盒（含地块高度与瓦片半高留白）
    const x0 = S.OX + (b.x0 - b.y1) * K.HW, y0 = K.OY + (b.x0 + b.y0) * K.HH;
    const x1 = S.OX + (b.x1 - b.y0) * K.HW, y1 = K.OY + (b.x1 + b.y1) * K.HH;
    const px = K.HW * 1.2, pt = K.TH * 2.4;
    return { x: x0 - px, y: y0 - pt, w: (x1 - x0) + px * 2, h: (y1 - y0) + pt + K.TH * 1.2 };
  }
  /* 远征静态层：画在「世界坐标」里，逐帧只按相机平移贴图（不再随相机重画 ⇒ 地板不再一格一跳、也不掉帧）。
     相机走出预留的 2 格才平移：把已有内容整体自拷贝过去，只补新露出来的边条。 */
  function ensureBoard() {
    const need = viewBounds(0);                                  // 视口本身需要的格范围
    const want = { x0: need.x0 - BMARGIN, y0: need.y0 - BMARGIN, x1: need.x1 + BMARGIN, y1: need.y1 + BMARGIN };
    if (S.T) {   // 别画到地图外面去
      const w = S.T.w - 1, h = S.T.h - 1;
      want.x0 = Math.max(0, want.x0); want.y0 = Math.max(0, want.y0);
      want.x1 = Math.min(w, want.x1); want.y1 = Math.min(h, want.y1);
    }
    if (!boardCv) boardCv = document.createElement('canvas');
    const box = worldBox(want);
    const ox = Math.round(box.x * scale) / scale, oy = Math.round(box.y * scale) / scale;   // 原点对齐设备像素
    const pw = Math.max(1, Math.ceil((box.x + box.w - ox) * scale)), ph = Math.max(1, Math.ceil((box.y + box.h - oy) * scale));
    const covered = bRegion && bRegion.x0 <= need.x0 && bRegion.y0 <= need.y0 && bRegion.x1 >= need.x1 && bRegion.y1 >= need.y1;
    if (covered && boardCv.width === pw && boardCv.height === ph) return;   // 区域仍够用：这一帧零成本
    const m = boardCv.getContext('2d');
    if (!bRegion || boardCv.width !== pw || boardCv.height !== ph) {        // 首次 / 换画质 / 跨度变（到地图边）：整块重画
      boardCv.width = pw; boardCv.height = ph;                              // 赋 width 同时清屏
      bRegion = want; bWOX = ox; bWOY = oy;
      m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, pw, ph);
      paintBoard(bRegion, want.x0, want.y0, want.x1, want.y1, true);
      return;
    }
    const prev = bRegion, kx = bWOX, ky = bWOY;                             // 平移：内容整体自拷贝 + 只补新露出的边条
    bRegion = want; bWOX = ox; bWOY = oy;
    const sx = (bWOX - kx) * scale, sy = (bWOY - ky) * scale;               // 原点都对齐过设备像素 ⇒ 整数位移，不重采样
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'copy';
    m.drawImage(boardCv, -sx, -sy); m.globalCompositeOperation = 'source-over';
    if (want.x0 < prev.x0) paintBoard(bRegion, want.x0, want.y0, prev.x0 - 1, want.y1, true);
    if (want.y0 < prev.y0) paintBoard(bRegion, want.x0, want.y0, want.x1, prev.y0 - 1, true);
    if (want.x1 > prev.x1) paintBoard(bRegion, prev.x1 + 1, want.y0, want.x1, want.y1, true);
    if (want.y1 > prev.y1) paintBoard(bRegion, want.x0, prev.y1 + 1, want.x1, want.y1, true);
  }
  function drawBoard() {
    const b = viewBounds();
    if (!S.T) {   // 经典：整块棋盘，贴图参数与 2.0 逐字一致（视觉锁）
      if (!boardCache || b.x0 !== bX0 || b.y0 !== bY0 || b.x1 !== bX1 || b.y1 !== bY1) {
        if (!boardCv) boardCv = document.createElement('canvas');
        boardCv.width = cv.width; boardCv.height = cv.height;   // 赋 width 同时清屏（与主画布同背店尺寸）
        paintBoard(b, b.x0, b.y0, b.x1, b.y1, false);
        boardCache = boardCv; bX0 = b.x0; bY0 = b.y0; bX1 = b.x1; bY1 = b.y1;
      }
      ctx.drawImage(boardCache, 0, 0, S.W, S.H);
      return;
    }
    ensureBoard();                                              // 远征：世界区域滚动
    const dx = bWOX - camOX, dy = bWOY - camOY;                  // 区域左上角的屏幕位置（逻辑单位）
    const s0x = Math.max(0, -dx * scale), s0y = Math.max(0, -dy * scale);
    const s1x = Math.min(boardCv.width, (S.W - dx) * scale), s1y = Math.min(boardCv.height, (S.H - dy) * scale);
    if (s1x <= s0x || s1y <= s0y) return;
    const px = 1 / (scale || 1);                                 // 目标位置对齐设备像素：地板不抖
    ctx.drawImage(boardCv, s0x, s0y, s1x - s0x, s1y - s0y,
      Math.round((dx + s0x / scale) / px) * px, Math.round((dy + s0y / scale) / px) * px,
      (s1x - s0x) / scale, (s1y - s0y) / scale);
  }
  function isDarkBg() { const h = Snake.theme.current.css.bg, c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return (.299 * c[0] + .587 * c[1] + .114 * c[2]) < 128; }
  function sideGrad(a, b, col) { // 侧面平行四边形：顶色→压暗 40% 纵向渐变（细腻层，离屏缓存）
    const g = ctx.createLinearGradient(0, a[1], 0, a[1] + 8);
    g.addColorStop(0, col); g.addColorStop(1, K.shades(col)[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] + 8); ctx.lineTo(a[0], a[1] + 8); ctx.closePath(); ctx.fill();
  }
  function paintBoard(b, x0, y0, x1, y1, world) {
    const main = ctx; ctx = boardCv.getContext('2d');            // 画进静态层
    const kx = camOX, ky = camOY;
    if (world) { camOX = 0; camOY = 0; ctx.setTransform(scale, 0, 0, scale, -bWOX * scale, -bWOY * scale); }  // 世界坐标
    else ctx.setTransform(scale, 0, 0, scale, 0, 0);
    try { paintTiles(b, x0, y0, x1, y1, world); }
    finally { camOX = kx; camOY = ky; ctx = main; }
  }
  function paintTiles(b, x0, y0, x1, y1, world) {
          const dark = isDarkBg(), lw = 1 / cssK;   // 网格/倒角线宽 = 1 CSS px（不随显示缩放变粗）
    let skirt = null;   // 经典：整块棋盘的台缘（远征视口在地图内部，台缘不可见 ⇒ 不画）
    if (!S.T && !world) {
      const l = [snap(S.OX - S.N * K.HW), snap(K.OY + S.N * K.HH)], r = [snap(S.OX + S.N * K.HW), snap(K.OY + S.N * K.HH)], bo = [snap(S.OX), snap(K.OY + S.N * K.TH)];
      sideGrad(l, bo, pal.floorLeft); sideGrad(r, bo, pal.floorRight);
      skirt = { l, r, bo };
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const sx = snap(PX(x, y)), sy = snap(PY(x, y) + K.HH);   // 瓦片中心：对齐设备像素，边缘不虚
      const lavaT = S.T && (() => { const l0 = S.T.layerAt(x, y, 0); return !!l0 && l0.kind === 'lava'; })();
            if (lavaT) {   // 熔岩地块：暗红底 + 亮橙裂纹 + 中心余烬（静态层一次画好，不参与逐帧开销）
              diamond(sx, sy, K.HW, K.HH, '#2A0F0A');
              ctx.strokeStyle = 'rgba(255,122,42,.85)'; ctx.lineWidth = 1.6 / cssK;
              ctx.beginPath();
              ctx.moveTo(sx - K.HW * .52, sy); ctx.lineTo(sx - K.HW * .12, sy - K.HH * .34);
              ctx.lineTo(sx + K.HW * .30, sy + K.HH * .06); ctx.lineTo(sx + K.HW * .5, sy + K.HH * .38);
              ctx.stroke();
              diamond(sx, sy, K.HW * .44, K.HH * .44, 'rgba(255,196,80,.8)');
              continue;
            }
      
      const ls = S.T ? S.T.at(x, y) : null;                    // 远征：按层图区分水面（Stage 1 只做灰模 + 硬阻挡）
      const portalL = ls ? ls.find(l => l.kind === 'portal') : null;   // 传送门格：画成醒目的青色漩涡（进静态层 ⇒ 零逐帧成本）
      if (portalL) {
        diamond(sx, sy, K.HW, K.HH, '#0B1A2A');                                          // 门底压深，和地面拉开
        diamond(sx, sy, K.HW * .84, K.HH * .84, 'rgba(127,212,255,.26)');
        diamond(sx, sy, K.HW * .54, K.HH * .54, 'rgba(127,212,255,.5)');
        ctx.strokeStyle = 'rgba(190,240,255,.95)'; ctx.lineWidth = 2 * lw;               // 双线环：一眼能认出
        ctx.beginPath(); ctx.moveTo(sx, sy - K.HH * .84); ctx.lineTo(sx + K.HW * .84, sy); ctx.lineTo(sx, sy + K.HH * .84); ctx.lineTo(sx - K.HW * .84, sy); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = 'rgba(6,12,22,.9)'; ctx.font = 'bold ' + (10 / cssK) + 'px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText((portalL.portal || '?').toUpperCase(), sx, sy);                     // 字母：同字母＝一对（规格 §3.4）
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        continue;
      }
      if (ls && ls.some(l => l.kind === 'gate')) {   // 周期闸门：地面轨道 + 两根立柱（静态层；能量帘由动态层按相位画）
        diamond(sx, sy, K.HW, K.HH, '#101A26');
        diamond(sx, sy, K.HW * .9, K.HH * .9, '#1B2836');
        ctx.strokeStyle = 'rgba(127,212,255,.5)'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(sx - K.HW * .8, sy + K.HH * .12); ctx.lineTo(sx, sy - K.HH * .66); ctx.lineTo(sx + K.HW * .8, sy + K.HH * .12); ctx.stroke();
        diamond(sx - K.HW * .74, sy - K.HH * 1.05, K.HW * .16, K.HH * .3, '#C9D6E4');
        diamond(sx + K.HW * .74, sy - K.HH * 1.05, K.HW * .16, K.HH * .3, '#C9D6E4');
        continue;
      }
      if (ls && ls.some(l => l.kind === 'ice')) {   // 冰面：一眼可辨——冷白镜面 + 斜高光 + 裂纹（静态层一次画好，零逐帧成本）
        diamond(sx, sy, K.HW, K.HH, '#0E2A38');
        diamond(sx, sy, K.HW * .95, K.HH * .95, 'rgba(198,234,248,.95)');
        ctx.strokeStyle = 'rgba(84,140,170,.6)'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(sx - K.HW * .58, sy + K.HH * .30); ctx.lineTo(sx - K.HW * .10, sy - K.HH * .18); ctx.lineTo(sx + K.HW * .22, sy - K.HH * .02); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.beginPath(); ctx.moveTo(sx - K.HW * .30, sy - K.HH * .46); ctx.lineTo(sx + K.HW * .34, sy + K.HH * .10); ctx.stroke();
        continue;
      }
      const water = !!ls && ls.some(l => l.kind === 'water') && !ls.some(l => l.kind === 'deck');
      diamond(sx, sy, K.HW, K.HH, water ? '#16324F' : ((x + y) % 2 ? pal.floorTop : pal.floorRight));
      ctx.strokeStyle = water ? 'rgba(120,190,255,.18)' : pal.grid; ctx.lineWidth = lw; // 网格线随主题
      ctx.beginPath(); ctx.moveTo(sx, sy - K.HH); ctx.lineTo(sx + K.HW, sy); ctx.lineTo(sx, sy + K.HH); ctx.lineTo(sx - K.HW, sy); ctx.closePath(); ctx.stroke();
      if (water) continue;                                     // 水面不铺主题地板图案
      ctx.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.5)'; ctx.lineWidth = lw; // 瓦片倒角：上两边高光
      ctx.beginPath(); ctx.moveTo(sx - K.HW, sy); ctx.lineTo(sx, sy - K.HH); ctx.lineTo(sx + K.HW, sy); ctx.stroke();
      Snake.Patterns.draw(Snake.theme.current.pattern, ctx, sx, sy, pal, x, y); // 主题地板图案（缓存层）
    }
    if (skirt) {   // 台缘描边光（顺序与 2.0 一致，视觉锁依赖）
      ctx.strokeStyle = K.rgba(pal.glow, .45); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(snap(S.OX), snap(K.OY)); ctx.lineTo(skirt.r[0], skirt.r[1]); ctx.lineTo(skirt.bo[0], skirt.bo[1]); ctx.lineTo(skirt.l[0], skirt.l[1]); ctx.closePath(); ctx.stroke();
    }
  }
  /* ---------- 地形块（Stage 1 灰模：墙 / 高台 / 桥面，参与同一套深度排序） ---------- */
  const BLK = 9;                                    // 每层高度（px）
  /* 地形配色按关卡的 biome 走（Stage 4：布局 / biome 皮肤 / 规则三层分离）。
     直接原地覆写 TERR_C 的三个槽位，各处绘制代码不用动。 */
  const BIOMES = {
    grey: { top: '#8A94A6', left: '#5A6473', right: '#3B4252', strip: null },        // 灰模：测试图与既有两张开阔图
    neon: { top: '#4B5A80', left: '#2C3757', right: '#1B2340', strip: '#5AC8FF' },    // 霓虹都市：偏冷的深蓝楼体 + 青色灯带
    ruins: { top: '#7C8C63', left: '#4E5A3C', right: '#333C28', strip: null },   // 森林遗迹：苔绿石台（先不画灯带，晚点看效果再说）
    lava: { top: '#6A5A52', left: '#463832', right: '#2A211D', strip: '#FF8A3D' },     // 火山口：玄武岩 + 岩缝里透出的橙光
    ice: { top: '#BFE3F2', left: '#7FA8BE', right: '#54788C', strip: '#FFFFFF' },
    station: { top: '#9AA7B8', left: '#5E6B7C', right: '#39434F', strip: '#7FD4FF' }   // 太空站：冷灰金属 + 青色能量条   // 冰原：冷白台面 + 白色高光条
  };
  const TERR_C = ['#8A94A6', '#5A6473', '#3B4252']; // 顶 / 左 / 右（由 syncBiome 按关卡 biome 覆写）
  let STRIP = null;                                 // 楼面灯带色（biome 提供；灰模为 null ⇒ 不画）
  let biomeFor = null;
  function syncBiome() {                            // 关卡换了才重算（每帧调用只是比一次字符串）
    if (biomeFor === S.levelId) return;
    biomeFor = S.levelId;
    const lv = (Snake.levelById && Snake.levelById(S.levelId)) || null;
    const b = BIOMES[(lv && lv.biome) || 'grey'] || BIOMES.grey;
    TERR_C[0] = b.top; TERR_C[1] = b.left; TERR_C[2] = b.right; STRIP = b.strip || null;
  }
  const liftOf = (x, y) => S.T ? ((S.T.topWalk(x, y) || { h: 0 }).h) * BLK : 0;   // 该格「最高可走层」的抬升（食物/金苹果落点按此层）
  const liftAt = (x, y, L) => S.T ? (L || 0) * BLK : 0;   // 实体按自己所在层的层高抬升（规格 §3.2：层号参与碰撞与渲染）
  let PORTALS = [], portalsFor = null;                    // 传送门位置缓存（关卡换了才重算——门很少，重算可忽略）
  function refreshPortals() {
    if (portalsFor === S.T) return;
    portalsFor = S.T; PORTALS = [];
    if (!S.T) return;
    for (const n of S.T.walkables()) { const l = S.T.layerAt(n.x, n.y, n.L); if (l && l.kind === 'portal') PORTALS.push({ x: n.x, y: n.y, L: n.L }); }
  }
  const blkTop = (x, y) => {   // 该格「地块」的顶面高度（px）：平地 0；墙/高台/桥面取最高层
    const ls = S.T && S.T.at(x, y); if (!ls) return 0;
    let m = 0;
    for (const l of ls) if (!(l.walkable && l.h === 0)) m = Math.max(m, l.h);
    return m * BLK;
  };
  function drawTerr(o) {
    const t = o.terr, bot = (t.lower && t.lower.walkable ? t.lower.h : 0) * BLK, top = t.h * BLK;
    const cx = PX(o.x, o.y), cy = PY(o.x, o.y) + K.HH, a = K.HW * .94, b = K.HH * .94;
    if (top <= bot) return;
    // 挡在蛇前面的高地形靠近时半透明：别把蛇和地图糊住（用户反馈：墙体遮住地图）
    let al = 1;
    const hd = S.pl[0] && S.pl[0].body[0];
    if (hd && top > liftAt(hd.x, hd.y, hd.L) + 2 && (o.x + o.y) > (hd.x + hd.y) &&
        Math.abs(o.x - hd.x) + Math.abs(o.y - hd.y) <= 3) al = .34;
    if (al < 1) ctx.globalAlpha = al;
    if (t.kind === 'deck') {   // 桥面：地面投影 + 两根斜柱（简报 Q5）
      diamond(cx, cy, a * .7, b * .7, 'rgba(0,0,0,.22)');
      const pw = a * .16;
      poly([[cx - a * .55, cy - top + b * .5], [cx - a * .55 + pw, cy - top + b * .5], [cx - a * .55 + pw, cy + b * .5], [cx - a * .55, cy + b * .5]], TERR_C[2]);
      poly([[cx + a * .55 - pw, cy - top + b * .5], [cx + a * .55, cy - top + b * .5], [cx + a * .55, cy + b * .5], [cx + a * .55 - pw, cy + b * .5]], TERR_C[1]);
    }
    // 被前排同高/更高的地块挡住的侧面直接不画（成排的墙能省掉大半填充；等距下左面被 (x,y+1) 挡、右面被 (x+1,y) 挡）
    if (top > blkTop(o.x, o.y + 1)) poly([[cx - a, cy - top], [cx, cy + b - top], [cx, cy + b - bot], [cx - a, cy - bot]], TERR_C[1]);
    if (top > blkTop(o.x + 1, o.y)) poly([[cx + a, cy - top], [cx, cy + b - top], [cx, cy + b - bot], [cx + a, cy - bot]], TERR_C[2]);
    if (STRIP) {   // 霓虹都市：楼面竖向灯带（只画朝外且没被前排挡住的侧面）＋高架/桥面顶面两道边缘光条
      const s0 = .70, s1 = .88, th = 2 / cssK;
      if (t.kind === 'wall') {
        if (top > blkTop(o.x, o.y + 1))
          poly([[cx - a + a * s0, cy - top + b * s0], [cx - a + a * s1, cy - top + b * s1], [cx - a + a * s1, cy - bot + b * s1], [cx - a + a * s0, cy - bot + b * s0]], STRIP);
        if (top > blkTop(o.x + 1, o.y))
          poly([[cx + a - a * s0, cy - top + b * s0], [cx + a - a * s1, cy - top + b * s1], [cx + a - a * s1, cy - bot + b * s1], [cx + a - a * s0, cy - bot + b * s0]], STRIP);
      } else if (t.kind === 'deck') {
        poly([[cx - a, cy - top], [cx, cy + b - top], [cx, cy + b - top + th], [cx - a, cy - top + th]], STRIP);
        poly([[cx + a, cy - top], [cx, cy + b - top], [cx, cy + b - top + th], [cx + a, cy - top + th]], STRIP);
      }
    }
    diamond(cx, cy - top, a, b, t.kind === 'wall' ? TERR_C[2] : TERR_C[0]);   // 墙顶压暗，和台面区分
    if (al < 1) ctx.globalAlpha = 1;
  }
  /* ---------- 特效（吃食/撞击/胜利特效由 particles.js 对象池负责） ---------- */
  const STARS = Array.from({ length: 40 }, (_, i) => [K.fr(i * 3 + 1), K.fr(i * 3 + 2), K.fr(i * 3 + 3) > .8 ? 2 : 1]);
  function halo(x, y, hgt, col, z) { // 身体鳞片廉价光晕（无模糊）；调用方保证处于加法通道内；z＝该节当前抬升
    if (S.lowFx) return;
    const sx = PX(x, y), sy = PY(x, y) - (z || 0);
    diamond(sx, sy + K.HH - hgt, K.HW * 1.3, K.HH * 1.3, K.rgba(col, .07));   // Stage 0：降 alpha，减少边缘发软
    diamond(sx, sy + K.HH - hgt, K.HW * 1.7, K.HH * 1.7, K.rgba(col, .035));
  }
  /* ---------- 移动插值 ----------
     core 每次移动记录 p.moveT/p.moveP（渲染时钟）与 p.moveTGame（同一刻的游戏时钟）。
     默认用渲染时钟 + 缓出曲线：按下转向后头部立即起步，且在下一格到来前就基本到位——线性插值要满
     moveP 才到位，观感上比 2.0 慢半拍（用户反馈「按键后响应偏慢」）；2.0 用的是游戏时钟，起步就
     跳掉最多半格（快但有瞬移）。?interp=legacy 可切回 2.0 时钟做 A/B。 */
  const LEGACY_INTERP = /(^|[?&])interp=legacy(&|$)/.test((typeof location !== 'undefined' && location.search) || '');
  const SPAN = (() => {   // ?span=0.5~1：视觉到位只用「一格时间」的这个比例，剩下的时间停在新格上（越小手感越冲）
    const m = /(^|[?&])span=([0-9.]+)/.exec((typeof location !== 'undefined' && location.search) || '');
    const v = m ? parseFloat(m[2]) : 1;
    return v >= .5 && v <= 1 ? v : 1;
  })();
  const EASE_POW = 2.2;                                  // 缓出指数（1 = 线性；越大越早到位）
  const ease = a => a <= 0 ? 0 : a >= 1 ? 1 : 1 - Math.pow(1 - a, EASE_POW);
  const PTS = [[], []];                                   // 每玩家浮点格坐标缓存（逐帧复用，零分配）
  const items = [];                                       // 画家算法排序表（对象池复用，逐帧零分配）
  function segPos(p, j, t, out) {
    const cur = p.body[j], t0 = LEGACY_INTERP ? (p.moveTGame || p.moveT) : p.moveT;
    const a = p.moveP ? (t - t0) / (p.moveP * SPAN) : 1;
    // a≤0 必须画「旧格」：移动那一帧 t 与 moveT 完全相等（update 与 draw 同帧同钟），画新格会先瞬移一帧、
    // 下一帧再倒回旧格起步 —— 每格一次的一帧抖动，观感就是「一顿一顿」。a≥1（未动/暂停/结束）才停稳在新格。
    const from = j < p.body.length - 1 ? p.body[j + 1] : (p.grew ? cur : (p.tailFrom || cur));   // 中段来自 body[j+1]；生长帧尾段原地，否则来自让出的旧尾格
    const e = a <= 0 ? 0 : a >= 1 ? 1 : ease(a);
    out.x = from.x + (cur.x - from.x) * e; out.y = from.y + (cur.y - from.y) * e;
    const zf = liftAt(from.x, from.y, from.L), zc = liftAt(cur.x, cur.y, cur.L);
    out.z = zf + (zc - zf) * e;   // 高度按同一条曲线插值：蛇是「爬」上台面，不是整条弹上去（用户反馈）
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
    for (let q = 0; q < n0; q++) { const s = p.trail[q]; if (!TR[q]) TR[q] = [0, 0, 0]; TR[q][0] = PX(s.x, s.y); TR[q][1] = PY(s.x, s.y) + K.HH - 6 - liftAt(s.x, s.y, s.L); TR[q][2] = 1 - (now - s.b) / 500; }
    if (p.sprint) { if (!TR[n0]) TR[n0] = [0, 0, 0]; TR[n0][0] = PX(hp.x, hp.y); TR[n0][1] = PY(hp.x, hp.y) + K.HH - 6 - (hp.z || 0); TR[n0][2] = 1; }
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
    const cx = PX(hp.x, hp.y), cy = PY(hp.x, hp.y) + K.HH - 9 - (hp.z || 0), dx = p.dir[0], dy = p.dir[1];
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
  /* ---------- 远征小地图：HUD 一侧独立小 canvas，4~8Hz 重绘（规格 §4） ---------- */
  const mmCv = document.getElementById('mm'), mmCtx = mmCv ? mmCv.getContext('2d') : null;
  let mmT = 0;
  const MM_C = { ground: '#2C3757', deck: '#54637F', water: '#16324F', portal: '#7FD4FF', food: '#F2B33D', head: '#5DCAA5', frame: 'rgba(255,255,255,.5)' };
  function mmUpdate(t) {
    if (!mmCtx) return;
    const on = !!S.T && S.mode === 'expedition';
    if (document.body.classList.contains('mm') !== on) document.body.classList.toggle('mm', on);
    if (!on || t - mmT < 200) return;   // 4~8Hz：别每帧重绘（规格 §4）
    mmT = t;
    const w = 96, h = 96, cell = Math.min(w, h) / S.N;
    mmCtx.clearRect(0, 0, w, h);
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {   // 地图轮廓：最高可走层上色；水面标冷色，墙留空
      const ls = S.T.at(x, y); if (!ls) continue;
      let c = null, water = false;
      for (let i = ls.length - 1; i >= 0; i--) {
        if (ls[i].walkable) { c = ls[i].kind === 'portal' ? MM_C.portal : (ls[i].kind === 'deck' ? MM_C.deck : MM_C.ground); break; }
        if (ls[i].kind === 'water') water = true;
      }
      if (!c) { if (!water) continue; c = MM_C.water; }
      mmCtx.fillStyle = c;
      mmCtx.fillRect(Math.round(x * cell), Math.round(y * cell), Math.max(1, Math.round(cell)), Math.max(1, Math.round(cell)));
    }
    const dot = Math.max(2, Math.round(cell) + 1);
    mmCtx.fillStyle = MM_C.food;                                   // 食物
    for (const f of S.foods) mmCtx.fillRect(Math.round(f.x * cell) - 1, Math.round(f.y * cell) - 1, dot, dot);
    const hp = S.pl[0].body[0];                                    // 玩家
    mmCtx.fillStyle = MM_C.head; mmCtx.fillRect(Math.round(hp.x * cell) - 1, Math.round(hp.y * cell) - 1, dot, dot);
    const half = S.VIEW_N / 2;                                     // 视口框
    const vx0 = Math.max(0, S.camCX - half), vy0 = Math.max(0, S.camCY - half), vx1 = Math.min(S.N, S.camCX + half), vy1 = Math.min(S.N, S.camCY + half);
    mmCtx.strokeStyle = MM_C.frame; mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    mmCtx.rect(Math.round(vx0 * cell) + .5, Math.round(vy0 * cell) + .5, Math.max(1, Math.round((vx1 - vx0) * cell) - 1), Math.max(1, Math.round((vy1 - vy0) * cell) - 1));
    mmCtx.stroke();
  }
  function draw(t) {
    syncBiome();                                         // 关卡换了先把地块配色换掉，再（可能）重建静态层
    if (qDirty) { qDirty = false; applyCanvasSize(); }   // 自适应画质换档：在帧首重建，避免半帧换尺寸
    camUpdate();                                         // 相机：远征跟随蛇头（经典模式恒 0）
    mmUpdate(t);                                         // 远征小地图（内部 4~8Hz 节流；经典模式直接返回）
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
    if (!document.hidden && !QFIX) {   // 自适应画质：窗口化漏帧统计（不用帧时均值，免得启动尖峰把均值抬高误降档）；?q= 固定时整段跳过
      if (qPre < Q.warmup) qPre++;
      else {
        qWin++;
        if (raw * 1000 > Q.dropMs) qDrop++;
        if (qWin >= Q.win) {
          const ratio = qDrop / qWin;
          if (ratio >= Q.dropHi && qScale > Q.min && t > qHold) {          // 漏帧多：降一档分辨率
            qScale = Math.max(Q.min, qScale * (ratio > .35 ? .6 : Q.step));   // 严重掉帧直接大步降，尽快进预算
            if (ratio > .35) qFloor = Q.softMin;                              // 保清晰度：softMin=1 ⇒ 这一行不再降分辨率，只保留「严重掉帧时缩短冷却」的行为
            qHold = t + (ratio > .35 ? 800 : 2000);                           // 严重掉帧时缩短冷却，尽快进预算
            qProbe = t + Q.retryMs; qDirty = true;                            // 真正重建放到下一帧开头，避免半帧换尺寸
          } else if (ratio <= Q.dropLo && qScale < 1 && t > qProbe) {      // 几乎不漏帧且过了冷却：试探升回一档
            qScale = Math.min(1, qScale / Q.step); qFloor = 1;              // 有余量先把清晰度地板抬回 1:1
            qHold = t + 2000; qProbe = t + Q.retryMs * 1.5; qDirty = true;
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
    /* 周期闸门的能量帘：关=满高发亮，开=收进地面。用 core 的同一个时钟（S.now），保证「看见的」与「判定的」一致。 */
    if (S.T && Snake.gates) {
      const gn = S.now || t;
      for (const g of Snake.gates.list()) {
        const gx = PX(g.x, g.y), gy = PY(g.x, g.y) + K.HH;
        if (gx < -K.TW || gx > S.W + K.TW || gy < -K.TH * 4 || gy > S.H + K.TH * 4) continue;
        if (!S.T.layerAt(g.x, g.y, 0)) continue;
        const pd = g.period || 4000, u = ((gn + (g.phase || 0)) % pd) / (pd / 2);   // u<1 开、u≥1 关
        const open = u < 1, k2 = open ? u : 2 - u;                                  // k2：开→1…0，关→0…1
        const hh = open ? K.HH * 3.2 * k2 * .16 : K.HH * 3.2;                       // 开启时几乎收平，关闭时满高
        ctx.globalAlpha = open ? .16 + .12 * k2 : .5;
        poly([[gx - K.HW * .72, gy - hh], [gx, gy - hh - K.HH * .5], [gx + K.HW * .72, gy - hh], [gx + K.HW * .72, gy], [gx, gy + K.HH * .5], [gx - K.HW * .72, gy]], '#7FD4FF');
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'lighter';   // 加法通道一次合批：地板反光/光轨/鳞片光晕/辉光精灵，整通道只切一次 composite
    S.pl.forEach((p, i) => { // 蛇映在地板的光（随插值）
      const c = K.rgba(K.SK[S.skin[i]].body[1], .16), arr = PTS[i];
      if (!S.lowFx) for (let j = 0; j < arr.length; j++) diamond(PX(arr[j].x, arr[j].y), PY(arr[j].x, arr[j].y) + K.HH - (arr[j].z || 0), K.HW * 1.3, K.HH * 1.3, c);
      let w = 0; for (let q = 0; q < p.trail.length; q++) { if (now - p.trail[q].b < 500) p.trail[w++] = p.trail[q]; } p.trail.length = w;   // 原地压实：逐帧零分配
      streak(p, now, arr[0]);
      if (!S.lowFx) {   // 鳞片光晕（身体）lowFx 关闭；头部辉光始终保留（Stage 0）
        const col = K.SK[S.skin[i]];
        for (let j = 1; j < arr.length; j++) { const k = Math.max(0, (j - (arr.length - 7)) / 7); halo(arr[j].x, arr[j].y, 8 - 3 * k, col.body[1], arr[j].z || 0); }
      }
      if (!p.dead) glowAt(PX(arr[0].x, arr[0].y), PY(arr[0].x, arr[0].y) + K.HH - 9 - (arr[0].z || 0), 22, p.sprint ? pal.glow : K.SK[S.skin[i]].body[1], .5);
    });
    S.foods.forEach(f => { const sx = PX(f.x, f.y), sy = PY(f.x, f.y) - liftOf(f.x, f.y); diamond(sx, sy + K.HH, K.HW * 1.5, K.HH * 1.5, K.rgba(fg, .18)); glowAt(sx, sy + K.HH, 14 + Math.sin(t / 300) * 4, fg, .4); });   // 食物辉光始终保留（Stage 0）
    if (S.gold) { const sx = PX(S.gold.x, S.gold.y), sy = PY(S.gold.x, S.gold.y) - liftOf(S.gold.x, S.gold.y); diamond(sx, sy + K.HH, K.HW * 1.8, K.HH * 1.8, 'rgba(242,179,61,.22)'); glowAt(sx, sy + K.HH, 18 + Math.sin(t / 200) * 5, '#F2B33D', .55); }   // 金苹果地板光 + 辉光（跟着台面高度走）
    refreshPortals();   // 传送门呼吸光：让「脚下就是门」一眼可见（关卡变了才重算位置）
    for (const q of PORTALS) {
      const qx = PX(q.x, q.y), qy = PY(q.x, q.y) - liftAt(q.x, q.y, q.L);
      if (qx < -K.TW || qx > S.W + K.TW || qy < -K.TH * 4 || qy > S.H + K.TH * 4) continue;   // 视口外不画
      const k2 = .5 + .5 * Math.sin(t / 320 + q.x + q.y);
      diamond(qx, qy + K.HH, K.HW * (.95 + .3 * k2), K.HH * (.95 + .3 * k2), K.rgba('#7FD4FF', .10 + .12 * k2));
      glowAt(qx, qy + K.HH - 4, 16 + 12 * k2, '#7FD4FF', .38);
    }
    paintStationGlow(t);   // 太空站地标：反应堆呼吸核心 + 闸门格警示条（画在实体之后，不会被墙挡掉）
    paintBelts(t);         // 运输带：流动箭头（谁在动、往哪动，一眼看得出）

  /* ---------- 运输带流动箭头（只画关卡数据里声明了 belts 的图） ---------- */
  function paintBelts(t) {
    if (!S.T || !Snake.levelById) return;
    const lv = Snake.levelById(S.levelId), bs = (lv && lv.belts) || [];
    if (!bs.length) return;
    for (const b of bs) {
      const px = PX(b.x, b.y), py = PY(b.x, b.y) + K.HH;
      if (px < -K.TW || px > S.W + K.TW || py < -K.TH * 4 || py > S.H + K.TH * 4) continue;
      const a = .16 + .36 * (((t / 300) + (b.x + b.y) * .17) % 1);                      // 逐格错相 ⇒ 看起来在流动
      diamond(px, py, K.HW * .44, K.HH * .44, K.rgba('#F2B33D', a.toFixed(2)));
      const ox = (b.dx - b.dy) * K.HW * .46, oy = (b.dx + b.dy) * K.HH * .46;           // 等距方向映射
      diamond(px + ox, py + oy, K.HW * .2, K.HH * .2, K.rgba('#FFE7A8', Math.min(1, a * 1.4).toFixed(2)));
    }
  }

  /* ---------- 太空站地标（只对 biome==='station' 生效；加法通道内，调用方已保证 composite=lighter） ---------- */
  function paintStationGlow(t) {
    if (!S.T || !Snake.levelById) return;
    const lv = Snake.levelById(S.levelId);
    if (!lv || lv.biome !== 'station') return;
    const pulse = .5 + .5 * Math.sin(t / 420);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = 15 + dx, y = 15 + dy;                      // station-32 中央反应堆（低台）中心在 (15.5, 15.5)
      const lw = S.T.topWalk(x, y); if (!lw || !lw.h) continue;      // 只给抬高的台面加光：平地不画
      const d = Math.abs(dx + .5) + Math.abs(dy + .5), k = Math.max(0, 1 - d / 4.6);
      const px = PX(x, y), py = PY(x, y) + K.HH - lw.h * BLK;        // 按该格实际台高抬升（h1=9px、h2=18px）
      if (px < -K.TW || px > S.W + K.TW || py < -K.TH * 8 || py > S.H + K.TH * 4) continue;
      diamond(px, py, K.HW * .8, K.HH * .8, K.rgba('#7FD4FF', (.05 + .24 * k * (.55 + .45 * pulse)).toFixed(2)));
      if (k > .5) glowAt(px, py, 13 + 9 * k + 7 * pulse, '#BFF0FF', .16 + .22 * k);
    }
    for (const g of (Snake.gates ? Snake.gates.list() : [])) {   // 闸门格地面警示条
      const gx = PX(g.x, g.y), gy = PY(g.x, g.y) + K.HH;
      if (gx < -K.TW || gx > S.W + K.TW || gy < -K.TH * 4 || gy > S.H + K.TH * 4) continue;
      for (let i = -1; i <= 1; i++) diamond(gx + i * K.HW * .3, gy + i * K.HH * .3, K.HW * .17, K.HH * .17, K.rgba('#F2B33D', .5));
    }
  }
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
    const pushItem = (x, y, i, j, n, head, dead, food, gold, terr, zb, lyr) => { let o = items[ic]; if (!o) o = items[ic] = {}; o.x = x; o.y = y; o.i = i; o.j = j; o.n = n; o.head = head; o.dead = dead; o.food = food; o.gold = gold; o.terr = terr; o.zb = zb; o.lyr = terr ? terr.lyr : (lyr || 0); ic++; };
    if (S.T) {   // 远征：地形块也进同一套深度排序（只画不可走层或 h>0 的层；平地不画块）
      const vb = viewBounds(ITEM_MARGIN);
      for (let y = vb.y0; y <= vb.y1; y++) for (let x = vb.x0; x <= vb.x1; x++) {
        const ls = S.T.at(x, y); if (!ls) continue;
        for (let k = 0; k < ls.length; k++) {
          const l = ls[k];
          if (l.walkable && l.h === 0) continue;
          const sx = PX(x, y), sy = PY(x, y);   // 屏幕外一律不参与 items（等距下方形范围的四角看不见）
          if (sx < -K.TW || sx > S.W + K.TW || sy < -K.TH * 4 || sy > S.H + K.TH * 4) continue;
          pushItem(x, y, 0, 0, 0, false, false, false, false, { h: l.h, lyr: l.h, kind: l.kind, walkable: l.walkable, lower: ls[k - 1] || null }, 0);
        }
      }
    }
    S.pl.forEach((p, i) => PTS[i].forEach((s, j) => pushItem(s.x, s.y, i, j, p.body.length, j === 0, p.dead, false, false, null, s.z || 0, p.body[j] ? (p.body[j].L || 0) : 0)));
    S.foods.forEach(f => pushItem(f.x, f.y, 0, 0, 0, false, false, true, false, null, liftOf(f.x, f.y)));
    if (S.gold) pushItem(S.gold.x, S.gold.y, 0, 0, 0, false, false, false, true, null, liftOf(S.gold.x, S.gold.y));
    items.length = ic;
    items.sort((a, b) => (a.x + a.y) - (b.x + b.y) || (a.lyr || 0) - (b.lyr || 0) || (a.terr ? 0 : 1) - (b.terr ? 0 : 1)); // 画家算法：后→前；同格低层先画、地形先画（规格 §4 深度键：x+y → layer → 类型）
    let occl = false;   // 有高地形挡在蛇头前面：最后补一层半透明轮廓（规格 §4）
    const hd0 = S.pl[0] && S.pl[0].body[0];
    for (const o of items) {
      if (o.terr) {
        if (hd0 && !occl && o.terr.h * BLK > liftAt(hd0.x, hd0.y, hd0.L) + 2 && (o.x + o.y) > (hd0.x + hd0.y) &&
          Math.abs(o.x - hd0.x) + Math.abs(o.y - hd0.y) <= 2) occl = true;
        drawTerr(o); continue;   // 地形块（远征）：墙/高台/桥面，按层高抬升
      }
      const zb = o.zb || 0;                    // 站在高台上的实体整体抬升（经典模式恒 0）
      if (o.gold) {   // 金苹果：金色立方，最后 2s 闪烁告警（游戏时钟，暂停不闪走）；辉光已在加法通道绘
        const remaining = K.TUNE.goldTtl - (S.last - S.gold.born);
        const sx = PX(o.x, o.y), sy = PY(o.x, o.y) - zb;
        ctx.globalAlpha = remaining < 2000 && Math.floor(remaining / 150) % 2 === 0 ? .3 : 1;
        diamond(sx, sy + K.HH, K.HW * .55, K.HH * .55, 'rgba(0,0,0,.25)');
        cube(o.x, o.y, .62, 9, 3 + Math.sin(t / 220) * 3 + zb, GOLD);
        ctx.globalAlpha = 1;
      } else if (o.food) {
        const sx = PX(o.x, o.y), sy = PY(o.x, o.y) - zb;
        diamond(sx, sy + K.HH, K.HW * .5, K.HH * .5, 'rgba(0,0,0,.25)');
        cube(o.x, o.y, .55, 8, 3 + Math.sin(t / 250) * 2.5 + zb, K.MODES[S.mode].players === 2 ? K.FOOD_PK : foodC);
      } else if (o.head) cube(o.x, o.y, .98, 9, zb, o.dead ? K.DEAD : S.pl[o.i].sprint ? K.SPRINT_HEAD : K.SK[S.skin[o.i]].head);
      else { // 身体鳞片：向尾部渐细 + 人字缝（光晕已在加法通道合批绘）
        const k = Math.max(0, (o.j - (o.n - 7)) / 7), s = .92 - .32 * k, hg = 8 - 3 * k, col = K.SK[S.skin[o.i]];
        cube(o.x, o.y, s, hg, zb, col.body);
        seam(S.pl[o.i], o.j, o.x, o.y, s, hg, col.body[2]);
      }
    }
    S.pl.forEach((p, i) => headFx(p, t, i, PTS[i][0], PTS[i]));
    if (occl && S.pl[0]) {   // 被挡住时只补「蛇头 + 前 2 节」的半透明轮廓，不给全蛇描边（规格 §4）
      const p = S.pl[0], pts = PTS[0];
      ctx.globalAlpha = .38;
      for (let j = 0; j < Math.min(3, p.body.length); j++) {
        const q = pts[j] || p.body[j];
        diamond(PX(q.x, q.y), PY(q.x, q.y) + K.HH - (q.z || 0), K.HW * .7, K.HH * .7, 'rgba(232,244,255,.6)');
      }
      ctx.globalAlpha = 1;
    }
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
      const dropPct = qWin ? Math.round(qDrop / qWin * 100) : 0;   // 本决策窗口的漏帧率，便于用户回报「卡不卡」
      const txt = fpsVal + ' fps · ' + (S.frameDt * 1000).toFixed(1) + 'ms · ' + (QFIX ? '画质 固定' + Math.round(QFIX * 100) + '%' : '画质 ' + Math.round(qScale * 100) + '%')
        + ' · 漏帧 ' + dropPct + '%' + (S.lowFx ? ' · lowFx' : '') + (LEGACY_INTERP ? ' · 旧插值' : '') + ' · ' + cv.width + '×' + cv.height
        + (cssW ? ' (×' + (cv.width / cssW).toFixed(2) + ')' : '') + ' · ' + BUILD;   // 括号里是等效倍率：<1 表示已软渲染换流畅
      const k = 1 / cssK, fs = 11 * k, pad = 6 * k;
      // 位置：默认画布左下角（单人沉浸/列式布局那里是空的；左上被罗盘占、右上被能量条占）；PK 沉浸下左下是方向垫，抬到垫子之上
      const yBase = (typeof document !== 'undefined' && document.body.classList.contains('pk') ? 118 : 8) * k;
      const ty = S.H - yBase, bw = txt.length * fs * .62 + pad * 2;
      ctx.font = '600 ' + fs.toFixed(1) + 'px ui-monospace,monospace'; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(pad, ty - fs - pad * .8, bw, fs + pad * 1.8);
      ctx.fillStyle = '#7DD3FC'; ctx.fillText(txt, pad * 2, ty);
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
  const toScreen = (x, y, L) => [PX(x, y), PY(x, y) + K.HH - 6 + (L === undefined ? liftOf(Math.round(x), Math.round(y)) : liftAt(x, y, L))];   // 给粒子层用：带相机与抬升（给了层号就按层，否则按该格最高可走层）
  Snake.Render = { boot, invalidateBoard: () => { boardCache = null; }, refit: applyCanvasSize, ease, segPos, toScreen };
})();