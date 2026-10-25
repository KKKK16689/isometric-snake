/* test/core.test.mjs —— 无头核心逻辑测试（node --test，零依赖）
   用 vm 加载 src/js/core.js（按需加 ai.js），桩掉最小浏览器环境：
   window / localStorage / location / URLSearchParams / performance / matchMedia / document。
   时间由 sandbox.__t 手动推进；stepOnce() 精确推进一个 tick（小步增量，避免一次补多步）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  core: readFileSync(join(ROOT, 'src/js/core.js'), 'utf8'),
  ai: readFileSync(join(ROOT, 'src/js/ai.js'), 'utf8'),
  levels: readFileSync(join(ROOT, 'src/js/levels.js'), 'utf8'),
  terrain: readFileSync(join(ROOT, 'src/js/terrain.js'), 'utf8'),
};

function load(search = '', withAi = false, withMap = false) {
  const store = new Map();
  const sandbox = {
    console, URLSearchParams,
    location: { search },
    document: { hidden: false },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    performance: { now: () => sandbox.__t },
    __t: 0, store,
  };
  sandbox.window = sandbox;
  let _rs = 20261025;   // 确定性 LCG：AI 误差随机与食物落点在整局 soak 中可复现（免得随机失败）
  sandbox.Math = Object.create(Math);
  sandbox.Math.random = () => { _rs = (_rs * 1103515245 + 12345) % 2147483648; return _rs / 2147483648; };
  vm.createContext(sandbox);
  if (withMap) {   // 远征测试：层图与关卡数据必须在 core 之前就位（core 启动时可能就按 URL 建层图）
    vm.runInContext(SRC.terrain, sandbox, { filename: 'terrain.js' });
    vm.runInContext(SRC.levels, sandbox, { filename: 'levels.js' });
  }
  vm.runInContext(SRC.core, sandbox, { filename: 'core.js' });
  if (withAi) {   // 无头：跳过 ai.init() 的 DOM 绑定，直接挂 think
    vm.runInContext(SRC.ai, sandbox, { filename: 'ai.js' });
    sandbox.Snake.hooks.think = sandbox.Snake.Ai.think;
  }
  return sandbox;
}
function stepOnce(sb) {   // 精确推进 1 tick：增量 10ms < 最小 tickMs，保证 while 循环只补一步
  const before = sb.Snake.S.tickN;
  for (let g = 0; g < 60; g++) { sb.__t += 10; sb.Snake.api.update(sb.__t); if (sb.Snake.S.tickN > before) return true; }
  return false;
}
function moveOnce(sb, p) {   // 推进到 p 真正移动一格（平时隔 tick 才动）或状态改变为止
  const h0 = p.body[0], st0 = sb.Snake.S.state;
  for (let g = 0; g < 4; g++) { stepOnce(sb); if (sb.Snake.S.state !== st0 || p.body[0] !== h0) return; }
}
const ahead = (p, d) => { const q = d || p.dir; return { x: p.body[0].x + q[0], y: p.body[0].y + q[1] }; };
const eq = (a, x, y) => a && a[0] === x && a[1] === y;   // 跨 vm 边界不用 deepStrictEqual（原型不同域）
const NAMES = ['up', 'down', 'left', 'right'];

test('转向队列：最多存 2 个待执行转向，180° 掉头被拒绝', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('normal'); Snake.api.start();
  const p = Snake.S.pl[0];
  assert.ok(eq(p.dir, 1, 0), 'single-player initial dir downRight [1,0]');
  Snake.api.press(0, 'left');                                 // 等距屏上 left → 候选 [upLeft, downLeft]，steer 挑能转的
  Snake.api.press(0, 'up');
  Snake.api.press(0, 'right');
  assert.ok(p.queue.length <= 2, 'queue capped at 2, got ' + p.queue.length);
  p.queue = []; p.dir = [1, 0];
  Snake.api.press(0, 'left');                                 // left＝左上，正好是「右下」的反向 ⇒ 必须被忽略（不许掉头）
  assert.equal(p.queue.length, 0, '180° 反向键必须被忽略，实际入队 ' + JSON.stringify(p.queue));
  Snake.api.press(0, 'down');                                 // down＝左下，与「右下」垂直 ⇒ 正常入队（正向对照）
  assert.ok(eq(p.queue[0], 0, 1), '垂直方向键应当入队，实际 ' + JSON.stringify(p.queue[0]));
});

test('吃食：增长 + 计分 + 窗口内连击额外 +1', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('normal'); Snake.api.start();
  const S = Snake.S, p = S.pl[0], len0 = p.body.length;
  for (let k = 0; k < 2; k++) { S.foods[0] = ahead(p); moveOnce(sb, p); }
  assert.equal(p.score, 3);                                   // 1 + 2（连击第 2 个起 +1）
  assert.equal(p.body.length, len0 + 2);
  assert.equal(p.streak, 2);
});

test('连击窗口过期：超 6s 未进食，连击归零且不再加分', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('normal'); Snake.api.start();
  const S = Snake.S, p = S.pl[0];
  let lastEat = null; Snake.bus.on('eat', e => { lastEat = e; });   // S 不存 eat 明细，从总线捕获
  S.foods[0] = ahead(p); moveOnce(sb, p);                     // 第 1 个：+1，streak=1
  assert.equal(p.score, 1);
  p.streakAt -= 7000;                                         // 时钟回拨 7s ≡ 超过 6s 窗口（确定性）
  stepOnce(sb);                                               // step 顶部做连击衰减
  assert.equal(p.streak, 0, 'streak should decay after window');
  S.foods[0] = ahead(p); moveOnce(sb, p);                     // 窗口外再吃
  assert.equal(p.streak, 1);
  assert.equal(lastEat.pts, 1, 'no combo bonus after window');
  assert.equal(p.score, 2);                                   // 1 + 1（无连击加成）
});

test('简单模式撞墙：扣一条命、重生并暂停提示', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('easy'); Snake.api.start();
  const S = Snake.S, p = S.pl[0];
  S.foods.length = 0;
  let guard = 0;
  while (S.state === 'playing' && guard++ < 600) stepOnce(sb);
  assert.equal(S.state, 'paused');
  assert.equal(p.lives, 2);
  assert.match(S.msg, /还剩 2 条命/);
});

test('尾格安全：头走进当前尾格（同 tick 让位）不判撞', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('normal'); Snake.api.start();
  const S = Snake.S, p = S.pl[0];
  p.body = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }];
  p.dir = [0, 1]; p.queue = [];
  S.foods = [{ x: 11, y: 11 }];
  moveOnce(sb, p);                                            // 头 (5,5)→(5,6) 正是当前尾格
  assert.equal(S.state, 'playing');
  assert.ok(p.body[0].x === 5 && p.body[0].y === 6, 'head should occupy vacated tail cell');
});

test('双人对撞同格：平局收场', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('pk'); Snake.api.start();
  const S = Snake.S;
  S.pl[0].body = [{ x: 5, y: 5 }, { x: 4, y: 5 }]; S.pl[0].dir = [1, 0]; S.pl[0].queue = [];
  S.pl[1].body = [{ x: 7, y: 5 }, { x: 8, y: 5 }]; S.pl[1].dir = [-1, 0]; S.pl[1].queue = []; S.pl[1].ai = false;
  S.foods = [{ x: 0, y: 0 }];
  moveOnce(sb, S.pl[0]);
  assert.equal(S.state, 'over');
  assert.equal(S.winner, -1);
});

test('食物永不刷在蛇身上（400 tick 不变量）', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('easy'); Snake.api.start();              // 3 条命撑得久一点
  const S = Snake.S;
  for (let k = 0; k < 400 && S.state === 'playing'; k++) {
    if (k % 7 === 3) Snake.api.press(0, NAMES[(Math.random() * 4) | 0]);
    stepOnce(sb);
    const occ = new Set();
    S.pl.forEach(p => p.body.forEach(s => occ.add(s.x * 1024 + s.y)));
    S.foods.forEach(f => assert.ok(!occ.has(f.x * 1024 + f.y), 'food spawned on snake at ' + f.x + ',' + f.y));
  }
});

test('棋盘填满：判胜并给出提示文案', () => {
  const sb = load(); const { Snake } = sb;
  Snake.api.setMode('normal'); Snake.api.start();
  const S = Snake.S, p = S.pl[0], N = S.N;
  const cells = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!(x === 0 && y === 0) && !(x === 1 && y === 0)) cells.push({ x, y });
  p.body = [{ x: 1, y: 0 }, ...cells];                        // 头 (1,0) 朝 [-1,0]，其余 143 格全被身体占据
  p.dir = [-1, 0]; p.queue = [];
  S.foods = [{ x: 0, y: 0 }];
  moveOnce(sb, p);                                            // 吃下最后一格 → 144 格全满
  assert.equal(S.state, 'over');
  assert.match(S.msg, /棋盘填满/);
});

test('种子确定性：同种子首食物相同，异种子不同', () => {
  const first = s => { const sb = load('?seed=' + s); sb.Snake.api.reset(); sb.Snake.api.start(); return sb.Snake.S.foods.map(f => f.x + ',' + f.y).join(';'); };
  assert.equal(first(777), first(777));
  assert.ok(new Set([first(1), first(2), first(3), first(4), first(5)]).size >= 2);
});

test('困难 AI 对随机策略胜率 ≥ 85%（200 局人机）', () => {
  const sb = load('', true); const { Snake } = sb;
  Snake.Ai.setLevel(2);
  let ai = 0, rnd = 0, other = 0;
  for (let g = 0; g < 200; g++) {
    Snake.api.setMode('ai'); Snake.api.start();
    const S = Snake.S, t0 = S.tickN;
    while (S.state === 'playing' && S.tickN - t0 < 3000) {
      Snake.api.press(0, NAMES[(Math.random() * 4) | 0]);    // P0 随机乱按
      stepOnce(sb);
    }
    if (S.winner === 1) ai++; else if (S.winner === 0) rnd++; else other++;
  }
  const decided = ai + rnd;
  assert.ok(decided > 150, 'most games should reach a decision, got ' + decided);
  assert.ok(ai / decided >= .85, 'hard AI win rate ' + (100 * ai / decided).toFixed(1) + '% < 85% (ai=' + ai + ' rnd=' + rnd + ' draw=' + other + ')');
});

test('随机 fuzz：四种模式混合操作下的核心不变量', () => {
  const sb = load('', true); const { Snake } = sb;
  Snake.Ai.setLevel(2);
  for (const mode of ['easy', 'normal', 'pk', 'ai']) {
    Snake.api.setMode(mode); Snake.api.start();
    const S = Snake.S;
    for (let k = 0; k < 1500 && S.state !== 'over'; k++) {
      if (k % 3 === 0) Snake.api.press(0, NAMES[(Math.random() * 4) | 0]);
      if (k % 5 === 2 && S.pl[1] && !S.pl[1].ai) Snake.api.press(1, NAMES[(Math.random() * 4) | 0]);
      if (k % 7 === 1) Snake.api.setHold(0, Math.random() < .5);   // 冲刺随机开关
      stepOnce(sb);
      if (S.state === 'paused') { Snake.api.togglePause(); continue; }   // easy 掉命暂停 → 继续
      const occ = new Set();
      for (const p of S.pl) for (const s of p.body) {
        assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y) && s.x >= 0 && s.x < S.N && s.y >= 0 && s.y < S.N,
          mode + ': 身体坐标越界/非整数 ' + s.x + ',' + s.y);
        occ.add(s.x * 1024 + s.y);
      }
      for (const f of S.foods) assert.ok(!occ.has(f.x * 1024 + f.y), mode + ': 食物压在蛇身上');
      if (S.gold) {
        assert.ok(!occ.has(S.gold.x * 1024 + S.gold.y), mode + ': 金苹果压在蛇身上');
        for (const f of S.foods) assert.ok(!(f.x === S.gold.x && f.y === S.gold.y), mode + ': 金苹果与食物重叠');
      }
      assert.equal(S.rec.length, 2 * S.myMoves, mode + ': 幽灵录制与步数失步');
      assert.ok(S.pl.every(p => p.score >= 0 && p.energy >= 0 && p.energy <= 100), mode + ': 分数/能量越界');
    }
  }
});

/* ---------- 长局 soak：四模式双 AI 自走（高分局）——速度模型/食物唯一性/身体唯一性全程成立 ---------- */
test('长局 soak：四模式双 AI 自走，移动节奏不越界、食物与身体唯一', () => {
  const sb = load('', true); const { Snake } = sb;
  Snake.Ai.setLevel(2);
  for (const mode of ['easy', 'normal', 'pk', 'ai']) {
    Snake.api.setMode(mode); Snake.api.start();
    const S = Snake.S;
    S.pl.forEach(p => { p.ai = true; });   // 连单人模式也交给困难 AI 自走，soak 才有高分局（速度上限、金苹果轮换、填盘边缘）
    let ticks = 0, moves = 0, maxScore = 0, badGaps = 0, lastMoveTick = 0, lives0 = S.pl[0].lives;
    for (let k = 0; k < 1500 && S.state !== 'over'; k++) {
      const mt0 = S.pl[0].moveT;
      stepOnce(sb); ticks++;
      if (S.state === 'paused') { Snake.api.togglePause(); continue; }   // easy 掉命进复活暂停 → 继续
      if (S.pl[0].lives !== lives0) {        // 掉命→重生：跨复活的间隔不算速度越界（重生那一拍本来就不动）
        lives0 = S.pl[0].lives; lastMoveTick = 0;
      }
      if (S.pl[0].moveT !== mt0) {           // 玩家 0 走了一格：同一命内两次移动之间只允许 1（冲刺）或 2 个 tick
        if (lastMoveTick && S.tickN - lastMoveTick > 2) badGaps++;
        lastMoveTick = S.tickN; moves++;
      }
      for (const p of S.pl) if (p.score > maxScore) maxScore = p.score;
      assert.ok(S.foods.length >= 1 && S.foods.length <= 3, mode + ': 对局中食物数量异常 ' + S.foods.length);
      assert.equal(S.rec.length, 2 * S.myMoves, mode + ': 幽灵录制与步数失步');
      if (k % 100 === 0) {                   // 较重的唯一性检查每 100 tick 做一次
        const fk = new Set(S.foods.map(f => f.x * 1024 + f.y));
        assert.equal(fk.size, S.foods.length, mode + ': 食物位置重复');
        for (const p of S.pl) {
          const seen = new Set();
          for (const s of p.body) {
            const key = s.x * 1024 + s.y;
            assert.ok(!seen.has(key), mode + ': 同一玩家的身体自相交 ' + s.x + ',' + s.y);
            seen.add(key);
          }
          for (const f of S.foods) assert.ok(!seen.has(f.x * 1024 + f.y), mode + ': 食物压在蛇身上');
          if (S.gold) assert.ok(!seen.has(S.gold.x * 1024 + S.gold.y), mode + ': 金苹果压在蛇身上');
        }
      }
    }
    assert.equal(badGaps, 0, mode + ': 出现两次移动间隔 > 2 tick（速度模型越界）' + badGaps + ' 次');
    assert.ok(moves > 40, mode + ': soak 覆盖不足（moves=' + moves + ' ticks=' + ticks + '）');
    assert.ok(maxScore >= 5, mode + ': soak 没跑出成绩（maxScore=' + maxScore + ' moves=' + moves + '）');
  }
});

