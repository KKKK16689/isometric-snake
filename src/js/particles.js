/* particles.js —— 固定容量对象池粒子（容量 256，超限覆盖最旧，零 GC 压力）
   只听 bus 事件出特效，不改游戏状态；绘制由 render 每帧调用。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const S = Snake.S, K = Snake.K, bus = Snake.bus;
  const CAP = 256;
  const pool = Array.from({ length: CAP }, () => ({ alive: false, x: 0, y: 0, vx: 0, vy: 0, g: 90, age: 0, life: 1, size: 2, col: '#fff', spin: 4, rot: 0, damp: .99 }));
  let head = 0; // 环写：满了覆盖最旧

  function spawn(o) {
    const p = pool[head]; head = (head + 1) % CAP;
    p.alive = true; p.age = 0; p.rot = 0;
    p.x = o.x; p.y = o.y; p.vx = o.vx; p.vy = o.vy; p.life = o.life;
    p.size = o.size || 2; p.col = o.col; p.g = o.g === undefined ? 90 : o.g;
    p.spin = o.spin || 4; p.damp = o.damp || .99;
  }
  const pal = () => Snake.theme.current.canvas;
  const at = (x, y) => { const [sx, sy] = K.P(x, y); return [sx, sy + K.HH - 6]; };
  function scatter(cx, cy, n, cols, up, spd) { // 中心散射：up 越大越向上，spd 为速度基数
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = spd * (.4 + Math.random() * .6);
      spawn({ x: cx + (Math.random() - .5) * 6, y: cy + (Math.random() - .5) * 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6 - up * (.5 + Math.random() * .5), life: .5 + Math.random() * .4, col: cols[K.rand(cols.length)], size: 2 + Math.random() * 1.5 });
    }
  }
  /* ---------- 事件 → 效果（lowFx 降级表见 spec §2.2） ---------- */
  bus.on('eat', e => { // 吃食爆炸：food+spark 色；lowFx 减半
    const c = pal(), [cx, cy] = at(e.x, e.y);
    scatter(cx, cy, S.lowFx ? 6 : 12, e.pk ? ['#ffffff', '#cbd5e1', '#94a3b8'] : [c.food, K.shades(c.food)[0], c.spark], 60, 55);
  });
  bus.on('crash', e => { // 撞击火花：lowFx 减半
    const c = pal(), cols = [c.spark, '#ffffff', K.shades(c.spark)[2]];
    (e.heads || []).forEach(h => { const [cx, cy] = at(h.x, h.y); scatter(cx, cy, S.lowFx ? 10 : 20, cols, 90, 75); });
  });
  bus.on('win', () => { // 对战获胜烟花：3 轮 × 14 粒；lowFx 1 轮
    const c = pal(), cols = [c.spark, K.shades(c.spark)[0], K.shades(c.spark)[2], c.food, K.shades(c.food)[0]];
    const rounds = S.lowFx ? 1 : 3;
    for (let r = 0; r < rounds; r++) setTimeout(() => scatter(S.W / 2, S.H / 2 - 24 - r * 12, 14, cols, 110 + r * 35, 85 + r * 20), r * 320);
  });
  /* 冲刺拖尾：render 每帧对冲刺中的蛇调用（限速约 20 粒/秒；lowFx 关闭，保留电弧） */
  const acc = [0, 0];
  function trail(p, i, dt) {
    if (S.lowFx) return;
    acc[i] += dt;
    while (acc[i] > .05) {
      acc[i] -= .05;
      const t = p.body[p.body.length - 1];
      if (!t) return;
      const [cx, cy] = at(t.x, t.y);
      spawn({ x: cx + (Math.random() - .5) * 4, y: cy, vx: (Math.random() - .5) * 10, vy: -6 - Math.random() * 12, life: .3, size: 2, col: pal().spark, g: 20, spin: 0 });
    }
  }
  function update(dt) {
    for (let i = 0; i < CAP; i++) {
      const p = pool[i]; if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= p.damp; p.rot += p.spin * dt;
    }
  }
  function draw(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < CAP; i++) {
      const p = pool[i]; if (!p.alive) continue;
      const a = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = K.rgba(p.col, a.toFixed(2));
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  Snake.Fx = { spawn, trail, update, draw };
})();