/* core.js —— 游戏规则与状态（唯一真相）
   约束：不碰 DOM / CSS / 音频 / 粒子 / 绘制；对表现层只通过 bus 事件与只读状态 S 通信。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const K = {
    TW: 30, TH: 15,
    HW: 15, HH: 7.5,                     // 半格宽/高：TW/TH 派生常量（去 getter，省逐帧热路径开销）
    OY: 34,
    MODES: {
      easy:   { n: 12, start: 220, min: 120, accel: 3, lives: 3, players: 1, foods: 1 },
      normal: { n: 12, start: 150, min: 70,  accel: 4, lives: 1, players: 1, foods: 1 },
      pk:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3 },
      ai:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3, ai: true },
      /* 3.0 远征：地图尺寸与出生点来自关卡数据（levels.js），视口格数另算（桌面 18 / 窄屏 14） */
      expedition: { n: 24, start: 170, min: 90, accel: 3, lives: 1, players: 1, foods: 1 }
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
    /* 方向键 → 格方向：**一键一方向**（4 个键各自控制一个方向，按下必转，不再「一键两个候选」）。
       等距屏上顺时针一圈：↑ = 右上、→ = 右下、↓ = 左下、← = 左上。
       turn() 会拒绝「与当前/排队方向相同」与「反向掉头」，所以按到自己正在走的方向＝不动、按反向＝不动。 */
    SCREEN: {
      up:    [0, -1],   // 右上
      right: [1, 0],    // 右下
      down:  [0, 1],    // 左下
      left:  [-1, 0]    // 左上
    },
    /* 集中调参表：散在各模块的魔法数收拢于此（平衡性迭代 / 文档 / 测试共用） */
    TUNE: {
      lowFxOn: .032, lowFxOff: .020, lowFxRecover: 120,  // render 帧耗时 EMA：超过 on 降级，低于 off 连续 recover 帧恢复
      comboWindow: 6000, comboBonus: 1,                  // 连击：6s 内持续吃食，第 2 个起每个额外 +1（×2 封顶）
      goldChance: .12, goldTtl: 6000, goldScore: 3, goldEnergy: 30,  // 金苹果：每次吃食后 12% 概率出现，6s 过期，+3 分 +30 能量
      foods3d: 6,   // 3D 双人对战的食物数：层图地图大、可走格多，多给几颗，别让两条蛇死抢同一颗（经典模式仍用 MODES.foods）
      moveLead: 8                                        // 插值起势：移动那一帧把插值时钟提前 8ms（≈半帧），按下后首帧就看得见位移
    }
  };

  /* ---------- 状态（唯一真相，其他模块只读；写入仅经 api） ---------- */
  const S = {
    N: 12, W: 380, H: 240, OX: 190,
    MAP_N: 12, VIEW_N: 12,              // 3.0：地图边长与视口格数分离（经典模式两者相等，行为不变）
    T: null, levelId: '', levelName: '', camCX: 0, camCY: 0,   // 远征：层图 / 关卡 / 相机中心（渲染层只读）
    lowFx: false, frameDt: .016,        // lowFx 由 render 检测并写入
    mode: 'easy', pl: [], foods: [], state: 'ready', msg: '', last: 0,
    best: 0, wins: [0, 0], winner: -1, tickN: 0, overAt: 0, skin: [0, 1], fxGood: 0,
    seed: 0, daily: false,              // 每日挑战：随机种子（0=未播种），daily 标记决定徽章/成绩文案
    gold: null,                         // 金苹果 {x, y, born}，born 以游戏时钟计
    rec: [], myMoves: 0,                // 幽灵录制：p0 每步头格 [x,y,x,y,…] 与已走步数
    ghost: null, ghostMeta: null, ghostOn: false,   // 幽灵回放：破纪录时存档，newGame 时加载
    stats: { games: 0, food: 0, gold: 0 }, resultText: ''   // 本地累计统计 + 结算分享文案
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
  /* mulberry32 种子随机：每日挑战启用。只有"逻辑随机"（食物/金苹果落点）走这里；
     粒子、闪电等视觉随机仍用 Math.random，不消耗种子流，保证同种子同操作 → 同一局 */
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let seedFn = null;
  const rand = n => Math.floor((seedFn ? seedFn() : Math.random()) * n);
  function setSeed(s) { seedFn = s ? mulberry32(s) : null; S.seed = s || 0; }
  const dateSeed = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const dateStr = s => (s >= 19000101 && s <= 99991231) ? ((s / 10000) | 0) + '-' + String(((s / 100) % 100) | 0).padStart(2, '0') + '-' + String(s % 100).padStart(2, '0') : '';   // 仅日期形种子可转日期
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
  /* 地图边长与视口格数分开：经典模式两者相等（三道视觉/行为锁依赖），远征模式视口按屏幕取 18/14 */
  function setSize(mapN, viewN) {
    S.N = S.MAP_N = mapN; S.VIEW_N = viewN;
    S.W = viewN * K.TW + 20; S.H = viewN * K.TH + K.OY + 12; S.OX = S.W / 2;
    bus.emit('resize', { n: viewN });    // render 监听并同步 canvas 尺寸
  }
  /* 视口格数：单人跟相机（手机 14 / 桌面 18）；双人模式地形下走「全景固定」⇒ 直接用整张地图宽度
     （规格 §4：PK 保持全景固定视角，不用跟随相机 ⇒ 用能整张放下的小图 test-24） */
  const viewN = () => {
    if (S.terrain && S.T && K.MODES[S.mode].players === 2) return S.T.w;
    return (typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches) ? 14 : 18;
  };
  /* 3D（地形）开关：与模式正交 —— ?terrain=1 开、?terrain=<关卡 id> 开并选图、?level=<id> 隐含开启；
     ?mode=expedition 是「普通规则 + 地形」的预设（等价于 terrain=1），旧直链继续可用。 */
  const tsOn = () => S.mode === 'expedition' || !!S.terrain;
  /* 关卡：层图由 terrain.js 建好后挂在 S.T 上；3D 关闭时 S.T 为 null ⇒ 走经典棋盘 */
  function loadLevel(id) {
    const lv = Snake.levelById(id) || Snake.LEVELS[0];
    S.T = Snake.Terrain.build(lv); S.levelId = lv.id; S.levelName = lv.name;
  }
  /* 是否阻挡：有层图按层图（Stage 1 只看最高可走层 ⇒ 墙/水挡、高台与桥面可走），否则按棋盘边界 */
  const solid = (x, y) => S.T ? !S.T.hasWalk(x, y) : (x < 0 || y < 0 || x >= S.N || y >= S.N);
  /* 周期闸门（太空站）：层图保持静态，只在这里按相位判「此刻算不算墙」；
     安全闸规则（用户拍板 ①）：相位上该关，但只要还有蛇身/蛇头在门里，就继续开着。 */
  const gateList = () => { const lv = (Snake.levelById && Snake.levelById(S.levelId)) || (Snake.LEVELS || []).find(l => l.id === S.levelId); return (lv && lv.gates) || []; };
  const gateOpen = g => { const pd = g.period || 4000; return ((S.now + (g.phase || 0)) % pd) < pd / 2; };
  const gateBlocked = (x, y) => {
    for (const g of gateList()) {
      if (g.x !== x || g.y !== y || gateOpen(g)) continue;
      for (const p of S.pl) for (const b of p.body) if (b.x === x && b.y === y) return false;   // 门里有人 ⇒ 先别关
      return true;
    }
    return false;
  };
  Snake.gates = { list: gateList, open: gateOpen, blocked: gateBlocked };
  /* 站在传送门层上时的出口（规格 §3.4）：传送门是层图上的双向边，踩上去下一步送到对端，路径允许不连续 */
  function portalEdge(x, y, L) {
    const l = S.T && S.T.layerAt(x, y, L);
    if (!l || l.kind !== 'portal' || !l.portal) return null;
    const pe = S.T.portalTo(x, y, l.portal);
    return pe ? { x: pe.x, y: pe.y, L: pe.L } : null;
  }
  /* 相机：跟随 p0 头部——死区 2 格定出目标，再按指数平滑追上去（不跳格才丝滑）；经典模式固定在地图中心 */
  function camFollow() {
    if (!S.T) { S.camCX = (S.N - 1) / 2; S.camCY = (S.N - 1) / 2; return; }
    const h = S.pl[0] && S.pl[0].body[0]; if (!h) return;
    const half = (S.VIEW_N - 1) / 2, dz = 2;
    const tx = Math.abs(h.x - S.camCX) > dz ? h.x - Math.sign(h.x - S.camCX) * dz : S.camCX;
    const ty = Math.abs(h.y - S.camCY) > dz ? h.y - Math.sign(h.y - S.camCY) * dz : S.camCY;
    const jump = S.pl[0].body[1] && Math.abs(S.pl[0].body[1].x - h.x) + Math.abs(S.pl[0].body[1].y - h.y) > 3;   // 传送门：一帧跨好几格
    const snap = (Snake.hooks && Snake.hooks.noCamSmooth) || jump;           // 系统「减弱动态」或传送：直接贴到目标，不做缓动（否则像画面被拽走）
    const dt = S.frameDt > 0 ? S.frameDt : 1 / 60;
    const k = snap ? 1 : 1 - Math.pow(.0009, dt);                            // 时间常数 ~0.14s，与帧率无关
    S.camCX += (tx - S.camCX) * k; S.camCY += (ty - S.camCY) * k;
    S.camCX = Math.max(half, Math.min(S.N - 1 - half, S.camCX));
    S.camCY = Math.max(half, Math.min(S.N - 1 - half, S.camCY));
  }
  /* 经典模式沿用 2.0 的榜/存档键（不动老数据）；开了 3D 按规格 §3.7 用 iso-snake-3: 前缀，
     并把模式与关卡 id 都写进键里（同一关卡在不同模式下的成绩分开记） */
  const bestKey = () => S.T ? 'iso-snake-3:best-' + S.mode + '-' + S.levelId : 'iso-snake-best2-' + S.mode;
  const ghostKey = () => S.T ? 'iso-snake-3:ghost-' + S.mode + '-' + S.levelId : 'iso-snake-ghost-' + S.mode;
  function loadBest() { S.best = +safeGet(bestKey(), 0) || 0; }
  /* 本地统计（累计局数/食物/金苹果），持久化于 iso-snake-stats */
  function loadStats() { try { const o = JSON.parse(safeGet('iso-snake-stats', '{}')); S.stats = { games: +o.games || 0, food: +o.food || 0, gold: +o.gold || 0 }; } catch (e) {} }
  function persistStats() { safeSet('iso-snake-stats', JSON.stringify(S.stats)); }
  /* 幽灵回放：破纪录时把整条路径存档；newGame 时加载当前模式的存档 */
  function loadGhost() {
    try {
      const g = JSON.parse(safeGet(ghostKey(), 'null'));
      S.ghost = g && Array.isArray(g.path) && g.path.length >= 4 ? g.path : null;
      S.ghostMeta = S.ghost ? { score: g.score | 0, date: g.ts ? new Date(g.ts).toLocaleDateString() : '' } : null;
    } catch (e) { S.ghost = null; S.ghostMeta = null; }
  }
  function saveGhost(p) { if (S.rec.length >= 4) safeSet(ghostKey(), JSON.stringify({ score: p.score, ts: Date.now(), path: S.rec })); }
  /* 结算分享文案（复制成绩按钮用） */
  const MODE_NAME = { easy: '简单', normal: '普通', pk: '双人对战', ai: '人机对战', expedition: '远征' };
  const URL_HOME = 'https://kkkk16689.github.io/isometric-snake/';
  function buildResultText() {
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0], ds = dateStr(S.seed);
      return S.daily
        ? '等距贪吃蛇 2.0 · 每日挑战' + (ds ? ' ' + ds : '') + '（种子 ' + S.seed + '）：得分 ' + p.score + '，长度 ' + p.body.length + '。来战：' + URL_HOME + '?daily=1'
        : '等距贪吃蛇 2.0 · ' + MODE_NAME[S.mode] + '：得分 ' + p.score + '，长度 ' + p.body.length + '。来战：' + URL_HOME;
    }
    return '等距贪吃蛇 2.0 · ' + MODE_NAME[S.mode] + '：' + (S.winner >= 0 ? nm(S.winner) + ' 胜' : '平局') + '（' + S.pl.map(p => p.score).join(' : ') + '）。来战：' + URL_HOME;
  }
  function spawn(i, p) {
    const two = K.MODES[S.mode].players === 2;
    let dir;
    if (S.T) {   // 远征：出生点与朝向来自关卡数据，蛇身沿反方向铺 3 格（关卡校验保证前方有 3 格跑道）
      const s = S.T.spawns[Math.min(i, S.T.spawns.length - 1)];
      dir = K.DIRS[s.dir] || K.DIRS.downRight;
      p.body = [0, 1, 2].map(k => {   // 每节带层高 L（规格 §3.2：碰撞/吃食/占位只比同 (x,y,L)）
        const bx = s.x - dir[0] * k, by = s.y - dir[1] * k;
        const tw = S.T.topWalk(bx, by);
        return { x: bx, y: by, L: tw ? tw.h : 0 };
      });
    } else {     // 经典：出生点与朝向保持 2.0 原样（行为锁/视觉锁依赖它）；L 恒 0
      const y = two ? (i ? S.N - 5 : 4) : 6, xs = two ? (i ? [S.N - 5, S.N - 4, S.N - 3] : [4, 3, 2]) : [3, 2, 1];
      p.body = xs.map(x => ({ x, y, L: 0 })); dir = i ? K.DIRS.upLeft : K.DIRS.downRight;
    }
    p.dir = dir; p.queue = []; p.dead = false;
    p.moveT = 0; p.moveTGame = 0; p.moveP = 300; p.grew = false; p.tailFrom = null; p.streakAt = 0;  // 插值/连击时钟复位
  }
  /* 可放格列表（食物/金苹果共用）
     远征：每格取「最高可走层」（规格 §3.5：桥下地面不生成，避免看不见却吃得到），并只保留从 p0 头所在层
     可达的节点——层图 BFS 一次算完；经典：x*1024+y 原语义，L 恒 0（行为锁依赖原语义）。 */
  function freeCells() {
    const taken = new Set();
    const tk = s => S.T ? S.T.key(s.x, s.y, s.L || 0) : (s.x * 1024 + s.y);
    S.pl.forEach(p => p.body.forEach(s => taken.add(tk(s))));
    S.foods.forEach(f => taken.add(tk(f)));
    if (S.gold) taken.add(tk(S.gold));   // 金苹果占位：补充食物不得与其重叠
    let reach = null;
    if (S.T) {
      const h = S.pl[0] && S.pl[0].body[0];
      reach = h ? S.T.reachable(h.x, h.y, h.L || 0) : null;   // §3.5：不可达的层不生成
    }
    const free = [];
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
      if (S.T) {
        const tw = S.T.topWalk(x, y); if (!tw) continue;
        const k = S.T.key(x, y, tw.h);
        if (reach && !reach.has(k)) continue;
        if (!taken.has(k)) free.push({ x, y, L: tw.h });
      } else if (!taken.has(x * 1024 + y)) free.push({ x, y, L: 0 });
    }
    return free;
  }
  function fillFoods() { // 空格列表取样（拒绝采样在长局会退化，满盘时无解）；无处可放 → 满盘结算
    const want = (S.T && K.MODES[S.mode].players === 2) ? K.TUNE.foods3d : K.MODES[S.mode].foods;   // 3D 双人对战多给食物，减少「抢同一颗」的迎头撞
    if (S.foods.length >= want) return;
    const free = freeCells();
    while (S.foods.length < want) {
      if (!free.length) { boardFull(); return; }
      const k = rand(free.length);
      S.foods.push(free[k]); free.splice(k, 1);
    }
  }
  function spawnGold(now) {   // 金苹果落在任意空格（与蛇身/普通食物互斥）
    const free = freeCells();
    if (!free.length) return;
    const c = free[rand(free.length)];
    S.gold = { x: c.x, y: c.y, L: c.L, born: now };
    bus.emit('goldSpawn', { x: c.x, y: c.y, L: c.L });
  }
  function boardFull() { // 棋盘被蛇填满：单人视为获胜，双人判平局
    S.state = 'over'; S.overAt = performance.now();
    S.stats.games++; persistStats();
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0]; S.msg = '棋盘填满 · ' + p.score + ' 分';
      if (p.score > S.best) { S.best = p.score; safeSet(bestKey(), S.best); saveGhost(p); }
      bus.emit('win', { winner: 0, full: true });
    } else {
      S.winner = -1; S.msg = '棋盘填满 · 平局';
      bus.emit('win', { winner: -1, full: true });
    }
    S.resultText = buildResultText();
    bus.emit('hud');
  }
  function newGame() {
    const m = K.MODES[S.mode];
    if (tsOn()) { if (!S.T) loadLevel(S.levelId || 'test-24'); setSize(S.T.w, viewN()); }   // 3D：按关卡建层图，视口按模式定
    else { S.T = null; setSize(m.n, m.n); }   // 未开 3D：清掉层图、视口=棋盘（2.0 行为与视觉都不变）
    if (S.daily && S.seed) setSeed(S.seed);   // 每日挑战重开：随机流复位到同一种子（同种子同局）
    S.tickN = 0; S.lowFx = false; S.frameDt = .016; S.fxGood = 0;
    S.pl = [...Array(m.players)].map((_, i) => {
      const p = { score: 0, lives: m.lives, energy: 100, locked: false, hold: false, sprint: false, trail: [], streak: 0, ai: !!m.ai && i === 1,
                  moveT: 0, moveP: 300, grew: false, tailFrom: null, streakAt: 0 };  // moveT/moveP：渲染插值时钟；grew/tailFrom：尾格来源
      spawn(i, p); return p;
    });
    S.gold = null; S.rec = []; S.myMoves = 0;   // 内容态复位须在 fillFoods 前：金苹果占位参与空格取样，否则重开随机流与全新实例错位
    S.foods = []; fillFoods(); S.state = 'ready'; S.msg = ''; S.winner = -1;
    loadGhost();   // 幽灵存档随新一局重载
    camFollow();   // 相机起点（经典＝地图中心 ⇒ 渲染偏移恒 0）
    bus.emit('hud'); bus.emit('gameStart');
  }
  function turn(p, d) {
    const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    if (d[0] === ref[0] && d[1] === ref[1]) return;
    if (d[0] + ref[0] === 0 && d[1] + ref[1] === 0) return;
    if (p.queue.length < 2) p.queue.push(d);
  }
  function steer(p, name) {           // 一键一方向：直接交给 turn()（它负责忽略「同向」与「反向」）
    const d = K.SCREEN[name];
    if (d) turn(p, d);
  }
  function step(now) {   // now = 游戏时钟（S.last），与 rAF 的 t 同基准，供插值/连击
    S.tickN++;
    S.pl.forEach(p => { if (p.streak > 0 && now - p.streakAt > K.TUNE.comboWindow) p.streak = 0; });   // 连击超时衰减
    if (S.gold && now - S.gold.born > K.TUNE.goldTtl) S.gold = null;   // 金苹果过期（游戏时钟，暂停不计时）
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
    const hs = S.pl.map((p, i) => {
      if (!mv[i]) return null;
      if (p.queue.length) p.dir = p.queue.shift();
      const h0 = p.body[0], L0 = h0.L || 0;
      if (!S.T) return { x: h0.x + p.dir[0], y: h0.y + p.dir[1], L: 0, bad: solid(h0.x + p.dir[0], h0.y + p.dir[1]) };
      const pe = p.portCool ? null : portalEdge(h0.x, h0.y, L0);   // §3.4：踩在传送门上 → 本步走传送门边
      if (pe) { p.portCool = true; bus.emit('port', { x: h0.x, y: h0.y, L: L0, tx: pe.x, ty: pe.y, tL: pe.L || 0, i }); return pe; }   // 两端都要有光效，别让人「莫名其妙被传走」
      p.portCool = false;                                         // 刚从传送门出来那一拍不许再传：否则会在两端来回弹、身体叠在自己头上把自己撞死（用户反馈「一到传送门就死」）
      const nx = h0.x + p.dir[0], ny = h0.y + p.dir[1], pk = S.T.pick(nx, ny, L0);   // §3.3：按层选落点
      if (!pk) return { x: nx, y: ny, L: L0, bad: true };          // 墙 / 水 / 悬崖（最小高差 > 1）
      if (gateBlocked(nx, ny)) return { x: nx, y: ny, L: L0, bad: true };   // 闸门此刻是关的 ⇒ 按墙处理（冰面/闸门互斥，顺序无所谓）
      if (pk.layer && pk.layer.kind === 'ice') {                    // 冰面：一步可能滑多格（§5 的 transition 表）
        if (p.ai) return { x: nx, y: ny, L: L0, bad: true };         // §5 门控：AI 会用滑行表之前一律不踩冰
        const slideFn = S.T.slide || (Snake.Terrain && Snake.Terrain.slide);   // 滑行表是 terrain 的模块级导出（不在层图对象上）
        const sl = slideFn(S.T, h0.x, h0.y, L0, [p.dir[0], p.dir[1]], 64);
        const last = sl.path[sl.path.length - 1];
        if (last) { bus.emit('slide', { x: last.x, y: last.y, L: last.L, i }); return { x: last.x, y: last.y, L: last.L, bad: false, slide: sl.path }; }
      }
      return { x: nx, y: ny, L: pk.h };
    });
    const onFood = (x, y, L) => S.foods.findIndex(f => f.x === x && f.y === y && (f.L || 0) === (L || 0));
    const eat = hs.map(h => {                        // 冰面滑行：途经格上的食物也算吃掉（§5 逐格处理）
      if (!h) return -1;
      if (h.slide) for (const s of h.slide) { const k = onFood(s.x, s.y, s.L); if (k >= 0) return k; }
      return onFood(h.x, h.y, h.L);
    });
    const hit = hs.map((h, i) => {
      if (!h) return false;
      if (h.bad) return true;                                      // 撞墙/水/悬崖
      const L = h.L || 0;
      if (hs.some((o, j) => j !== i && o && !o.bad && o.x === h.x && o.y === h.y && (o.L || 0) === L)) return true;  // 对头相撞（同层才算）
      return S.pl.some((q, j) => (mv[j] && eat[j] < 0 ? q.body.slice(0, -1) : q.body).some(s => s.x === h.x && s.y === h.y && (s.L || 0) === L));
    });
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0];
      if (hit[0]) {
        p.lives--; p.streak = 0;
        if (p.lives > 0) { bus.emit('crash', { heads: [hs[0]], partial: true }); spawn(0, p); S.state = 'paused'; S.msg = '撞到了！还剩 ' + p.lives + ' 条命'; bus.emit('hud'); }
        else gameOver();
        return;
      }
    } else if (hit.some(Boolean)) { hit.forEach((h, i) => S.pl[i].dead = h); gameOver(); return; }
    S.pl.forEach((p, i) => {
      if (!hs[i]) return;
      if (p.sprint) { p.trail.push({ x: p.body[0].x, y: p.body[0].y, L: p.body[0].L || 0, b: performance.now() }); if (p.trail.length > 14) p.trail.shift(); }
      p.body.unshift(hs[i]);
      if (eat[i] >= 0) {
        if (now - p.streakAt > K.TUNE.comboWindow) p.streak = 0;
        p.streak++; p.streakAt = now;
        const gain = 1 + (p.streak >= 2 ? K.TUNE.comboBonus : 0);   // 连击中每个食物 +2（×2 封顶）
        p.score += gain; if (!p.ai) S.stats.food++;   // 统计只记人类玩家（ai 模式对手蛇不计入）
        bus.emit('eat', { x: S.foods[eat[i]].x, y: S.foods[eat[i]].y, pk: K.MODES[S.mode].players === 2, streak: p.streak, pts: gain, i });
      }
      else p.tailFrom = p.body.pop();
      p.grew = eat[i] >= 0; p.moveT = S.now > 0 ? S.now - K.TUNE.moveLead : now; p.moveTGame = now; p.moveP = p.sprint ? tickMs() : tickMs() * 2;   // 冲刺每 tick 动，平时隔 tick；moveT 用渲染时钟并提前 moveLead 起势，moveTGame 留作 ?interp=legacy 对比
      if (i === 0) {                                     // 幽灵录制：只记 p0（单人远征只有一条蛇）
        const slz = hs[i] && hs[i].slide;
        if (slz) for (const s of slz) { S.rec.push(s.x, s.y); S.myMoves++; }   // 冰面滑行：途经格逐格进录像，回放才不会少一截
        S.rec.push(hs[i].x, hs[i].y); S.myMoves++;
      }
    });
    if (S.gold) {   // 金苹果拾取：+3 分 +30 能量，不增长、不影响连击（两蛇同 tick 踩上则先手判给 p0）
      const gi = hs.findIndex(h => h && !h.bad && h.x === S.gold.x && h.y === S.gold.y && (h.L || 0) === (S.gold.L || 0));
      if (gi >= 0) {
        const p = S.pl[gi];
        p.score += K.TUNE.goldScore; if (!p.ai) S.stats.gold++;
        p.energy = Math.min(100, p.energy + K.TUNE.goldEnergy);
        if (p.locked && p.energy >= 30) p.locked = false;
        bus.emit('eat', { x: S.gold.x, y: S.gold.y, pk: K.MODES[S.mode].players === 2, gold: true, pts: K.TUNE.goldScore, streak: p.streak, i: gi });
        S.gold = null;
      }
    }
    const eaten = new Set(eat.filter(k => k >= 0));
    S.foods = S.foods.filter((_, k) => !eaten.has(k)); fillFoods();
    if (eaten.size && !S.gold && rand(1000) < K.TUNE.goldChance * 1000) spawnGold(now);   // 每次真正吃到食物后掷金苹果
    bus.emit('hud');
  }
  function gameOver() {
    S.state = 'over'; S.overAt = performance.now();
    S.stats.games++; persistStats();
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0]; p.dead = true;
      if (p.score > S.best) { S.best = p.score; safeSet(bestKey(), S.best); saveGhost(p); }   // 破纪录：最高分 + 幽灵存档一起刷新
      bus.emit('lose', { i: 0 });
    } else {
      const alive = S.pl.map((p, i) => p.dead ? -1 : i).filter(i => i >= 0);
      S.winner = alive.length === 1 ? alive[0] : -1;
      if (S.winner >= 0) S.wins[S.winner]++;
      bus.emit('win', { winner: S.winner });
    }
    S.resultText = buildResultText();
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
  function setMode(m) {
    S.mode = m; S.wins = [0, 0]; S.daily = false; setSeed(0);
    if (tsOn()) loadLevel(S.levelId || 'test-24'); else S.T = null;   // 开了 3D 就建层图，回经典就清掉
    loadBest(); newGame(); bus.emit('hud');
  }
  function setSkin(p, k) { S.skin[p] = k; bus.emit('hud'); }
  /* 每日挑战：固定普通模式 + 当日/自定义种子，食物序列可复现 */
  function startDaily(seed) {
    S.mode = 'normal'; S.wins = [0, 0]; S.daily = true;
    setSeed(seed || dateSeed());
    loadBest(); newGame(); bus.emit('hud');
  }
  function setGhostOn(v) { S.ghostOn = !!v; safeSet('iso-snake-ghost-on', S.ghostOn ? '1' : '0'); }
  /* render 每帧调用：追赶式 tick（帧率无关）。掉帧后最多补 1 步，其余积压直接丢弃——
     补跑多步会让蛇在一帧里连跳好几格（用户明确要求「不卡、没有瞬移」），宁可让节奏短暂放慢。 */
  function update(t) {
    S.now = t;   // 渲染时钟：插值起点改用实测帧时间（S.last 是游戏时钟，可能落后最多一个 tick ⇒ 每格起点最多偏半格，看着一顿一顿）
    if (S.state === 'playing') {
      let n = 0;
      while (S.state === 'playing' && t - S.last >= tickMs() && n++ < 1) { S.last += tickMs(); step(S.last); }
      if (t - S.last > tickMs()) S.last = t;   // 还有积压（大卡顿 / 切后台回来）：对齐当前时刻，不补跑
    }
    camFollow();   // 相机跟随（纯数学、无 DOM；渲染层逐帧只读 S.camCX/camCY）
  }

  const qs = new URLSearchParams(location.search);   // 便于截图/直链分享（?theme= ?mode= ?daily=1 ?seed=N），mode 仅初始值
  if (qs.get('mode') && K.MODES[qs.get('mode')]) S.mode = qs.get('mode');
  if (qs.get('daily') || qs.get('seed')) {   // ?daily=1 今日种子；?seed=N 自定义种子（均按每日挑战处理，固定普通模式）
    S.mode = 'normal'; S.daily = true;
    setSeed((+qs.get('seed') | 0) || dateSeed());
  }
  S.terrain = false;   // 3D（地形）开关，默认关：只有 URL 明确要求时才开，经典直链行为不变
  const tv = qs.get('terrain');
  if (tv !== null && tv !== '0') { S.terrain = true; if (tv !== '1') S.levelId = tv; }   // ?terrain=1 / ?terrain=harbor-32
  if (qs.get('level')) { S.levelId = qs.get('level'); S.terrain = true; }                 // ?level=<id> 隐含开启
  if (S.mode === 'expedition') S.terrain = true;                                          // 远征＝普通规则 + 地形的预设
  // ?mode=ai&terrain=1&level=test-24 直达：这里只记模式/开关/关卡 id，层图留到 newGame 再建
  // （core.js 是最先执行的脚本，此刻 levels.js / terrain.js 还没加载，不能在这里调 loadLevel）
  loadStats();
  S.ghostOn = safeGet('iso-snake-ghost-on', '0') === '1';

  /* 2.0：存储键统一 iso-snake-* 前缀——旧 snake.* 偏好一次性迁移（旧键保留不删，便于回滚）。
     必须在各表现层模块 init() 读键之前跑；core.js 最先加载，天然满足。 */
  for (const [o, n] of [['snake.theme', 'iso-snake-theme'], ['snake.snd', 'iso-snake-snd'], ['snake.music', 'iso-snake-music'], ['snake.sprint', 'iso-snake-sprint']]) {
    if (safeGet(n, null) === null) { const v = safeGet(o, null); if (v !== null) safeSet(n, v); }
  }

  /* 工具注册进 K 供各表现层模块使用（内部仍用裸名） */
  K.rand = rand; K.safeGet = safeGet; K.safeSet = safeSet; K.nm = nm;
  K.P = P; K.fr = fr; K.rgba = rgba; K.shades = shades;
  K.dateSeed = dateSeed; K.dateStr = dateStr; K.setSeed = setSeed; K.MODE_NAME = MODE_NAME;

  Snake.K = K; Snake.S = S; Snake.bus = bus;
  Snake.hooks = { think: null };
  /* 远征入口：Stage 1 先用 URL / api 直达（工具栏不加控件，见 Stage 1 简报 Q3） */
  function startExpedition(id) {
    S.mode = 'expedition'; S.wins = [0, 0]; S.daily = false; setSeed(0);
    loadLevel(id || S.levelId || 'test-24'); loadBest(); newGame(); bus.emit('hud');
  }
  function setTerrain(on, id) {   // 地形（3D）与模式正交，任何模式都能开关（用户要求：既保留原版、也能随时切升级版）
    S.terrain = !!on;
    if (id) S.levelId = id;
    if (S.terrain) { if (!S.T) loadLevel(S.levelId || 'test-24'); } else S.T = null;
    S.wins = [0, 0]; loadBest(); newGame(); bus.emit('hud');
  }
  Snake.api = { newGame, reset: () => { loadBest(); newGame(); }, start, togglePause, press, setHold, setMode, setSkin, startDaily, setGhostOn, startExpedition, loadLevel, setTerrain, update };
})();