/* ---------- 3D 双人对战的食物数（用户反馈「人机秒死」后加的调参）：多给食物，别让两条蛇死抢同一颗 ---------- */
test('3D 双人对战食物数 = K.TUNE.foods3d；经典仍用 MODES.foods', () => {
  const sb = load('?mode=ai&terrain=1&level=test-24', false, true);
  sb.Snake.api.reset(); sb.Snake.api.start();
  assert.equal(sb.Snake.S.foods.length, sb.Snake.K.TUNE.foods3d, '3D 双人应铺满 foods3d 颗食物');
  assert.ok(sb.Snake.S.foods.every(f => sb.Snake.S.T.hasWalk(f.x, f.y)), '3D 食物必须落在可走格');
  const c = load('?mode=ai');
  c.Snake.api.reset(); c.Snake.api.start();
  assert.equal(c.Snake.S.foods.length, 3, '经典人机对战仍是 3 颗（MODES.foods）');
});

/* ---------- 方向键映射：一键一方向（↑右上 / →右下 / ↓左下 / ←左上），同向与反向都被忽略 ---------- */
test('方向键映射：4 个键各自控制一个方向，按同向/反向不动，按垂直方向必转', () => {
  const sb = load(); sb.Snake.api.reset(); sb.Snake.api.start();
  const V = { upRight: [0, -1], downRight: [1, 0], downLeft: [0, 1], upLeft: [-1, 0] };
  const N = { '0,-1': 'upRight', '1,0': 'downRight', '0,1': 'downLeft', '-1,0': 'upLeft' };
  const T = {   // 当前朝向 × 按键 → 期望结果（null = 该键此时应被忽略：同一个方向＝同向，对面方向＝不许掉头）
    upRight:   { up: null,       right: 'downRight', down: null,      left: 'upLeft' },
    downRight: { up: 'upRight',  right: null,        down: 'downLeft', left: null },
    downLeft:  { up: null,       right: 'downRight', down: null,      left: 'upLeft' },
    upLeft:    { up: 'upRight',  right: null,        down: 'downLeft', left: null },
  };
  for (const cur of Object.keys(T)) for (const key of Object.keys(T[cur])) {
    const p = sb.Snake.S.pl[0];
    p.dir = V[cur].slice(); p.queue.length = 0;      // 摆成朝 cur 直走、无待转
    sb.Snake.api.press(0, key);
    const q = p.queue.length ? N[p.queue[p.queue.length - 1].join(',')] : null;
    assert.equal(q, T[cur][key], `朝向 ${cur} 按 ${key} 应得 ${T[cur][key] || '忽略'}，实际 ${q || '忽略'}`);
  }
});

