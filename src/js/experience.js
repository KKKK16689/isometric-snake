/* experience.js — 主页、路线进度与独立方向练习；不写入蛇身或修改规则。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const { S, K, api, bus } = Snake, $ = id => document.getElementById(id);
  let panel = null, page = '', training = 0, tx = 3, ty = 3, holdTimer = 0, lastState = '', hudAt = 0;
  const steps = ['up', 'right', 'down', 'left'];
  const arrows = { up: '↗', right: '↘', down: '↙', left: '↖' };
  const keyNames = { up: '↑ / W', right: '→ / D', down: '↓ / S', left: '← / A' };
  const keyDir = { ArrowUp: 'up', KeyW: 'up', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left' };
  const sprintKeys = ['ShiftLeft', 'ShiftRight', 'KeyE', 'Enter'];
  function pause() { S.pl.forEach(p => api.setHold(S.pl.indexOf(p), false)); if (S.state === 'playing') api.togglePause(); }
  function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; }
  function close() { document.body.classList.remove('settings-open'); if ($('preferences')) $('preferences').hidden = true; if ($('settings')) $('settings').setAttribute('aria-expanded', 'false'); document.querySelectorAll('main > :not(#experience)').forEach(el => el.inert = false); cancelHold(); page = ''; panel.hidden = true; panel.innerHTML = ''; lastState = ''; }
  function open(name, body) {
    if ($('preferences')) $('preferences').hidden = true;
    pause(); document.body.classList.remove('settings-open'); $('settings').setAttribute('aria-expanded', 'false'); document.querySelectorAll('main > :not(#experience)').forEach(el => el.inert = true); page = name; panel.hidden = false;
    panel.innerHTML = '<section class="experience-card" role="dialog" aria-modal="true" aria-label="' + (name === 'home' ? '游戏主页' : name === 'training' ? '方向练习' : '对局信息') + '">' + body + '</section>';
    const focus = panel.querySelector('button'); if (focus) focus.focus();
  }
  function button(id, text, cls = '') { return '<button id="' + id + '" class="' + cls + '">' + text + '</button>'; }
  function bind(id, fn) { const el = $(id); if (el) el.addEventListener('click', () => { el.blur(); fn(); }); }
  function record() {
    try { const p = JSON.parse(K.safeGet('iso-snake-progress-v1', '{}')); return p && p['harbor-route-1']; } catch (e) { return null; }
  }
  function play(mode, terrain) { const id = terrain && S.levelId === 'harbor-route' ? 'harbor-32' : undefined; close(); api.setMode(mode); api.setTerrain(terrain, id); Snake.UI.syncModeUi(); }
  function home() {
    const p = record(), done = p && p.completed && Number.isFinite(p.bestMs) && p.bestMs > 0;
    open('home', '<p class="eyebrow">ISOMETRIC SNAKE · V' + K.VERSION + '</p><h2>转个方向，<br>走出新的路线。</h2><p class="intro">穿过桥下，登上高台。用路线和节奏，赢下这场等距冒险。</p>' +
      '<button id="play-mission" class="feature-card"><span class="card-icon">↗</span><span><small>18×18 · 六段路线挑战</small><strong>港口航线</strong><em>' + (done ? '已通关 · 最佳 ' + (p.bestMs / 1000).toFixed(1) + ' 秒' : '桥下通行 / 登桥 / 跨水 / 高台') + '</em></span><b>开始 →</b></button>' +
      '<div class="choice-grid">' + button('play-classic', '<strong>经典练手</strong><small>慢速 · 三条命</small>') + button('play-terrain', '<strong>自由探索</strong><small>32～40 格大地图 · 自选路线</small>') + button('play-ai', '<strong>挑战 CR</strong><small>三档 AI · 同场竞速</small>') + button('play-pk', '<strong>双人对战</strong><small>同屏 · WASD / 方向键</small>') + '</div>' +
      '<div class="card-footer">' + button('learn', '↗ 方向练习') + button('home-settings', '地图 / 主题 / 蛇色') + button('back-game', S.state === 'paused' ? '返回暂停中的对局' : '返回棋盘') + '</div><p class="credits">作者：' + K.AUTHOR + ' · 本地保存进度 · 零依赖 Canvas</p>');
    bind('play-mission', () => { close(); api.startMission(); Snake.UI.syncModeUi(); });
    bind('play-classic', () => play('easy', false)); bind('play-terrain', () => play('easy', true));
    bind('play-ai', () => play('ai', false)); bind('play-pk', () => play('pk', false));
    bind('learn', trainingStart); bind('home-settings', settings); bind('back-game', close);
  }
  function practiceSvg() {
    let svg = '<svg viewBox="0 0 280 154" role="img" aria-label="方向练习棋盘">';
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const px = 140 + (x - y) * 18, py = 13 + (x + y) * 9;
      svg += '<path d="M' + px + ',' + py + 'l18,9 -18,9 -18,-9Z" fill="#0c1c2e" stroke="#234151"/>';
    }
    const px = 140 + (tx - ty) * 18, py = 13 + (tx + ty) * 9;
    return svg + '<path d="M' + px + ',' + (py - 7) + 'l16,8 -16,8 -16,-8Z" fill="#83f3ce"/><path d="M' + (px - 16) + ',' + (py + 1) + 'v9l16,8v-9Z" fill="#218974"/><path d="M' + (px + 16) + ',' + (py + 1) + 'v9l-16,8v-9Z" fill="#35b99c"/></svg>';
  }
  function trainingStart() { training = 0; tx = ty = 3; showTraining(); }
  function showTraining(message) {
    const finished = training >= 5, dir = steps[training];
    open('training', '<p class="eyebrow">方向练习 · ' + Math.min(training + 1, 5) + ' / 5</p><h2>' + (finished ? '准备好出发了。' : training === 4 ? '按住冲刺，掌握节奏。' : '向' + ({up:'右上',right:'右下',down:'左下',left:'左上'}[dir]) + '走一步。') + '</h2>' + practiceSvg() +
      '<p id="training-message" class="training-message" role="status">' + (message || (finished ? '方向练习完成。正式对局不能直接掉头，转向可提前排队。' : training === 4 ? '按住 Shift / E 或下方冲刺键半秒。能量耗尽后需要回充。' : '按 ' + keyNames[dir] + '，或点击 ' + arrows[dir] + '。方块会沿棋盘方向移动。')) + '</p>' +
      '<div class="training-controls">' + steps.map(d => button('train-' + d, arrows[d], dir === d ? 'primary' : '')).join('') + button('train-sprint', '冲刺', training === 4 ? 'primary' : '') + '</div><div class="card-footer">' + button('training-back', '返回棋盘') + (finished ? button('training-play', '开始港口航线', 'primary') : button('training-skip', '返回主页')) + '</div>');
    steps.forEach(d => bind('train-' + d, () => practice(d)));
    const sp = $('train-sprint'); sp.addEventListener('pointerdown', e => { e.preventDefault(); try { sp.setPointerCapture(e.pointerId); } catch (e) {} beginHold(); });
    ['pointerup','pointercancel','lostpointercapture'].forEach(ev => sp.addEventListener(ev, cancelHold));
    bind('training-back', close); bind('training-skip', home);
    bind('training-play', () => { close(); api.startMission(); Snake.UI.syncModeUi(); });
  }
  function practice(dir) {
    if (training >= 4) return;
    if (dir !== steps[training]) { $('training-message').textContent = '这次请按 ' + keyNames[steps[training]] + '，对应 ' + arrows[steps[training]] + '。'; return; }
    const d = K.SCREEN[dir]; tx += d[0]; ty += d[1]; training++; showTraining();
  }
  function beginHold() {
    if (training !== 4 || holdTimer) return;
    $('training-message').textContent = '正在冲刺……继续按住';
    holdTimer = setTimeout(() => { holdTimer = 0; if (page !== 'training' || training !== 4) return; training = 5; K.safeSet('iso-snake-tutorial-v1', 'done'); showTraining(); }, 500);
  }
  function captureKey(e) {
    if (!panel) return false;
    if (page === 'state' && !e.repeat && (keyDir[e.code] || e.code === 'Space' || e.code === 'KeyP')) { e.preventDefault(); if (S.state === 'over') api.restart(); close(); api.start(); if (keyDir[e.code]) api.press(0, keyDir[e.code]); return true; }
    if (e.code === 'Escape') { e.preventDefault(); if (page) close(); else if (document.body.classList.contains('settings-open')) settings(); else home(); return true; }
    if (document.body.classList.contains('settings-open')) { if ((!e.target || !/^(SELECT|INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) && (keyDir[e.code] || sprintKeys.includes(e.code) || e.code === 'Space' || e.code === 'KeyP')) e.preventDefault(); return true; }
    if (!page) return false;
    if (page === 'training' && !e.repeat) { if (keyDir[e.code]) practice(keyDir[e.code]); else if (sprintKeys.includes(e.code)) beginHold(); }
    if (keyDir[e.code] || sprintKeys.includes(e.code) || e.code === 'Space' || e.code === 'KeyP') e.preventDefault();
    return true;
  }
  function releaseKey(e) { if (sprintKeys.includes(e.code)) cancelHold(); }
  function settings() {
    const on = !document.body.classList.contains('settings-open'); pause(); close(); document.body.classList.toggle('settings-open', on);
    $('preferences').hidden = !on;
    if (on) { document.querySelectorAll('main > :not(#preferences):not(.play-actions):not(#experience)').forEach(el => el.inert = true); $('close-settings').focus(); }
    $('settings').setAttribute('aria-expanded', String(on));
  }
  function statePanel() {
    if (page === 'home' || page === 'training' || document.body.classList.contains('settings-open')) return;
    if (S.state === lastState) return; lastState = S.state;
    if (S.state === 'playing') { if (page === 'state') close(); return; }
    const over = S.state === 'over', ready = S.state === 'ready';
    const title = S.missionWon ? '港口航线，完成！' : over ? '游戏结束。' : ready ? (S.mission ? '港口航线' : '准备出发') : '稍作休息。';
    const goal = S.mission && S.mission.goals[S.missionIndex];
    const detail = S.missionWon ? '六个航标全部收集 · 用时 ' + (S.elapsed / 1000).toFixed(1) + ' 秒' : over ? (S.msg || (K.MODES[S.mode].players === 2 ? (S.winner < 0 ? '平局' : K.nm(S.winner) + ' 获胜') : '游戏结束')) : goal ? goal.tip : '↑/W ↗　→/D ↘　↓/S ↙　←/A ↖';
    open('state', '<p class="eyebrow">' + (S.mission ? 'HARBOR ROUTE' : 'ISOMETRIC SNAKE') + '</p><h2>' + title + '</h2><p class="intro">' + detail + '</p>' +
      (over ? '<p class="result-score">' + S.pl[0].score + '<small>得分 · 已收集 ' + (S.mission ? S.missionIndex + '/' + S.mission.goals.length + ' 航标' : '本局长度 ' + S.pl[0].body.length) + '</small></p>' : '<p class="micro">' + (S.mission ? '三条命 · 依次收集六个航标 · 小地图显示当前目标' : '按住 Shift / E 冲刺，空格暂停。') + '</p>') +
      '<div class="card-footer">' + button('state-start', over ? '再试一次' : ready ? '开始' : '继续', 'primary') + button('state-settings', '地图 / 主题 / 蛇色') + button('state-home', '返回主页') + button('state-train', '方向练习') + '</div>');
    lastState = S.state;
    bind('state-start', () => { close(); if (over) api.restart(); api.start(); });
    bind('state-settings', settings); bind('state-home', home); bind('state-train', trainingStart);
  }
  function tick() {
    if (!panel) return;
    if (performance.now() - hudAt > 100) {
      hudAt = performance.now(); const mh = $('mission-hud'), goal = S.mission && S.mission.goals[S.missionIndex];
      mh.hidden = !S.mission;
      if (S.mission) { $('mission-title').textContent = goal ? (S.missionIndex + 1) + '/6 · ' + goal.label : '6/6 · 航线完成'; $('mission-tip').textContent = goal ? goal.tip : '最佳用时已保存在本机'; $('mission-time').textContent = (S.elapsed / 1000).toFixed(1) + ' 秒'; }
      $('pause').setAttribute('aria-label', S.state === 'playing' ? '暂停' : '继续');
    }
    statePanel();
  }
  function init() {
    panel = $('experience'); if (!panel) return;
    document.body.classList.add('experience-enabled');
    S.assist = K.safeGet('iso-snake-assist', '1') !== '0';
    bind('menu', home); bind('help', trainingStart); bind('settings', settings);
    bind('close-settings', settings);
    bind('pause', () => { if (page === 'home' || page === 'training') return; close(); api.togglePause(); });
    bind('restart', () => { close(); api.restart(); });
    const assist = document.createElement('button'); assist.id = 'assist'; assist.textContent = '落点提示'; assist.setAttribute('aria-pressed', String(S.assist));
    document.querySelector('.mode').appendChild(assist);
    assist.addEventListener('click', () => { S.assist = !S.assist; K.safeSet('iso-snake-assist', S.assist ? '1' : '0'); assist.setAttribute('aria-pressed', String(S.assist)); assist.blur(); });
    const oldTick = Snake.uiTick; Snake.uiTick = () => { if (oldTick) oldTick(); tick(); };
    addEventListener('blur', cancelHold);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelHold(); });
    const qs = new URLSearchParams(location.search);
    if (![...qs.keys()].some(k => ['mode','terrain','level','daily','seed','autostart'].includes(k))) home();
    tick();
  }
  Snake.Experience = { init, captureKey, releaseKey, isOpen: () => !!page || document.body.classList.contains('settings-open') };
})();
