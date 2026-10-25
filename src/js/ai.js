/* ai.js —— 敌方蛇控制决策。
   v2 算法：每 tick 一次多源 BFS 取代逐候选洪水填充——
   ① 以全部食物为源做多源 BFS，得「格 → 最近食物距离」距离场（无向图，候选格→食物 = 场值，精确）；
   ② 同遍标记连通域并统计域面积（候选格的逃生空间 = 所在域大小，与逐格洪水填充等价）；
   ③ 无食物的连通域再补一遍标记（面积仍精确，距离场记 ∞）。
   残局（所有候选都不 roomy）改追自己的尾格盘绕求生；冲刺改为竞速判定：
   同一距离场顺手给出对手头到最近食物的距离，只有严格比对手早到才烧能量。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K;
  const DLIST = Object.values(K.DIRS);
  const cellKey = (x, y) => x * 1024 + y; // 格哈希；N ≤ 1024 安全
  /* 地形（3D）适配：节点 = 层图节点 (x,y,L)。经典模式一律走 cellKey + 四邻 + 棋盘边界，
     保证 2.0 的 AI 行为与手感一字不变（经典 AI 行为锁就是靠这个前提交付的）。 */
  const key = (x, y, L) => S.T ? S.T.key(x, y, L || 0) : cellKey(x, y);
  const nbrs = (x, y, L) => S.T ? S.T.neighbors(x, y, L || 0) : DLIST.map(d => ({ x: x + d[0], y: y + d[1], L: 0, cost: 1, portal: false }));   // 统一返回 {x,y,L} 对象（地形层图本来就是对象）
  const nodes = () => {   // 遍历全集：经典＝棋盘格（y 外 x 内，与 2.0 的补标记顺序一致）；地形＝层图可走节点
    if (S.T) return S.T.walkables();
    const a = []; for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) a.push({ x, y, L: 0 });
    return a;
  };
  const AI_LV = [
    { name: '简单', err: .08, sprint: false, near: 0, minE: 100, avoid: 0, contest: false },   // 偶尔随机安全步、不冲刺、不避让对手（会跟你抢同一个食物）
    { name: '普通', err: .02, sprint: true, near: 6, minE: 50, avoid: 320, contest: true },     // 少犯错、避开对手蛇头的可达格、抢不过就换目标
    { name: '困难', err: 0, sprint: true, near: 9, minE: 30, avoid: 900, contest: true }        // 不犯错、几乎把对手的可达格当墙、竞速算得清
  ];
  let aiLevel = 1;
  function think(p, idx) { // 每 tick 调用：挑最安全且趋向食物的走法，并决策冲刺
    const lv = AI_LV[aiLevel], h = p.body[0], blocked = new Set(), risky = new Set();
    S.pl.forEach(q => q.body.forEach((s, k) => { if (k === q.body.length - 1 && q.body.length > 1) return; blocked.add(key(s.x, s.y, s.L)); })); // 对手尾巴即将让位
    S.pl.forEach((q, j) => { if (j !== idx && !q.dead) { const o = q.body[0]; nbrs(o.x, o.y, o.L).forEach(n => risky.add(key(n.x, n.y, n.L))); } }); // 对手蛇头可能落点
    const free = (x, y, L) => {   // 经典＝棋盘内且未被占；地形＝该层存在且可走且未被占（层号参与，规格 §3.2）
      if (!S.T) return x >= 0 && y >= 0 && x < S.N && y < S.N && !blocked.has(cellKey(x, y));
      const l = S.T.layerAt(x, y, L || 0);
      return !!l && l.walkable && !blocked.has(S.T.key(x, y, L || 0));
    };
    /* 多源 BFS：dist = 节点→最近食物距离；comp/size = 连通域编号与面积（经典＝棋盘格，地形＝层图节点） */
    const dist = new Map(), comp = new Map(), size = new Map();
    let cid = 0;
    const bfs = (sources, withDist) => {
      const id = cid++, q = [];
      for (const s of sources) {
        const k = key(s[0], s[1], s[2]);
        if (comp.has(k)) continue;
        comp.set(k, id); if (withDist) dist.set(k, 0); q.push([s[0], s[1], s[2] || 0, 0]);
      }
      if (!q.length) { cid--; return; }
      size.set(id, 0);
      for (let i = 0; i < q.length; i++) {
        const [x, y, L, d] = q[i]; size.set(id, size.get(id) + 1);
        for (const n of nbrs(x, y, L)) {
          if (!free(n.x, n.y, n.L)) continue;
          const k = key(n.x, n.y, n.L);
          if (comp.has(k)) continue;
          comp.set(k, id); if (withDist) dist.set(k, d + 1); q.push([n.x, n.y, n.L || 0, d + 1]);
        }
      }
    };
    bfs(S.foods.map(f => [f.x, f.y, f.L || 0]), true);
    for (const n of nodes()) if (free(n.x, n.y, n.L) && !comp.has(key(n.x, n.y, n.L))) bfs([[n.x, n.y, n.L]], false);
    /* 难度阶梯（只在地形模式生效；经典模式沿用 2.0 的固定 60 代价与不竞速，行为一字不变）：
       avoid＝「对手蛇头下一步可达格」的代价，越高越不往对手嘴边凑；contest＝抢不过就别迎头去凑那个食物。 */
    const oppP = S.pl[1 - idx], oh = (oppP && !oppP.dead) ? oppP.body[0] : null;
    const okey = oh ? key(oh.x, oh.y, oh.L) : null;
    const ofd = okey && dist.has(okey) ? dist.get(okey) : 1e9;                                 // 对手头 → 最近食物
    const pen = (S.T && lv.avoid) ? lv.avoid : 60;
    /* 「抢不过就别迎头去凑」：候选格距离 fd ⇒ 我们走上它之后是 fd+1；对手 ≤ fd+1 就是它先到或同到。
       注意不能拿自己的头去查距离场——蛇头属于被占格，不在场里（第一版就栽在这，恒判「抢不过」）。 */
    const loseRace = !!(S.T && lv.contest) && ofd < 1e9;
    const moves = nbrs(h.x, h.y, h.L).filter(n => !(n.x - h.x + p.dir[0] === 0 && n.y - h.y + p.dir[1] === 0)).map(n => {
      const x = n.x, y = n.y, L = n.L || 0, k = key(x, y, L);
      if (!free(x, y, L)) return null;
      const area = size.get(comp.get(k)) || 0, fd = dist.has(k) ? dist.get(k) : 1e9;
      const roomy = area >= p.body.length + 3; // 绝不钻进逃不出的口袋
      return { d: [x - h.x, y - h.y], fd, area, score: (roomy ? 1000 - Math.min(fd, 500) : area) - (risky.has(k) ? pen : 0) - (loseRace && fd + 2 > ofd ? 260 : 0) };
    }).filter(Boolean);
    if (!moves.length) return;
    if (moves.every(m => m.area < p.body.length + 3)) {   // 残局：无处宽松 → 追自己的尾格盘绕求生（地形下用曼哈顿近似）
      const tail = p.body[p.body.length - 1];
      moves.forEach(m => {
        const x = h.x + m.d[0], y = h.y + m.d[1];
        m.score = 1000 - Math.min(Math.abs(x - tail.x) + Math.abs(y - tail.y), 500) + m.area - (risky.has(key(x, y, h.L)) ? pen : 0);
      });
    }
    let pick = moves.sort((a, b) => b.score - a.score)[0];
    if (Math.random() < lv.err) pick = moves[Math.floor(Math.random() * moves.length)];
    p.queue = [pick.d];
    /* 冲刺竞速：距离场顺手给出对手头→最近食物距离。规格 §5 要求按速度折算（冲刺 1 格/tick、常速
       0.5 格/tick ⇒ 常速每格 2 tick）；经典模式保持 2.0 的原始判据，不吃这次调整。 */
    let hold = lv.sprint && pick.fd <= lv.near && p.energy > lv.minE && !p.locked;
    /* 地形（3D）里 AI 不烧能量冲刺：冲刺＝双倍速度扑向食物，而 3D 地图通道窄、食物少，两条蛇常常盯同一颗，
       实测（每档 15 局、双方 AI）冲刺让普通/困难档的中位存活从 60/76 tick 掉到 34/18 tick——观感就是「人机秒死」。
       经典模式不受影响，仍按 2.0 的原始判据烧能量。 */
    if (S.T) hold = false;
    if (hold) {
      const opp = S.pl[1 - idx];
      if (opp && !opp.dead) {
        const o = opp.body[0], ok = key(o.x, o.y, o.L);
        const ofd = dist.has(ok) ? dist.get(ok) : 1e9;
        hold = S.T ? (pick.fd < ofd * (opp.sprint ? 1 : 2)) : (pick.fd < ofd);
      }
    }
    p.hold = hold;
  }
  function init() {
    Snake.hooks.think = think;
    document.getElementById('aiLv').addEventListener('click', e => {
      aiLevel = (aiLevel + 1) % AI_LV.length;
      e.currentTarget.textContent = 'AI ' + AI_LV[aiLevel].name;
      e.currentTarget.blur();
    });
  }
  Snake.Ai = { init, think, setLevel: v => { aiLevel = Math.min(AI_LV.length - 1, Math.max(0, v | 0)); }, levels: AI_LV.map(l => l.name) };   // think/setLevel 导出：无头测试可绕过 DOM 直接驱动
})();