/* ---------- Stage 2：层规则（远征专用；经典模式不受影响） ---------- */
function expSB() {                    // 远征沙箱：reset() 会按 URL 建层图并开局
  const sb = load('?mode=expedition&level=test-24', false, true);
  sb.Snake.api.reset();
  return sb;
}
function place(sb, cells, dir) {      // 把 p0 摆成 cells 指定的样子（头在前，每节带层号 L）
  const p = sb.Snake.S.pl[0];
  p.body = cells.map(c => ({ x: c.x, y: c.y, L: c.L || 0 }));
  p.dir = dir.slice(); p.queue.length = 0; p.dead = false;
  sb.Snake.S.state = 'playing'; sb.Snake.S.now = 0; p.moveT = 0; p.moveP = 300;
  return p;
}
test('远征：桥下可通行——同一格不同层互不阻挡，也不吃上层食物（§3.2/§3.5）', () => {
  const sb = expSB(), S = sb.Snake.S;
  assert.ok(S.T, '远征必须已建层图');
  const p = place(sb, [{ x: 8, y: 16, L: 0 }, { x: 7, y: 16, L: 0 }], [1, 0]);   // (8..9,16) 是 'b'：地面 h0 + 桥面 h2
  S.foods = [{ x: 9, y: 16, L: 2 }];                                            // 桥面上放一颗食物
  moveOnce(sb, p);
  assert.equal(S.state, 'playing', '桥下直行不该撞死');
  assert.equal(p.body[0].x, 9, '应走到 (9,16) 的地面层');
  assert.equal(p.body[0].L || 0, 0, '应仍在桥下层');
  assert.equal(S.foods.length, 1, '桥面上的食物不该被桥下的头吃掉');
});
test('远征：悬崖/墙按高差阻挡，踩传送门下一步就穿到对端（§3.3/§3.4）', () => {
  const a = expSB();                                                            // 悬崖：(2,12) 地面 h0 往左是外墙 '#'(h3)，高差 3 > 1
  const pa = place(a, [{ x: 2, y: 12, L: 0 }, { x: 3, y: 12, L: 0 }], [-1, 0]);
  for (let i = 0; i < 8 && a.Snake.S.state === 'playing'; i++) stepOnce(a);
  assert.equal(a.Snake.S.state, 'over', '高差 > 1 的相邻格必须挡住（悬崖/围墙）');
  const b = expSB();                                                            // 传送门：站在 P(2,2)，下一步到 p(21,3)
  const pb = place(b, [{ x: 2, y: 2, L: 0 }, { x: 3, y: 2, L: 0 }], [-1, 0]);
  moveOnce(b, pb);
  assert.equal(b.Snake.S.state, 'playing', '传送门两端都可走，不该算撞');
  assert.equal(pb.body[0].x, 21, '应被送到对端 (21,3)，实际 ' + pb.body[0].x + ',' + pb.body[0].y);
  assert.equal(pb.body[0].y, 3, '应被送到对端 (21,3)');
});
test('远征 soak：三张图连续行走，逐帧校验层规则不变量（不穿墙/水、不吃错层、食物总在最高可走层）', () => {
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const id of ['test-24', 'harbor-32', 'ridges-40']) {
    const sb = load('?mode=expedition&level=' + id, false, true);
    sb.Snake.api.reset();
    sb.Snake.api.start();                 // ready → playing（远征开局同样要点一下才走）
    const S = sb.Snake.S, p = S.pl[0];
    const legal = (x, y, L) => !!S.T.pick(x, y, L);
    const portalAt = (x, y, L) => { const l = S.T.layerAt(x, y, L); return !!(l && l.kind === 'portal'); };
    const occupied = (x, y, L) => p.body.some((s, si) => si !== p.body.length - 1 && s.x === x && s.y === y && (s.L || 0) === L);
    const space = (x0, y0, L) => {          // 小范围洪水填充（上限 64 格）：给候选方向估「活动空间」，别钻死胡同
      const seen = new Set([x0 + ',' + y0]), q = [[x0, y0]]; let n = 0;
      while (q.length && n < 64) {
        const c = q.shift(); n++;
        for (const d of DIRS) {
          const nx = c[0] + d[0], ny = c[1] + d[1], k = nx + ',' + ny;
          if (seen.has(k) || !S.T.pick(nx, ny, L) || occupied(nx, ny, L)) continue;
          seen.add(k); q.push([nx, ny]);
        }
      }
      return n;
    };
    let moves = 0, steps = 0;
    while (steps++ < 2000 && S.state === 'playing' && moves < 400) {
      const h = p.body[0], L = h.L || 0, before = h.x + ',' + h.y + ',' + L;
      const tail = p.body[p.body.length - 1];
      let pick = null, bestN = -1;
      for (const d of DIRS) {
        if (d[0] === -p.dir[0] && d[1] === -p.dir[1]) continue;               // 反向会被 turn() 忽略
        if (portalAt(h.x, h.y, L)) { pick = d; break; }                       // 站在传送门上：随便排，规则会把蛇送到对端
        const nx = h.x + d[0], ny = h.y + d[1];
        if (!legal(nx, ny, L) || occupied(nx, ny, L)) continue;
        if (tail && tail.x === nx && tail.y === ny && (tail.L || 0) === L &&
            S.foods.some(f => f.x === nx && f.y === ny && (f.L || 0) === L)) continue;   // 吃到时尾巴不缩，别咬自己尾
        const sc = space(nx, ny, L);
        if (sc > bestN) { bestN = sc; pick = d; }
      }
      if (pick) { p.queue.length = 0; p.queue.push(pick); }
      stepOnce(sb);
      const h2 = p.body[0];
      if (h2.x + ',' + h2.y + ',' + (h2.L || 0) !== before) moves++;
      for (const s of p.body) {
        const l = S.T.layerAt(s.x, s.y, s.L || 0);
        assert.ok(l && l.walkable, id + '：蛇身节 (' + s.x + ',' + s.y + ',L' + (s.L || 0) + ') 不在可行走层上');
      }
      assert.ok(S.foods.length >= 1, id + '：食物不该消失');
      S.foods.forEach(f => { const tw = S.T.topWalk(f.x, f.y); assert.ok(tw && (f.L || 0) === tw.h, id + '：食物不在该格最高可走层'); });
      assert.equal(S.rec.length, 2 * S.myMoves, id + '：幽灵录制与步数失步');
      assert.ok(S.pl.every(q => q.score >= 0 && q.energy >= 0 && q.energy <= 100), id + '：分数/能量越界');
    }
    assert.ok(moves >= 250, id + '：soak 应真的走起来（实际 ' + moves + ' 步，state=' + S.state + '）');
  }
});

