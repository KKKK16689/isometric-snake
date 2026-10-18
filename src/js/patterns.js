/* patterns.js —— 地板图案注册表（纯函数；由 render 的 paintBoard 在离屏缓存里调用，每帧零成本）
   新增图案 = PAT 加一个函数 + 主题数据写 pattern id；核心/render 零改动。查无 id 静默 no-op。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const K = Snake.K, fr = K.fr;
  function pulse(c, cx, cy, p, x, y) { // 霓虹夜：脉冲网格
    if ((x * 7 + y * 13) % 5) return;
    c.strokeStyle = K.rgba(p.glow, .35); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy - K.HH * .45); c.lineTo(cx + K.HW * .45, cy); c.lineTo(cx, cy + K.HH * .45); c.lineTo(cx - K.HW * .45, cy); c.closePath(); c.stroke();
    c.fillStyle = K.rgba(p.glow, .5); c.fillRect(cx - 1, cy - 1, 2, 2);
  }
  function ice(c, cx, cy, p, x, y) { // 冰川：裂纹
    if (fr(x * 3 + y * 5 + 1) <= .6) return;
    const a = fr(x * 5 + y * 7 + 2) * 6.283;
    c.strokeStyle = K.rgba(p.glow, .3); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * K.HW * .8, cy + Math.sin(a) * K.HH * .8);
    c.lineTo(cx + (fr(x + y * 2) - .5) * 6, cy + (fr(x * 2 + y) - .5) * 4); c.lineTo(cx, cy); c.stroke();
  }
  function circuit(c, cx, cy, p, x, y) { // 赛博：电路走线+节点
    if ((x + y) % 4) return;
    c.strokeStyle = K.rgba(p.glow, .35); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - K.HW * .8, cy); c.lineTo(cx, cy); c.lineTo(cx, cy - K.HH * .8); c.stroke();
    c.fillStyle = K.rgba(p.glow, .5); c.fillRect(cx - 1, cy - 1, 2, 2);
  }
  function sprinkle(c, cx, cy, p, x, y) { // 糖果：糖粒短棒
    for (let i = 0; i < 3; i++) {
      const s = x * 11 + y * 17 + i * 5;
      const bx = cx + (fr(s) - .5) * K.HW * 1.2, by = cy + (fr(s + 1) - .5) * K.HH * 1.2;
      const a = fr(s + 2) * 3.14, len = 2 + fr(s + 3) * 2;
      c.strokeStyle = K.rgba(i % 2 ? p.spark : p.food, .35); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len * .5); c.stroke();
    }
  }
  function moss(c, cx, cy, p, x, y) { // 森林：苔藓斑
    const n = 4 + Math.floor(fr(x * 13 + y * 7) * 3);
    c.fillStyle = K.rgba(p.spark, .3);
    for (let i = 0; i < n; i++) { const s = x * 7 + y * 11 + i * 3; c.fillRect(cx + (fr(s) - .5) * K.HW * 1.4, cy + (fr(s + 1) - .5) * K.HH * 1.4, 1.5, 1.5); }
  }
  function ember(c, cx, cy, p, x, y) { // 熔岩：余烬裂
    c.strokeStyle = K.rgba(p.glow, .3); c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - K.HW * .7, cy + (fr(x + y) - .5) * 4);
    c.lineTo(cx - K.HW * .2, cy + (fr(x * 3 + y) - .5) * 5);
    c.lineTo(cx + K.HW * .3, cy + (fr(x + y * 3) - .5) * 5);
    c.lineTo(cx + K.HW * .7, cy + (fr(x * 2 + y * 2) - .5) * 4); c.stroke();
    if (fr(x * 5 + y * 9) > .7) { c.fillStyle = K.rgba(p.food, .5); c.fillRect(cx - 1, cy - 1, 2, 2); }
  }
  function ripple(c, cx, cy, p, x, y) { // 沙漠：沙纹同心弧（下半）
    c.strokeStyle = K.rgba(p.glow, .25); c.lineWidth = 1;
    [.3, .6].forEach(k => { c.beginPath(); c.moveTo(cx - K.HW * k, cy); c.lineTo(cx, cy + K.HH * k); c.lineTo(cx + K.HW * k, cy); c.stroke(); });
  }
  const PAT = { pulse, ice, circuit, sprinkle, moss, ember, ripple };
  Snake.Patterns = { draw: (id, c, cx, cy, p, x, y) => { const f = PAT[id]; if (f) f(c, cx, cy, p, x, y); } };
})();
