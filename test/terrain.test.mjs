/* terrain.test.mjs —— 层图数据契约的单元测试（docs/terrain-spec.md §1–§3）
   覆盖：ASCII 解析、8 项校验、选层规则（§3.3）、传送门配对、可达性、负例必须抛错。
   参考校验器（仓库外 D:\snake3-qa\level-check.mjs）给出过同一张图的统计：层节点 596 / 可走 457
   （ground 433 · wall 112 · water 27 · deck 20 · portal 4）——这里把它变成断言，防止「文档一套、代码一套」。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

/* 只用 window 的极简沙箱（浏览器里 window 就是全局对象，所以让沙箱自引用；terrain/levels 不碰 DOM） */
function load() {
  const sb = { console };
  sb.window = sb;
  sb.Snake = {};
  const ctx = createContext(sb);
  runInContext(read('src/js/terrain.js'), ctx, { filename: 'terrain.js' });
  runInContext(read('src/js/levels.js'), ctx, { filename: 'levels.js' });
  return sb.Snake;
}

const L = () => load().LEVELS[0];

/* 注册表里的每一张图都必须能过校验、能建图——以后加关卡时这条先炸，防止塞进不可达/不封闭的图 */
test('关卡注册表：每张图都能过校验并建图，且大小/可达性达标', () => {
  const S = load();
  assert.ok(S.LEVELS.length >= 3, 'Stage 1 至少三张灰模图，实际 ' + S.LEVELS.length);
  const ids = S.LEVELS.map(l => l.id);
  assert.equal(new Set(ids).size, ids.length, '关卡 id 不能重复');
  for (const lv of S.LEVELS) {
    const rep = S.Terrain.validate(lv.map);
    assert.ok(rep.walkable > 100, lv.id + ' 可走格太少：' + rep.walkable);
    const T = S.Terrain.build(lv);
    assert.equal(T.nodeCount(), rep.nodes, lv.id + ' build 与 validate 的层节点数不一致');
    const p1 = lv.spawns[0];
    assert.equal(T.reachable(p1.x, p1.y, 0, () => true).size, rep.walkable, lv.id + ' 所有可走层节点必须从 P1 可达');
    assert.ok(S.levelById(lv.id) === lv, lv.id + ' 必须能按 id 查到');
  }
  assert.equal(S.levelById('test-24').map.length, 24);
  assert.equal(S.levelById('harbor-32').map.length, 32);
  assert.equal(S.levelById('ridges-40').map.length, 40, '要有比 24×24 更大的图，不然相机没得跟');
  assert.equal(S.levelById('ridges-40').map[0].length, 40, '每行等长');
});

test('解析测试图：统计与参考校验器一致（596 层节点 / 457 可走）', () => {
  const S = load();
  const rep = S.Terrain.validate(L().map);
  assert.equal(rep.w, 24); assert.equal(rep.h, 24);
  assert.equal(rep.nodes, 596, '层节点数应为 596，实际 ' + rep.nodes);
  assert.equal(rep.walkable, 457, '可走层节点数应为 457，实际 ' + rep.walkable);
  const T = S.Terrain.build(L());
  const kinds = {};
  for (let x = 0; x < T.w; x++) for (let y = 0; y < T.h; y++) for (const l of T.at(x, y)) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
  assert.deepEqual(kinds, { ground: 433, wall: 112, water: 27, deck: 20, portal: 4 });
});

test('层图 API：格/层/最高可走层/越界', () => {
  const T = load().Terrain.build(L());
  assert.equal(T.at(0, 0)[0].kind, 'wall', '(0,0) 应是外墙');
  assert.equal(T.at(-1, 3), null, '越界格返回 null');
  assert.equal(T.at(24, 3), null, '越界格返回 null');
  const p = T.layerAt(2, 2, 0);
  assert.equal(p.kind, 'portal'); assert.equal(p.portal, 'p', 'P 与 p 归为同一对（字母小写）');
  assert.equal(T.topWalk(5, 4).h, 2, '台面格 (5,4) 最高可走层是 h2');
  assert.equal(T.topWalk(0, 0), null, '墙没有可走层');
  assert.equal(T.layerAt(5, 4, 1), null, '台面中心只有 h2 一层');
  assert.equal(T.layerAt(3, 4, 1).h, 1, '台面外圈 (3,4) 是 h1 台阶层');
});