/* ---------- 3.0 远征：层图接管地图（Stage 1 只做墙/水硬阻挡，高差与传送见 Stage 2） ---------- */
test('远征模式：层图接管地图——24×24、视口 18、关卡出生点、墙水阻挡、食物落在可走格、相机跟随', () => {
  const sb = load('?mode=expedition&level=test-24', false, true);
  const { Snake } = sb, S = Snake.S;
  assert.equal(S.mode, 'expedition');
  assert.equal(S.levelId, 'test-24', 'URL 的 level 参数在启动时就生效');
  assert.equal(S.T, null, 'core 加载时 levels.js / terrain.js 还没执行，层图要等 newGame 再建');

  Snake.api.newGame();   // 页面启动块调的是 api.reset() → newGame；测试里显式走一遍
  assert.ok(S.T && S.T.w === 24, 'newGame 后层图已建立');
  assert.equal(S.MAP_N, 24); assert.equal(S.N, 24);
  assert.equal(S.VIEW_N, 18, '桌面视口 18 格（窄屏 14）');
  assert.equal(S.W, 18 * 30 + 20); assert.equal(S.H, 18 * 15 + 34 + 12);

  Snake.api.start();
  const p = S.pl[0];
  assert.equal(p.body[0].x, 4); assert.equal(p.body[0].y, 11, 'P1 出生点来自关卡数据');
  assert.ok(eq(p.dir, 1, 0), '朝向来自关卡数据（downRight）');
  assert.equal(JSON.stringify(p.body.map(s => [s.x, s.y])), '[[4,11],[3,11],[2,11]]', '蛇身铺在出生点身后');
  S.foods.forEach(f => assert.ok(S.T.hasWalk(f.x, f.y), '食物必须落在可走格 (' + f.x + ',' + f.y + ')'));

  /* 墙是硬阻挡：把蛇头贴到左墙边、朝墙走 ⇒ 必掉命（远征 1 条命 ⇒ 直接结算） */
  p.body = [{ x: 1, y: 11 }, { x: 2, y: 11 }, { x: 3, y: 11 }]; p.dir = [-1, 0]; p.queue = [];
  for (let i = 0; i < 6 && S.state === 'playing'; i++) stepOnce(sb);
  assert.notEqual(S.state, 'playing', '撞墙必须结束这一局');

  /* 相机：平滑跟随——每帧位移必须远小于一格（整格跳就是用户说的「卡」），贴边时收敛到 clamp 位置 */
  Snake.api.newGame(); Snake.api.start();
  const q = S.pl[0], half = (S.VIEW_N - 1) / 2;
  let maxJump = 0, px0 = S.camCX, py0 = S.camCY;
  for (let i = 0; i < 8; i++) {
    stepOnce(sb);
    maxJump = Math.max(maxJump, Math.abs(S.camCX - px0), Math.abs(S.camCY - py0));
    px0 = S.camCX; py0 = S.camCY;
  }
  assert.ok(maxJump > 0 && maxJump < 1, '相机必须平滑移动、不许整格跳：单帧最大位移 ' + maxJump.toFixed(3) + ' 格');
  const settle = n => { const t0 = sb.__t + 1; for (let i = 0; i < n; i++) Snake.api.update(t0 + i); };   // 每步 +1ms：不触发 tick，只看相机收敛
  settle(40);
  const near = (a, b) => Math.abs(a - b) <= 2.2;   // 死区 2 格 + 平滑收敛余量
  assert.ok(near(q.body[0].x, S.camCX) && near(q.body[0].y, S.camCY), '相机会追上蛇头并停在死区里（贴边时被 clamp）');
  q.body = [{ x: 22, y: 22 }, { x: 21, y: 22 }, { x: 20, y: 22 }];
  settle(40);
  assert.ok(S.camCX >= half && S.camCX <= S.N - 1 - half, '相机 x 必须在地图内');
  assert.ok(S.camCY >= half && S.camCY <= S.N - 1 - half, '相机 y 必须在地图内');
  assert.ok(Math.abs(S.camCX - (S.N - 1 - half)) < .05, '追到右下角应收敛到边界 clamp');
});

