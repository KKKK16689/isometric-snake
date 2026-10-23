/* core.js —— 游戏规则与状态（唯一真相）
   约束：不碰 DOM / CSS / 音频 / 粒子 / 绘制；对表现层只通过 bus 事件与只读状态 S 通信。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  const K = {
    TW: 30, TH: 15,
    get HW() { return K.TW / 2; },
    get HH() { return K.TH / 2; },
    OY: 34,
    MODES: {
      easy:   { n: 12, start: 220, min: 120, accel: 3, lives: 3, players: 1, foods: 1 },
      normal: { n: 12, start: 150, min: 70,  accel: 4, lives: 1, players: 1, foods: 1 },
      pk:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3 },
      ai:     { n: 18, start: 160, min: 100, accel: 2, lives: 1, players: 2, foods: 3, ai: true }
    },
    /* 皮肤：玩家身份标识，不随主题变化 */
    SK: [
      { name: '青绿', body: ['#5DCAA5', '#1D9E75', '#0F6E56'], head: ['#E1F5EE', '#5DCAA5', '#1D9E75'] },
      { name: '天蓝', body: ['#85B7EB', '#378ADD', '#185FA5'], head: ['#E6F1FB', '#85B7EB', '#378ADD'] },
      { name: '紫', body: ['#AFA9EC', '#7F77DD', '#534AB7'], head: ['#EEEDFE', '#AFA9EC', '#7F77DD'] },
      { name: '琥珀', body: ['#FAC775', '#EF9F27', '#BA7517'], head: ['#FAEEDA', '#FAC775', '#EF9F27'] },
      { name: '粉', body: ['#F4C0D1', '#D4537E', '#993556'], head: ['#FBEAF0', '#ED93B1', '#D4537E'] },
      { name: '灰', body: ['#D3D1C7', '#888780', '#5F5E5A'], head: ['#F1EFE8', '#B4B2A9', '#888780'] }
    ],
    SPRINT_HEAD: ['#DCEBFF', '#7DB8FF', '#3B82F6'],   // 冲刺时蛇头配色（固定）
    DEAD: ['#F7C1C1', '#E24B4A', '#A32D2D'],
    FOOD: ['#F0997B', '#D85A30', '#993C1D'],
    FOOD_PK: ['#FFFFFF', '#CBD5E1', '#94A3B8'],
    /* 格坐标方向（等距屏上视角） */
    DIRS: { upRight: [0, -1], downRight: [1, 0], downLeft: [0, 1], upLeft: [-1, 0] },
    /* 屏幕方向 → 两个候选格方向；steer() 挑能转弯的那个 */
    SCREEN: {
      up:    [[0, -1], [1, 0]], down: [[0, 1], [-1, 0]],
      left:  [[-1, 0], [0, -1]], right: [[1, 0], [0, 1]]
    },
    /* 集中调参表：散在各模块的魔法数收拢于此（平衡性迭代 / 文档 / 测试共用） */
    TUNE: {
      lowFxOn: .032, lowFxOff: .020, lowFxRecover: 120  // render 帧耗时 EMA：超过 on 降级，低于 off 连续 recover 帧恢复
    }
  };

  /* ---------- 状态（唯一真相，其他模块只读；写入仅经 api） ---------- */
  const S = {
    N: 12, W: 380, H: 240, OX: 190,
    lowFx: false, frameDt: .016,        // lowFx 由 render 检测并写入
    mode: 'easy', pl: [], foods: [], state: 'ready', msg: '', last: 0,
    best: 0, wins: [0, 0], winner: -1, tickN: 0, overAt: 0, skin: [0, 1], fxGood: 0
  };

  /* ---------- 事件总线 ---------- */
  const bus = (() => {
    const m = {};
    return {
      on(ev, fn) { (m[ev] = m[ev] || []).push(fn); },
      off(ev, fn) { if (m[ev]) m[ev] = m[ev].filter(f => f !== fn); },
      emit(ev, d) { (m[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error('[bus]', ev, e); } }); }
    };
  })();

  /* ---------- 纯函数工具 ---------- */
  const rand = n => Math.floor(Math.random() * n);
  const safeGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const nm = i => (K.MODES[S.mode].ai ? (i ? 'AI' : '你') : 'P' + (i + 1));
  /* 等距投影：格 (x,y) 顶点的屏幕坐标 */
  const P = (x, y) => [S.OX + (x - y) * K.HW, K.OY + (x + y) * K.HH];
  /* 廉价种子随机（闪电用） */
  const fr = s => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };
  /* hex → rgba 字符串 */
  const rgba = (h, a) => 'rgba(' + parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16) + ',' + a + ')';
  /* 由主色派生立方体 [亮, 中, 暗] 三面（食物/发光体用） */
  const shades = (hex, up = .35, down = .45) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const hx = n => '#' + n.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
    return [hx(c.map(v => v + (255 - v) * up)), hex, hx(c.map(v => v * (1 - down)))];
  };

  /* ---------- 游戏逻辑 ---------- */
  function setSize(n) {
    S.N = n; S.W = n * K.TW + 20; S.H = n * K.TH + K.OY + 12; S.OX = S.W / 2;
    bus.emit('resize', { n });           // render 监听并同步 canvas 尺寸
  }
  const bestKey = () => 'iso-snake-best-' + S.mode;
  function loadBest() { S.best = +safeGet(bestKey(), 0) || 0; }
  function spawn(i, p) {
    const two = K.MODES[S.mode].players === 2;
    const y = two ? (i ? S.N - 5 : 4) : 6, xs = two ? (i ? [S.N - 5, S.N - 4, S.N - 3] : [4, 3, 2]) : [3, 2, 1];
    p.body = xs.map(x => ({ x, y })); p.dir = i ? K.DIRS.upLeft : K.DIRS.downRight; p.queue = []; p.dead = false;
  }
  function fillFoods() { // 空格列表取样（拒绝采样在长局会退化，满盘时无解）；无处可放 → 满盘结算
    const want = K.MODES[S.mode].foods;
    if (S.foods.length >= want) return;
    const taken = new Set();
    S.pl.forEach(p => p.body.forEach(s => taken.add(s.x * 1024 + s.y)));
    S.foods.forEach(f => taken.add(f.x * 1024 + f.y));
    const free = [];
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) if (!taken.has(x * 1024 + y)) free.push({ x, y });
    while (S.foods.length < want) {
      if (!free.length) { boardFull(); return; }
      const k = rand(free.length);
      S.foods.push(free[k]); free.splice(k, 1);
    }
  }
  function boardFull() { // 棋盘被蛇填满：单人视为获胜，双人判平局
    S.state = 'over'; S.overAt = performance.now();
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0]; S.msg = '棋盘填满 · ' + p.score + ' 分';
      if (p.score > S.best) { S.best = p.score; safeSet(bestKey(), S.best); }
      bus.emit('win', { winner: 0, full: true });
    } else {
      S.winner = -1; S.msg = '棋盘填满 · 平局';
      bus.emit('win', { winner: -1, full: true });
    }
    bus.emit('hud');
  }
  function newGame() {
    const m = K.MODES[S.mode]; setSize(m.n);
    S.tickN = 0; S.lowFx = false; S.frameDt = .016; S.fxGood = 0;
    S.pl = [...Array(m.players)].map((_, i) => {
      const p = { score: 0, lives: m.lives, energy: 100, locked: false, hold: false, sprint: false, trail: [], streak: 0, ai: !!m.ai && i === 1 };
      spawn(i, p); return p;
    });
    S.foods = []; fillFoods(); S.state = 'ready'; S.msg = ''; S.winner = -1;
    bus.emit('hud'); bus.emit('gameStart');
  }
  function turn(p, d) {
    const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    if (d[0] === ref[0] && d[1] === ref[1]) return;
    if (d[0] + ref[0] === 0 && d[1] + ref[1] === 0) return;
    if (p.queue.length < 2) p.queue.push(d);
  }
  function steer(p, name) {
    const ref = p.queue.length ? p.queue[p.queue.length - 1] : p.dir;
    const [c1, c2] = K.SCREEN[name];
    const same = c => c[0] === ref[0] && c[1] === ref[1];
    if (same(c1) || same(c2)) return;
    turn(p, same([-c1[0], -c1[1]]) ? c2 : c1);
  }
  function step() {
    S.tickN++;
    S.pl.forEach((p, i) => { if (p.ai && !p.dead && Snake.hooks.think) Snake.hooks.think(p, i); });
    const dt = tickMs() / 1000;
    S.pl.forEach((p, i) => {   // 冲刺耗能 / 恢复；能量归零锁定到 30
      const was = p.sprint;
      const want = p.hold && p.energy > 0 && !p.locked;
      if (want && !p.sprint) bus.emit('sprintOn', { i });
      p.sprint = want;
      if (want) { p.energy = Math.max(0, p.energy - 45 * dt); if (p.energy === 0) { p.locked = true; p.sprint = false; bus.emit('sprintLock', { i }); } }
      else { p.energy = Math.min(100, p.energy + 18 * dt); if (p.locked && p.energy >= 30) p.locked = false; }
      if (!p.sprint && was) bus.emit('sprintOff', { i });
    });
    const mv = S.pl.map(p => p.sprint || S.tickN % 2 === 0); // 冲刺每 tick 动，平时隔 tick
    const hs = S.pl.map((p, i) => { if (!mv[i]) return null; if (p.queue.length) p.dir = p.queue.shift(); return { x: p.body[0].x + p.dir[0], y: p.body[0].y + p.dir[1] }; });
    const eat = hs.map(h => h ? S.foods.findIndex(f => f.x === h.x && f.y === h.y) : -1);
    const hit = hs.map((h, i) => {
      if (!h) return false;
      if (h.x < 0 || h.y < 0 || h.x >= S.N || h.y >= S.N) return true;
      if (hs.some((o, j) => j !== i && o && o.x === h.x && o.y === h.y)) return true; // 对头相撞
      return S.pl.some((q, j) => (mv[j] && eat[j] < 0 ? q.body.slice(0, -1) : q.body).some(s => s.x === h.x && s.y === h.y));
    });
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0];
      if (hit[0]) {
        p.lives--; p.streak = 0;
        if (p.lives > 0) { spawn(0, p); S.state = 'paused'; S.msg = '撞到了！还剩 ' + p.lives + ' 条命'; bus.emit('hud'); }
        else gameOver();
        return;
      }
    } else if (hit.some(Boolean)) { hit.forEach((h, i) => S.pl[i].dead = h); gameOver(); return; }
    S.pl.forEach((p, i) => {
      if (!hs[i]) return;
      if (p.sprint) { p.trail.push({ x: p.body[0].x, y: p.body[0].y, b: performance.now() }); if (p.trail.length > 14) p.trail.shift(); }
      p.body.unshift(hs[i]);
      if (eat[i] >= 0) { p.score++; p.streak++; bus.emit('eat', { x: S.foods[eat[i]].x, y: S.foods[eat[i]].y, pk: K.MODES[S.mode].players === 2, streak: p.streak, i }); }
      else p.body.pop();
    });
    const eaten = new Set(eat.filter(k => k >= 0));
    S.foods = S.foods.filter((_, k) => !eaten.has(k)); fillFoods();
    bus.emit('hud');
  }
  function gameOver() {
    S.state = 'over'; S.overAt = performance.now();
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0]; p.dead = true;
      if (p.score > S.best) { S.best = p.score; safeSet(bestKey(), S.best); }
      bus.emit('lose', { i: 0 });
    } else {
      const alive = S.pl.map((p, i) => p.dead ? -1 : i).filter(i => i >= 0);
      S.winner = alive.length === 1 ? alive[0] : -1;
      if (S.winner >= 0) S.wins[S.winner]++;
      bus.emit('win', { winner: S.winner });
    }
    const heads = S.pl.filter(p => p.dead).map(p => ({ x: p.body[0].x, y: p.body[0].y }));
    bus.emit('crash', { heads });
    bus.emit('hud');
  }
  const interval = () => { const m = K.MODES[S.mode]; return Math.max(m.min, m.start - S.pl.reduce((a, p) => a + p.score, 0) * m.accel); };
  const tickMs = () => interval() / 2; // 一次普通移动 = 两个 tick（冲刺可每 tick 移动）

  /* ---------- 状态机 api ---------- */
  function start() { if (S.state === 'over') { if (performance.now() - S.overAt < 1200) return; newGame(); } S.state = 'playing'; S.msg = ''; S.last = performance.now(); } // 结算界面 1.2s 锁，防连点跳过
  function togglePause() { if (S.state === 'playing') { S.state = 'paused'; S.msg = ''; } else start(); }
  function press(i, name) { if (S.state !== 'playing') { start(); if (S.state !== 'playing') return; } if (S.pl[i]) steer(S.pl[i], name); }
  const setHold = (i, v) => { if (S.pl[i]) S.pl[i].hold = v; };
  function setMode(m) { S.mode = m; S.wins = [0, 0]; loadBest(); newGame(); bus.emit('hud'); }
  function setSkin(p, k) { S.skin[p] = k; bus.emit('hud'); }
  /* render 每帧调用：追赶式 tick（帧率无关），一帧最多补 3 步 */
  function update(t) {
    if (S.state === 'playing') {
      let n = 0;
      while (S.state === 'playing' && t - S.last >= tickMs() && n++ < 3) { S.last += tickMs(); step(); }
      if (t - S.last > 400) S.last = t;
    }
  }

  const qs = new URLSearchParams(location.search);   // 便于截图/直链分享（?theme= ?mode=），mode 仅初始值
  if (qs.get('mode') && K.MODES[qs.get('mode')]) S.mode = qs.get('mode');

  /* 工具注册进 K 供各表现层模块使用（内部仍用裸名） */
  K.rand = rand; K.safeGet = safeGet; K.safeSet = safeSet; K.nm = nm;
  K.P = P; K.fr = fr; K.rgba = rgba; K.shades = shades;

  Snake.K = K; Snake.S = S; Snake.bus = bus;
  Snake.hooks = { think: null };
  Snake.api = { newGame, reset: () => { loadBest(); newGame(); }, start, togglePause, press, setHold, setMode, setSkin, update };
})();