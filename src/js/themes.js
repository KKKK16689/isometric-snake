/* themes.js —— 主题注册表（纯数据驱动）+ 应用/切换/持久化
   新增主题 = 在 LIST 里追加一个对象；其余逻辑零改动。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const K = Snake.K, bus = Snake.bus;
  const KEY = 'snake.theme', DEF = 'neon-night';

  /* css: 7 个 UI 变量覆盖值；canvas: 8 色渲染调色板（render.js 只读） */
  const LIST = [
    { id: 'neon-night', name: '霓虹夜', css: { bg: '#060a14', fg: '#e6ecff', muted: '#7f8fb5', f1: '#0a1122', f2: '#0c142a', edge: '#1b2a55', btn: '#0d1530' },
      canvas: { floorTop: '#0d1528', floorLeft: '#0a1122', floorRight: '#080d1d', grid: 'rgba(80,220,255,.18)', glow: '#3b82f6', food: '#ff7a45', star: '#cdd9ff', spark: '#3b82f6' }, pattern: 'pulse' },
    { id: 'glacier', name: '冰川', css: { bg: '#eef6fa', fg: '#16324a', muted: '#5e7d93', f1: '#dbeef6', f2: '#cfe6f1', edge: '#aec9d9', btn: '#ffffff' },
      canvas: { floorTop: '#e2f1f8', floorLeft: '#d3e9f3', floorRight: '#c5e0ec', grid: 'rgba(56,189,248,.22)', glow: '#38bdf8', food: '#ff6b6b', star: null, spark: '#38bdf8' }, pattern: 'ice' },
    { id: 'cyber', name: '赛博', css: { bg: '#0d0221', fg: '#f5e6ff', muted: '#8f7bb0', f1: '#150534', f2: '#190741', edge: '#3b1e6e', btn: '#17053c' },
      canvas: { floorTop: '#1c0742', floorLeft: '#17053a', floorRight: '#140434', grid: 'rgba(232,121,249,.20)', glow: '#e879f9', food: '#facc15', star: '#b78cff', spark: '#e879f9' }, pattern: 'circuit' },
    { id: 'candy', name: '糖果', css: { bg: '#fff5f9', fg: '#5c2b43', muted: '#b07a92', f1: '#ffe4ee', f2: '#ffd9e7', edge: '#f3bcd2', btn: '#ffffff' },
      canvas: { floorTop: '#ffe7f1', floorLeft: '#ffd9ea', floorRight: '#f9cfe2', grid: 'rgba(236,72,153,.20)', glow: '#ec4899', food: '#22c55e', star: null, spark: '#ec4899' }, pattern: 'sprinkle' },
    { id: 'lava', name: '熔岩', css: { bg: '#160707', fg: '#ffe2d6', muted: '#b08678', f1: '#200c0c', f2: '#251010', edge: '#57201c', btn: '#280f0d' },
      canvas: { floorTop: '#2c1411', floorLeft: '#260f0d', floorRight: '#210c0b', grid: 'rgba(249,115,22,.22)', glow: '#f97316', food: '#fbbf24', star: '#ffb199', spark: '#fb923c' }, pattern: 'ember' },
    { id: 'forest', name: '森林', css: { bg: '#0c1610', fg: '#ddf5e6', muted: '#7fa98f', f1: '#0f1f15', f2: '#12251a', edge: '#1f4a33', btn: '#122619' },
      canvas: { floorTop: '#172c20', floorLeft: '#13251a', floorRight: '#101f16', grid: 'rgba(16,185,129,.22)', glow: '#10b981', food: '#f59e0b', star: '#bfe8d2', spark: '#34d399' }, pattern: 'moss' },
    { id: 'desert', name: '沙漠', css: { bg: '#faf3e4', fg: '#4a3620', muted: '#9d8a6b', f1: '#f5e8cd', f2: '#efdfc0', edge: '#dcc9a3', btn: '#fffaf0' },
      canvas: { floorTop: '#f5e7ca', floorLeft: '#eeddbb', floorRight: '#e6d2ab', grid: 'rgba(245,158,11,.25)', glow: '#f59e0b', food: '#dc2626', star: null, spark: '#fbbf24' }, pattern: 'ripple' }
  ];

  const byId = id => LIST.find(t => t.id === id) || null;
  let current = byId(DEF), dots = [];

  function apply(id, persist) {
    const t = byId(id) || byId(DEF);
    if (!t) { console.warn('[themes] 非法主题 id:', id); return; }
    current = t;
    const s = document.documentElement, v = { '--bg': t.css.bg, '--fg': t.css.fg, '--muted': t.css.muted, '--f1': t.css.f1, '--f2': t.css.f2, '--edge': t.css.edge, '--btn': t.css.btn };
    Object.keys(v).forEach(k => s.style.setProperty(k, v[k]));       // 覆盖 base.css 默认变量
    s.dataset.theme = t.id;
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t.css.bg);
    if (persist) K.safeSet(KEY, t.id);
    dots.forEach(d => d.classList.toggle('on', d.dataset.th === t.id));
    bus.emit('themeChange', { id: t.id });
  }

  function init() { // 渲染主题色点行（模式栏下），并应用记忆/URL 主题
    const bar = document.querySelector('.th');
    if (bar) {
      bar.innerHTML = '';
      LIST.forEach(t => {
        const b = document.createElement('button');
        b.className = 'dot'; b.dataset.th = t.id; b.style.background = t.css.bg;
        b.title = t.name; b.setAttribute('aria-label', '主题 ' + t.name);
        b.addEventListener('click', () => { b.blur(); apply(t.id, true); });
        bar.appendChild(b); dots.push(b);
      });
    }
    const qs = new URLSearchParams(location.search).get('theme');
    const init = byId(qs) ? qs : (byId(K.safeGet(KEY, DEF)) ? K.safeGet(KEY, DEF) : DEF);
    apply(qs ? qs : init, !qs);              // ?theme= 仅本次生效，不覆盖记忆
  }

  Snake.theme = { list: LIST, get current() { return current; }, apply, init };
})();