test('经典模式不受层图影响：MAP_N/VIEW_N 等于棋盘、S.T 为空、出生点仍是 2.0 原样', () => {
  const sb = load();   // 刻意不加载 terrain/levels：经典路径不许依赖它们
  const { Snake } = sb, S = Snake.S;
  Snake.api.setMode('normal');
  assert.equal(S.MAP_N, 12); assert.equal(S.VIEW_N, 12); assert.equal(S.T, null);
  assert.equal(S.W, 380); assert.equal(S.H, 226);
  assert.equal(JSON.stringify(S.pl[0].body.map(s => [s.x, s.y])), '[[3,6],[2,6],[1,6]]');
  assert.ok(eq(S.pl[0].dir, 1, 0));
  assert.equal(S.camCX, 5.5); assert.equal(S.camCY, 5.5, '经典相机固定在地图中心 ⇒ 渲染偏移恒 0');
});

/* ---------- 插值时钟：moveT 取渲染时钟 S.now 并提前 moveLead 起势，不再落后游戏时钟 S.last ---------- */
test('插值时钟：每个移动步的插值起点取渲染时钟并提前起势（moveT === S.now - moveLead）', () => {
  const sb = load(); sb.Snake.api.setMode('normal'); sb.Snake.api.start();
  const S = sb.Snake.S, p = S.pl[0], LEAD = sb.Snake.K.TUNE.moveLead;
  moveOnce(sb, p);
  assert.equal(p.moveT, S.now - LEAD, `moveT 应为渲染时钟减去起势量（S.now ${S.now} - 起势 ${LEAD}）；旧实现取 S.last 会最多落后一个 tick ⇒ 起步慢半拍`);
  assert.ok(S.now >= S.last, `S.now(${S.now}) 不应早于游戏时钟 S.last(${S.last})`);
  assert.ok(p.moveP > 0, 'moveP 应为正的插值时长');
});

