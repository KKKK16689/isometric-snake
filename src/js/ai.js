/* ai.js —— 敌方蛇控制决策（洪水填充 + 危险回避）。原样迁移，不改算法。 */
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
  function aiScan(blocked, sx, sy) { // 洪水填充：空间大小 + 最近食物距离
    const seen = new Set([cellKey(sx, sy)]), q = [[sx, sy, 0]]; let fd = 1e9;
    for (let i = 0; i < q.length; i++) {
      const [x, y, d] = q[i];
      if (fd === 1e9 && S.foods.some(f => f.x === x && f.y === y)) fd = d;
      for (const dd of DLIST) {
        const nx = x + dd[0], ny = y + dd[1], k = cellKey(nx, ny);
        if (nx < 0 || ny < 0 || nx >= S.N || ny >= S.N || blocked.has(k) || seen.has(k)) continue;
        seen.add(k); q.push([nx, ny, d + 1]);
      }
    }
    return { area: q.length, fd };
  }
  function think(p, idx) { // 每 tick 调用：挑最安全且趋向食物的走法，并决策冲刺
    const lv = AI_LV[aiLevel], h = p.body[0], blocked = new Set(), risky = new Set();
    S.pl.forEach(q => q.body.forEach((s, k) => { if (k === q.body.length - 1 && q.body.length > 1) return; blocked.add(cellKey(s.x, s.y)); })); // 对手尾巴即将让位
    S.pl.forEach((q, j) => { if (j !== idx && !q.dead) DLIST.forEach(d => risky.add(cellKey(q.body[0].x + d[0], q.body[0].y + d[1]))); }); // 对手蛇头可能落点
    const moves = DLIST.filter(d => !(d[0] + p.dir[0] === 0 && d[1] + p.dir[1] === 0)).map(d => {
      const x = h.x + d[0], y = h.y + d[1], k = cellKey(x, y);
      if (x < 0 || y < 0 || x >= S.N || y >= S.N || blocked.has(k)) return null;
      const s = aiScan(blocked, x, y), roomy = s.area >= p.body.length + 3; // 绝不钻进逃不出的口袋
      return { d, s, score: (roomy ? 1000 - Math.min(s.fd, 500) : s.area) - (risky.has(k) ? 60 : 0) };
    }).filter(Boolean);
    if (!moves.length) return;
    let pick = moves.sort((a, b) => b.score - a.score)[0];
    if (Math.random() < lv.err) pick = moves[Math.floor(Math.random() * moves.length)];
    p.queue = [pick.d];
    p.hold = lv.sprint && pick.s.fd <= lv.near && p.energy > lv.minE && !p.locked;
  }
  function init() {
    Snake.hooks.think = think;
    document.getElementById('aiLv').addEventListener('click', e => {
      aiLevel = (aiLevel + 1) % AI_LV.length;
      e.currentTarget.textContent = 'AI ' + AI_LV[aiLevel].name;
      e.currentTarget.blur();
    });
  }
  Snake.Ai = { init };
})();