test('选层规则 §3.3：高差 > 1 是悬崖；同格优先同层；桥下按层自然通行', () => {
  const T = load().Terrain.build(L());
  assert.equal(T.pick(0, 1, 0), null, '走进墙 ⇒ null');
  assert.equal(T.pick(18, 9, 0), null, '走进水 ⇒ null');
  assert.equal(T.pick(17, 12, 0), null, '从地面（h0）上 B 桥面（h2）高差 2 ⇒ 悬崖');
  assert.deepEqual(T.pick(17, 12, 1).h, 2, '从 h1 引桥上桥面 ⇒ 差值 1，可上');
  assert.equal(T.pick(5, 16, 0).h, 0, 'b 桥格：从地面进入选同层 h0（桥下通行）');
  assert.equal(T.pick(5, 16, 2).h, 2, 'b 桥格：从桥面进入选同层 h2');
  assert.equal(T.pick(3, 4, 0).h, 1, '台面外圈：地面进入选 h1（台阶，差值 1）');
  assert.equal(T.pick(3, 4, 1).h, 1, '已在 h1：同层优先');
  assert.equal(T.pick(5, 4, 2).h, 2, '台面内部：同层优先（该格只有 h2）');
  assert.equal(T.pick(5, 4, 0), null, '台面中心从地面进：高差 2 ⇒ 悬崖');
});

test('层图邻接与占位键：层号参与，桥上桥下互不阻挡', () => {
  const T = load().Terrain.build(L());
  const nb = T.neighbors(5, 16, 0);                       // b 桥格的地面层
  assert.equal(nb.filter(n => !(n.x === 5 && n.y === 16)).length, 4, '地面层应有 4 个方向邻接');
  assert.ok(!nb.some(n => n.x === 5 && n.y === 16), '同格 h2 与 h0 差 2 > 1 ⇒ 不能直接上下（要靠引桥）');
  assert.ok(T.key(5, 16, 0) !== T.key(5, 16, 2), '不同层的占位键必须不同');
  assert.equal(T.key(5, 16, 0), '5,16,0');
  const up = T.neighbors(17, 12, 1);                      // h1 引桥层
  assert.ok(up.some(n => n.x === 17 && n.y === 12 && n.L === 2), '从 h1 引桥可踏上同格 deck h2（差值 1）');
});

test('传送门：字母成对、两端可走（P(2,2)↔p(21,3)、Q(21,20)↔q(2,21)）', () => {
  const T = load().Terrain.build(L());
  const out = (x, y, letter) => { const o = T.portalTo(x, y, letter); return o ? [o.x, o.y, o.L].join(',') : null; };
  assert.equal(out(2, 2, 'p'), '21,3,0');
  assert.equal(out(21, 3, 'p'), '2,2,0');
  assert.equal(out(21, 20, 'q'), '2,21,0');
  assert.equal(out(2, 21, 'q'), '21,20,0');
});

test('可达性：全部可走层节点从 P1 出生点可达', () => {
  const T = load().Terrain.build(L());
  const s = T.spawns[0], top = T.topWalk(s.x, s.y);
  assert.equal(s.x, 4); assert.equal(s.y, 11); assert.equal(top.h, 0, 'P1 出生点在平地');
  const dist = T.reachable(s.x, s.y, top.h);
  const miss = T.walkables().filter(n => !dist.has(T.key(n.x, n.y, n.L)));
  assert.equal(miss.length, 0, '不可达节点：' + JSON.stringify(miss.slice(0, 3)));
  assert.equal(dist.size, 457, '可达节点数应等于可走节点数（457）');
});

test('负例必须抛错：行不等长 / 未知字符 / 未实现的冰 / 边界不封闭', () => {
  const S = load();
  const one = L().map.slice();
  const short = one.slice(); short[3] = short[3].slice(0, 20);
  assert.throws(() => S.Terrain.validate(short), /每行必须等长/);
  const unknown = one.slice(); unknown[5] = '#..12222X..............#';
  assert.throws(() => S.Terrain.validate(unknown), /未知地图字符/);
  const ice = one.slice(); ice[5] = '#..12L221..............#';
  assert.throws(() => S.Terrain.validate(ice), /Stage 4/);
  const open = one.slice(); open[0] = '#......................#';   // 顶边开口
  assert.throws(() => S.Terrain.validate(open), /边界未封闭/);
});

test('负例必须抛错：传送门落单 / 出生点无跑道 / 孤岛不可达', () => {
  const S = load();
  const base = L().map;
  /* 按坐标改单个字符，避免手写整行出错 */
  const setCh = (rows, x, y, ch) => rows.map((r, j) => (j === y ? r.slice(0, x) + ch + r.slice(x + 1) : r));

  assert.throws(() => S.Terrain.validate(setCh(base, 21, 3, '.')), /传送门 'p' 必须恰好两端/);

  let noRun = setCh(base, 3, 11, '#');                 // 把 P1 出生点 (4,11) 围成一格死巷
  noRun = setCh(noRun, 5, 11, '#'); noRun = setCh(noRun, 4, 10, '#'); noRun = setCh(noRun, 4, 12, '#');
  assert.throws(() => S.Terrain.validate(noRun), /没有 3 格直线跑道/);

  let island = setCh(base, 4, 1, '1');                // 造一个四面被墙围死的可走层节点
  island = setCh(island, 3, 1, '#'); island = setCh(island, 5, 1, '#'); island = setCh(island, 4, 2, '#');
  assert.throws(() => S.Terrain.validate(island), /不可达/);
});