/* ---------- 经典模式行为锁：定种子 + 固定输入脚本 → 状态摘要逐字节稳定（Stage 2 改地形规则时的护栏） ---------- */
test('经典模式行为锁：固定种子与输入脚本跑 1200 tick，状态摘要恒定', () => {
  const sb = load('?seed=20261025'); const SN = sb.Snake;
  SN.api.startDaily(20261025); SN.api.start();               // 确定性随机流：同种子必然同一条食物序列
  const S = SN.S, p = S.pl[0], KEYS = ['up', 'right', 'down', 'left'];
  const V = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };   // 一键一方向：与 core.K.SCREEN 同步
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  const free = (x, y) => x >= 1 && y >= 1 && x < S.N - 1 && y < S.N - 1 && !p.body.some(s => s.x === x && s.y === y);
  const space = v => {                                       // 沿该方向向量还能走几格（留 1 格边距 + 避自身）
    let n = 0, x = p.body[0].x, y = p.body[0].y;
    for (let k = 1; k <= 6; k++) { x += v[0]; y += v[1]; if (!free(x, y)) break; n++; }
    return n;
  };
  let h = 2166136261 >>> 0, ticks = 0;                       // FNV-1a 摘要
  const mix = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  for (let i = 0; i < 1200 && S.state !== 'over'; i++) {
    if (i % 2 === 0) {                                       // 每 2 tick（20ms）决策一次：远早于一次移动（150ms）
      const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir, f = S.foods[0];
      let best = null, bestScore = -1e9;
      for (const d of KEYS) {                                // 固定次序遍历 ⇒ 完全确定
        const res = V[d];                                    // 一键一方向：按键直接决定落点方向
        if (eq(res, ref)) continue;                          // 与当前/排队方向相同 ⇒ turn() 会忽略
        if (res[0] + ref[0] === 0 && res[1] + ref[1] === 0) continue;   // 反向掉头 ⇒ turn() 会忽略
        const sc = space(res) * 100 - (Math.abs(p.body[0].x + res[0] - f.x) + Math.abs(p.body[0].y + res[1] - f.y));
        if (sc > bestScore) { bestScore = sc; best = d; }    // 先要活路（前瞻空格数），再贪食物
      }
      if (best) SN.api.press(0, best);
    }
    stepOnce(sb); ticks = i + 1;
    if (i % 10 === 0) mix([S.tickN, S.state, p.body[0].x, p.body[0].y, p.body.length, p.score,
      S.foods.map(f => f.x + ',' + f.y).join('|'), S.gold ? S.gold.x + ',' + S.gold.y : '-',
      S.stats.food, S.stats.gold].join('/'));
  }
  assert.ok(ticks > 60, '至少要跑满 60 tick 这段锁才有意义，实际 ' + ticks);
  // 摘要涵盖：每 10 tick 的头部坐标/长度/分数/食物序列/金苹果/吃到数 —— 任何经典规则漂移都会变
  assert.equal(h >>> 0, 0xe692ec99, '经典模式行为摘要变了：' + (h >>> 0).toString(16) + '（ticks=' + ticks + '）');
});

