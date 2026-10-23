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
  const AI_LV = [
    { name: '简单', err: .08, sprint: false, near: 0, minE: 100 }, // 偶尔随机安全步，永不冲刺
    { name: '普通', err: .02, sprint: true, near: 6, minE: 50 },
    { name: '困难', err: 0, sprint: true, near: 9, minE: 30 }
  ];
  let aiLevel = 1;
  function think(p, idx) { // 每 tick 调用：挑最安全且趋向食物的走法，并决策冲刺
    const lv = AI_LV[aiLevel], h = p.body[0], blocked = new Set(), risky = new Set();
    S.pl.forEach(q => q.body.forEach((s, k) => { if (k === q.body.length - 1 && q.body.length > 1) return; blocked.add(cellKey(s.x, s.y)); })); // 对手尾巴即将让位
    S.pl.forEach((q, j) => { if (j !== idx && !q.dead) DLIST.forEach(d => risky.add(cellKey(q.body[0].x + d[0], q.body[0].y + d[1]))); }); // 对手蛇头可能落点
    const free = (x, y) => x >= 0 && y >= 0 && x < S.N && y < S.N && !blocked.has(cellKey(x, y));
    /* 多源 BFS：dist = 格→最近食物距离；comp/size = 连通域编号与面积 */
    const dist = new Map(), comp = new Map(), size = new Map();
    let cid = 0;
    const bfs = (sources, withDist) => {
      const id = cid++, q = [];
      for (const s of sources) {
        const k = cellKey(s[0], s[1]);
        if (comp.has(k)) continue;
        comp.set(k, id); if (withDist) dist.set(k, 0); q.push([s[0], s[1], 0]);
      }
      if (!q.length) { cid--; return; }
      size.set(id, 0);
      for (let i = 0; i < q.length; i++) {
        const [x, y, d] = q[i]; size.set(id, size.get(id) + 1);
        for (const dd of DLIST) {
          const nx = x + dd[0], ny = y + dd[1], k = cellKey(nx, ny);
          if (!free(nx, ny) || comp.has(k)) continue;
          comp.set(k, id); if (withDist) dist.set(k, d + 1); q.push([nx, ny, d + 1]);
        }
      }
    };
    bfs(S.foods.map(f => [f.x, f.y]), true);
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) if (free(x, y) && !comp.has(cellKey(x, y))) bfs([[x, y]], false);
    const moves = DLIST.filter(d => !(d[0] + p.dir[0] === 0 && d[1] + p.dir[1] === 0)).map(d => {
      const x = h.x + d[0], y = h.y + d[1], k = cellKey(x, y);
      if (!free(x, y)) return null;
      const area = size.get(comp.get(k)) || 0, fd = dist.has(k) ? dist.get(k) : 1e9;
      const roomy = area >= p.body.length + 3; // 绝不钻进逃不出的口袋
      return { d, fd, area, score: (roomy ? 1000 - Math.min(fd, 500) : area) - (risky.has(k) ? 60 : 0) };
    }).filter(Boolean);
    if (!moves.length) return;
    if (moves.every(m => m.area < p.body.length + 3)) {   // 残局：无处宽松 → 追自己的尾格盘绕求生
      const tail = p.body[p.body.length - 1];
      moves.forEach(m => {
        const x = h.x + m.d[0], y = h.y + m.d[1];
        m.score = 1000 - Math.min(Math.abs(x - tail.x) + Math.abs(y - tail.y), 500) + m.area - (risky.has(cellKey(x, y)) ? 60 : 0);
      });
    }
    let pick = moves.sort((a, b) => b.score - a.score)[0];
    if (Math.random() < lv.err) pick = moves[Math.floor(Math.random() * moves.length)];
    p.queue = [pick.d];
    /* 冲刺竞速：距离场顺手给出对手头→最近食物距离，只有严格比对手早到才烧能量（平局省能量） */
    let hold = lv.sprint && pick.fd <= lv.near && p.energy > lv.minE && !p.locked;
    if (hold) {
      const opp = S.pl[1 - idx];
      if (opp && !opp.dead) {
        const ok = cellKey(opp.body[0].x, opp.body[0].y);
        const ofd = dist.has(ok) ? dist.get(ok) : 1e9;
        hold = pick.fd < ofd;
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
