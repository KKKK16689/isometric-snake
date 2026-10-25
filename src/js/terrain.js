/* terrain.js —— 层图：ASCII 解析、校验、层选择与层图 BFS（纯数据，不碰 DOM/CSS/绘制）
   契约：docs/terrain-spec.md §1–§3、§5。核心概念：
     · 一个格子的每一层 = { h, kind, walkable, portal }，格内按 h 升序；桥 = 同格两层（下 ground/water + 上 deck）。
     · 移动选层：目标格可走层里取 |h - 当前层 h| 最小者；同差值优先同层、其次较高层；最小差值 > 1 或目标不可走 ⇒ 不可走。
     · Stage 1 的玩法只用「目标格有没有可走层」这一条硬阻挡；高差/桥下/传送门规则在 Stage 2 开。
   代码里出现的 'I'/'L'（冰/熔岩）在 Stage 4 之前一律抛错，不静默忽略。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';

  /* ---------- ASCII → 层 ---------- */
  function layersOf(ch, x, y) {
    switch (ch) {
      case '.': case '@': case '$': return [{ h: 0, kind: 'ground', walkable: true, portal: null }];
      case '1': return [{ h: 1, kind: 'ground', walkable: true, portal: null }];
      case '2': return [{ h: 2, kind: 'ground', walkable: true, portal: null }];
      case '3': return [{ h: 3, kind: 'ground', walkable: true, portal: null }];
      case '#': return [{ h: 3, kind: 'wall', walkable: false, portal: null }];
      case '~': return [{ h: 0, kind: 'water', walkable: false, portal: null }];
      case 'B': return [                                   // 桥面 h2 + 下方水（桥下不可通行）
        { h: 0, kind: 'water', walkable: false, portal: null },
        { h: 2, kind: 'deck', walkable: true, portal: null }];
      case 'b': return [                                   // 桥面 h2 + 下方平地 h0（桥下可通行）
        { h: 0, kind: 'ground', walkable: true, portal: null },
        { h: 2, kind: 'deck', walkable: true, portal: null }];
      case 'P': case 'p': case 'Q': case 'q':              // 传送门：成对由字母定义（大小写同属一对）
        return [{ h: 0, kind: 'portal', walkable: true, portal: ch.toLowerCase() }];
      case 'I': case 'L':
        throw new Error(`terrain: 地图里的 '${ch}'（冰/熔岩）要到 Stage 4 才实现，(x=${x},y=${y})`);
      default:
        throw new Error(`terrain: 未知地图字符 '${ch}'，(x=${x},y=${y})`);
    }
  }
  const isWalk = l => !!l && l.walkable;
  /* 出生朝向 → 格方向向量（与 core 的 K.DIRS 同义；terrain 自带一份，便于脱离 core 单测） */
  const DIRV = { upRight: [0, -1], downRight: [1, 0], downLeft: [0, 1], upLeft: [-1, 0] };

  /* 内部：只建层图、不做校验（validate 也要用它 ⇒ 不能写成 build→validate→build 的互相递归） */
  function makeGraph(rows, level) {
    const w = rows[0].length, h = rows.length;
    const cells = [];
    for (let x = 0; x < w; x++) {
      cells[x] = [];
      for (let y = 0; y < h; y++) cells[x][y] = layersOf(rows[y][x], x, y);
    }
    const T = {
      id: level.id, name: level.name, biome: level.biome, w, h, cells,
      spawns: level.spawns.map(s => ({ x: s.x, y: s.y, dir: s.dir })),
      ruleset: level.rulesetVersion,

      at(x, y) { return (x >= 0 && y >= 0 && x < w && y < h) ? cells[x][y] : null; },
      /* 指定层高的层（无则 null） */
      layerAt(x, y, hh) { const a = T.at(x, y); if (!a) return null; for (const l of a) if (l.h === hh) return l; return null; },
      /* 该格最高的可走层（食物/出生落点按此层） */
      topWalk(x, y) { const a = T.at(x, y); if (!a) return null; let best = null; for (const l of a) if (isWalk(l) && (!best || l.h > best.h)) best = l; return best; },
      hasWalk(x, y) { return !!T.topWalk(x, y); },
      /* §3.3 选层：从 fromH 高度进入该格，返回落点层或 null（不可走 / 高差 > 1） */
      pick(x, y, fromH) {
        const a = T.at(x, y); if (!a) return null;
        let best = null;
        for (const l of a) {
          if (!isWalk(l)) continue;
          const dh = Math.abs(l.h - fromH);
          if (dh > 1) continue;
          if (!best || dh < best.dh || (dh === best.dh && l.h === fromH && best.h !== fromH) || (dh === best.dh && l.h > best.h)) best = { h: l.h, dh, layer: l };
        }
        return best;
      },
      /* 传送门出口（Stage 2 用；现在无需参与玩法，但数据要在） */
      portalTo(x, y, letter) {
        for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
          const a = cells[i][j]; if (!a) continue;
          for (const l of a) if (l.portal === letter && !(i === x && j === y)) return { x: i, y: j, L: l.h };
        }
        return null;
      },
      /* 占位/访问标记键（取代旧的 x*1024+y —— 层号参与，桥上桥下互不阻挡） */
      key(x, y, L) { return x + ',' + y + ',' + L; },
      /* 层图邻接：四邻 + 同格其它层；成本 1（传送门边 Stage 2 接） */
      neighbors(x, y, L) {
        const out = [];
        const cur = T.layerAt(x, y, L);
        const fromH = cur ? cur.h : L;
        const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        for (const [dx, dy] of dirs) {
          const p = T.pick(x + dx, y + dy, fromH);
          if (p) out.push({ x: x + dx, y: y + dy, L: p.h, cost: 1, portal: false });
        }
        const a = T.at(x, y) || [];
        for (const l of a) if (isWalk(l) && l.h !== fromH && Math.abs(l.h - fromH) <= 1) out.push({ x, y, L: l.h, cost: 1, portal: false });
        return out;
      },
      /* 层图 BFS：从 (x,y,L) 出发，返回 Map(key → 距离)；pred 可选，用于过滤节点 */
      reachable(x, y, L, pred) {
        const dist = new Map();
        if (!T.hasWalk(x, y)) return dist;
        const start = T.key(x, y, L);
        dist.set(start, 0);
        const q = [[x, y, L]];
        for (let qi = 0; qi < q.length; qi++) {
          const [cx, cy, cL] = q[qi], d = dist.get(T.key(cx, cy, cL));
          for (const n of T.neighbors(cx, cy, cL)) {
            if (pred && !pred(n)) continue;
            const k = T.key(n.x, n.y, n.L);
            if (dist.has(k)) continue;
            dist.set(k, d + 1); q.push([n.x, n.y, n.L]);
          }
        }
        return dist;
      },
      /* 全部可走层节点（校验与统计用） */
      walkables() {
        const out = [];
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) for (const l of cells[x][y]) if (isWalk(l)) out.push({ x, y, L: l.h, kind: l.kind, portal: l.portal });
        return out;
      },
      /* 层节点总数（含不可走层） */
      nodeCount() { let n = 0; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) n += cells[x][y].length; return n; },
      /* 静态层要画的「块」：不可走层与高于地面的可走层都算（Stage 1 灰模：h≥1 的台子 + 墙） */
      isBlock(l) { return !isWalk(l) || l.h > 0; }
    };
    return T;
  }

  /* 对外建图：先校验（不合法直接抛错），再建层图 */
  function build(level) {
    validate(level.map);
    /* 出生点身后的 2 格要留给初始蛇身（validate 只看地图，不知道朝向，这里按关卡数据补一道守卫） */
    (level.spawns || []).forEach((s, i) => {
      const d = DIRV[s.dir] || DIRV.downRight;
      for (let k = 1; k <= 2; k++) {
        const x = s.x - d[0] * k, y = s.y - d[1] * k;
        if (!layersOf(level.map[y][x], x, y).some(isWalk)) throw new Error(`terrain.build: 出生点 ${i} (${s.x},${s.y}) 身后第 ${k} 格 (${x},${y}) 不可走——初始蛇身会嵌进墙里`);
      }
    });
    return makeGraph(level.map, level);
  }

  /* ---------- 校验：任何一条不满足就抛错，绝不静默补齐 ---------- */
  function validate(rows) {
    const bad = m => { throw new Error('terrain.validate: ' + m); };
    if (!Array.isArray(rows) || !rows.length) bad('地图为空');
    const h = rows.length, w = rows[0].length;
    if (w < 3 || h < 3) bad(`地图太小（${w}×${h}）`);
    rows.forEach((r, y) => { if (typeof r !== 'string' || r.length !== w) bad(`第 ${y} 行长度 ${r && r.length} ≠ ${w}（每行必须等长）`); });

    /* 逐字符先过一遍：未知字符与未实现字符直接抛（layersOf 负责） */
    const spawns = { '@': [], '$': [] };
    const portals = new Map();
    let cells2 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x], ls = layersOf(ch, x, y);
      if (ls.length > 2) bad(`(x=${x},y=${y}) 层数 ${ls.length} > 2`);
      cells2++;
      if (ch === '@' || ch === '$') spawns[ch].push({ x, y });
      const p = ls.find(l => l.portal);
      if (p) { const k = p.portal; if (!portals.has(k)) portals.set(k, []); portals.get(k).push({ x, y }); }
      /* 桥/台子：有 deck 必须有下层 */
      if (ls.some(l => l.kind === 'deck') && ls.length < 2) bad(`(x=${x},y=${y}) 桥面缺少下层`);
      /* 层高序 */
      for (let i = 1; i < ls.length; i++) if (ls[i].h <= ls[i - 1].h) bad(`(x=${x},y=${y}) 层未按 h 升序`);
    }
    if (spawns['@'].length !== 1) bad(`P1 出生点 '@' 必须恰好 1 个（当前 ${spawns['@'].length}）`);
    if (spawns['$'].length !== 1) bad(`P2 出生点 '$' 必须恰好 1 个（当前 ${spawns['$'].length}）`);

    /* 四周封闭：边界格不得有可走层 */
    const walkRow = (x, y) => layersOf(rows[y][x], x, y).some(isWalk);
    for (let x = 0; x < w; x++) { if (walkRow(x, 0) || walkRow(x, h - 1)) bad(`边界未封闭（第 ${walkRow(x, 0) ? 0 : h - 1} 行 x=${x} 可走）`); }
    for (let y = 0; y < h; y++) { if (walkRow(0, y) || walkRow(w - 1, y)) bad(`边界未封闭（x=${walkRow(0, y) ? 0 : w - 1} 列 y=${y} 可走）`); }

    /* 出生点必须有 3 格直线跑道（任一方向） */
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const ch of ['@', '$']) {
      const s = spawns[ch][0];
      const ok = dirs.some(([dx, dy]) => {
        for (let i = 1; i <= 3; i++) {
          const x = s.x + dx * i, y = s.y + dy * i;
          if (x < 0 || y < 0 || x >= w || y >= h) return false;
          if (!layersOf(rows[y][x], x, y).some(isWalk)) return false;
        }
        return true;
      });
      if (!ok) bad(`${ch} 出生点 (${s.x},${s.y}) 没有 3 格直线跑道`);
    }

    /* 传送门成对且两端可走 */
    for (const [k, list] of portals) {
      if (list.length !== 2) bad(`传送门 '${k}' 必须恰好两端（当前 ${list.length}）`);
      list.forEach(({ x, y }) => { if (!layersOf(rows[y][x], x, y).some(isWalk)) bad(`传送门 '${k}' 的 (${x},${y}) 不可走`); });
    }

    /* 可达性：用与玩法同一套选层规则建层图，全部可走层节点必须从某个出生点可达 */
    const probe = makeGraph(rows, { id: 'probe', name: 'probe', biome: 'grey', map: rows, spawns: [{ x: spawns['@'][0].x, y: spawns['@'][0].y, dir: 'downRight' }], rulesetVersion: 1 });
    const seen = new Set();
    const s0 = probe.topWalk(spawns['@'][0].x, spawns['@'][0].y);
    for (const [k, dist] of probe.reachable(spawns['@'][0].x, spawns['@'][0].y, s0.h)) { seen.add(k); }
    const unreachable = probe.walkables().filter(n => !seen.has(probe.key(n.x, n.y, n.L)));
    if (unreachable.length) {
      const u = unreachable[0];
      bad(`有 ${unreachable.length} 个可走层节点从 P1 出生点不可达（例如 x=${u.x},y=${u.y},L=${u.L},kind=${u.kind}）`);
    }
    return { w, h, nodes: probe.nodeCount(), walkable: probe.walkables().length };
  }

  Snake.Terrain = { build, validate, layersOf };
})();