/* ---------- 3D 地形与模式正交（用户要求：每个模式都能选开不开 3D，原版与升级版并行） ---------- */
test('3D 开关：地形与模式正交——普通/双人/人机都能开，关了回到原版棋盘', () => {
  const sb = load('', false, true), S = sb.Snake.S, api = sb.Snake.api;
  for (const m of ['normal', 'pk', 'ai']) {
    api.setMode(m);
    api.setTerrain(true, 'test-24');
    assert.equal(S.terrain, true, m + ': 3D 应已开启');
    assert.equal(S.mode, m, m + ': 开 3D 不该改掉模式');
    assert.ok(S.T && S.levelId === 'test-24' && S.MAP_N === 24 && S.N === 24, m + ': 层图应接管地图（24×24）');
    api.setMode(m === 'normal' ? 'pk' : 'normal');    // 切模式时 3D 要跟着留在原位
    assert.ok(S.T && S.terrain, m + ': 切模式后 3D 仍应开着');
    api.setTerrain(false);
    assert.equal(S.terrain, false, m + ': 3D 应已关闭');
    assert.equal(S.T, null, m + ': 关 3D 应释放层图');
    api.setMode(m);                                  // 回到该模式的原版棋盘
    assert.equal(S.N, m === 'normal' ? 12 : 18, m + ': 关 3D 后应回到原版格数');
    assert.ok(!S.T, m + ': 关 3D 后不该再有层图');
  }
});

/* ---------- Stage 3：地形 AI 批量对局（验收：0 撞悬崖/撞墙/落水，0 卡死） ---------- */
test('远征 AI 批量对局：层图 AI 在真实地图上不撞地形、不卡死（SOAK_GAMES 可放大到 500）', () => {
  const GAMES = +(process.env.SOAK_GAMES || 12);
  const maps = ['test-24', 'harbor-32', 'ridges-40'];
  const lines = [];
  for (const id of maps) {
    const sb = load('?mode=expedition&level=' + id, true, true);
    const S = sb.Snake.S, api = sb.Snake.api;
    sb.Snake.Ai.setLevel(2);
    let crash = 0, stuck = 0, tSum = 0, tMax = 0, sMax = 0;
    for (let g = 0; g < GAMES; g++) {
      api.setTerrain(true, id);
      S.pl.forEach(p => p.ai = true);
      api.start();
      let t = 0, still = 0, hx = -1, hy = -1;
      while (S.state === 'playing' && t < 1500) {
        stepOnce(sb); t++;
        for (const p of S.pl) for (const s of p.body) {   // 每一帧：蛇身每节都必须在可走层上
          const l = S.T.layerAt(s.x, s.y, s.L || 0);
          assert.ok(l && l.walkable, id + ' 第 ' + g + ' 局：蛇身出现在不可走层 (' + s.x + ',' + s.y + ',L' + (s.L || 0) + ')');
        }
        const h = S.pl[0].body[0];
        if (h.x === hx && h.y === hy) { if (++still > 200) { stuck++; break; } }   // 卡死口径：头 200 tick 不动
        else { still = 0; hx = h.x; hy = h.y; }
      }
      if (S.state === 'over') {   // 撞墙/撞悬崖/落水：core 在落点对象上打 bad 标记（core.js:301/305/311），头部就是那个对象
        const h = S.pl[0].body[0];
        if (h.bad) crash++;
      }
      tSum += t; tMax = Math.max(tMax, t); sMax = Math.max(sMax, S.pl[0].score);
    }
    lines.push(id + ': ' + GAMES + ' 局 · 撞地形 ' + crash + ' · 卡死 ' + stuck + ' · tick 均 ' + Math.round(tSum / GAMES) + ' 最大 ' + tMax + ' · 最高分 ' + sMax);
    assert.equal(crash, 0, id + ': 层图 AI 不该撞墙/撞悬崖/落水');
    assert.equal(stuck, 0, id + ': 层图 AI 不该卡死');
  }
  console.log('      远征 AI 对局：' + lines.join('  |  '));
});

