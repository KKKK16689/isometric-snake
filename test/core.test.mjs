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
};

function load(search = '', withAi = false) {
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
  Snake.api.press(0, 'left');                                 // c1=[-1,0] 是掉头 → 必须改选 c2=[0,1]（左下＝屏幕上的左转）
  assert.ok(eq(p.queue[0], 0, 1), '180° reversal must be refused, got ' + JSON.stringify(p.queue[0]));
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

/* ---------- 屏幕方向键映射：↑↓←→ 各自只往屏幕同侧转，已在同侧则忽略 ---------- */
test('屏幕方向键映射：↑↓←→ 按屏幕方向生效（旧表整体偏 45°——往右下走按 ↑ 会毫无反应）', () => {
  const sb = load(); sb.Snake.api.reset(); sb.Snake.api.start();
  const V = { upRight: [0, -1], downRight: [1, 0], downLeft: [0, 1], upLeft: [-1, 0] };
  const N = { '0,-1': 'upRight', '1,0': 'downRight', '0,1': 'downLeft', '-1,0': 'upLeft' };
  const T = {   // 当前朝向 × 按键 → 期望结果（null = 该键此时应被忽略：已在朝那侧走）
    upRight:   { up: null,      down: 'downRight', left: 'upLeft',   right: null },
    downRight: { up: 'upRight', down: null,        left: 'downLeft', right: null },
    downLeft:  { up: 'upLeft',  down: null,        left: null,       right: 'downRight' },
    upLeft:    { up: null,      down: 'downLeft',  left: null,       right: 'upRight' },
  };
  for (const cur of Object.keys(T)) for (const key of Object.keys(T[cur])) {
    const p = sb.Snake.S.pl[0];
    p.dir = V[cur].slice(); p.queue.length = 0;      // 摆成朝 cur 直走、无待转
    sb.Snake.api.press(0, key);
    const q = p.queue.length ? N[p.queue[p.queue.length - 1].join(',')] : null;
    assert.equal(q, T[cur][key], `朝向 ${cur} 按 ${key} 应得 ${T[cur][key] || '忽略'}，实际 ${q || '忽略'}`);
  }
});

/* ---------- 插值时钟：moveT 取渲染时钟 S.now，不再落后游戏时钟 S.last ---------- */
test('插值时钟：每个移动步的插值起点取渲染时钟（moveT === S.now ≥ S.last）', () => {
  const sb = load(); sb.Snake.api.setMode('normal'); sb.Snake.api.start();
  const S = sb.Snake.S, p = S.pl[0];
  moveOnce(sb, p);
  assert.equal(p.moveT, S.now, 'moveT 应等于渲染时钟 S.now（旧实现取 S.last，最多落后一个 tick）');
  assert.ok(S.now >= S.last, `S.now(${S.now}) 不应早于游戏时钟 S.last(${S.last})`);
  assert.ok(p.moveP > 0, 'moveP 应为正的插值时长');
});

/* ---------- 经典模式行为锁：定种子 + 固定输入脚本 → 状态摘要逐字节稳定（Stage 2 改地形规则时的护栏） ---------- */
test('经典模式行为锁：固定种子与输入脚本跑 1200 tick，状态摘要恒定', () => {
  const sb = load('?seed=20261025'); const SN = sb.Snake;
  SN.api.startDaily(20261025); SN.api.start();               // 确定性随机流：同种子必然同一条食物序列
  const S = SN.S, p = S.pl[0], KEYS = ['up', 'right', 'down', 'left'];
  const V = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const CAND = { up: [[0, -1], [-1, 0]], down: [[1, 0], [0, 1]], left: [[-1, 0], [0, 1]], right: [[0, -1], [1, 0]] };
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
        const [c1, c2] = CAND[d];
        if (eq(c1, ref) || eq(c2, ref)) continue;            // 该键会被 steer() 整键忽略
        const res = eq([-c1[0], -c1[1]], ref) ? c2 : c1;     // 与 core.steer() 同规则算出落点方向
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
