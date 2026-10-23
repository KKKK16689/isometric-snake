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
  Snake.api.press(0, 'left');                                 // 等距屏上 left → 候选 [upLeft, upRight]，steer 挑能转的
  Snake.api.press(0, 'up');
  Snake.api.press(0, 'right');
  assert.ok(p.queue.length <= 2, 'queue capped at 2, got ' + p.queue.length);
  p.queue = []; p.dir = [1, 0];
  Snake.api.press(0, 'left');                                 // c1=[-1,0] 是掉头 → 必须改选 c2=[0,-1]
  assert.ok(eq(p.queue[0], 0, -1), '180° reversal must be refused, got ' + JSON.stringify(p.queue[0]));
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