/* ---------- 传送门不再「像陷阱」：传到对端后那一拍不许再传（旧行为会立刻弹回、身体叠在自己头上 → 判负） ---------- */
test('传送门冷却：踩门传到对端后不会立刻弹回，也不会自己把自己撞死', () => {
  const sb = expSB(); const S = sb.Snake.S, p = S.pl[0];
  S.state = 'playing';
  p.body = [{ x: 2, y: 2, L: 0 }, { x: 2, y: 3, L: 0 }, { x: 2, y: 4, L: 0 }];   // 站在 P(2,2) 门格上
  p.dir = [0, 1]; p.queue.length = 0; p.portCool = false;
  moveOnce(sb, p);
  assert.equal(S.state, 'playing', '踩传送门不该直接判负，状态=' + S.state);
  const h1 = p.body[0];
  assert.ok(h1.x === 21 && h1.y === 3, '这一步应当送到对端 p(21,3)，实际 ' + JSON.stringify([h1.x, h1.y]));
  assert.equal(p.portCool, true, '传送到达后应当置冷却');
  // 冷却期内站在对端门格上：再走一步不该被传回原门（回归用例：旧代码会弹回并自撞判负）
  p.body = [{ x: 21, y: 3, L: 0 }, { x: 21, y: 2, L: 0 }, { x: 21, y: 1, L: 0 }];
  p.dir = [-1, 0]; p.queue.length = 0;
  moveOnce(sb, p);
  const h2 = p.body[0];
  assert.ok(!(h2.x === 2 && h2.y === 2), '冷却期内不该立刻弹回原门，实际 ' + JSON.stringify([h2.x, h2.y]));
  assert.equal(p.portCool, false, '走完正常一步后应当解除冷却');
});

/* ---------- 冰面 transition：一步落点可能跨多格（§5：AI 必须先查这张表才允许在冰原跑） ---------- */
test('冰面 transition：踩上冰面会继续同向滑，遇到非冰/墙/悬崖才停', () => {
  const sb = load('', false, true);
  const T = sb.Snake.Terrain.build({
    id: 'ice-probe', map: ["###############","#.............#","#..III........#","#.III.........#","#...@III...$..#","#.............#","###############"],
    spawns: [{ x: 4, y: 4, dir: 'downRight' }, { x: 11, y: 4, dir: 'upLeft' }], foods: 1, rulesetVersion: 1
  });
  // 从 (3,4) 地面往右：穿过 (5,4)(6,4)(7,4) 三格冰，在 (8,4) 地面停下
  const a = sb.Snake.Terrain.slide(T, 4, 4, 0, [1, 0]);   // (4,4) 是出生点地面格，往右第一步就踩上冰
  eq([a.x, a.y], 8, 4); assert.equal(a.path.length, 4, '踩上冰后应滑过 5→8 共 4 格');
  assert.ok(a.path.every(s => T.hasWalk(s.x, s.y)), '滑行路径上不允许出现不可走格');
  // 从 (4,4) 地面往上：落点不是冰 ⇒ 只走一格
  const b = sb.Snake.Terrain.slide(T, 8, 4, 0, [0, -1]);   // (8,3) 是普通地面 ⇒ 一格即停
  eq([b.x, b.y], 8, 3); assert.equal(b.path.length, 1, '非冰落点应当只走一步');
  // 从 (4,3) 冰面往上：滑到 (4,2) 冰、再到 (4,1) 地面停下
  const c = sb.Snake.Terrain.slide(T, 4, 3, 0, [0, -1]);
  eq([c.x, c.y], 4, 1); assert.equal(c.path.length, 2, '冰上连续滑动应当在离开冰面那格停下');
  // 从 (4,3) 往左：冰 → 冰 → 地面，且绝不越过边界墙
  const d = sb.Snake.Terrain.slide(T, 4, 3, 0, [-1, 0]);
  eq([d.x, d.y], 1, 3); assert.equal(d.path.length, 3, '连续三格冰后应停在地面');
  assert.ok(T.hasWalk(d.x, d.y), '终点必须是可走格');
});
