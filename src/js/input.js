/* input.js —— 输入归一化为方向指令 + HUD/状态条等 DOM 更新。
   键盘/触屏按钮/滑动/暂停 → api；不直接改渲染与音频。 */
window.Snake = window.Snake || {};
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = Snake.S, K = Snake.K, bus = Snake.bus, api = Snake.api;

  const K1 = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right' };
  const K2 = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };
  const SPKEYS = { ShiftLeft: 0, KeyE: 0, ShiftRight: 1, Enter: 1, Slash: 1 }; // Shift 易串键，给足替代键

  /* ---------- HUD ---------- */
  function updateHud() {
    if (K.MODES[S.mode].players === 1) {
      const p = S.pl[0];
      $('hl').innerHTML = '得分 <b>' + p.score + '</b>' + (p.streak >= 2 ? ' <span class="combo">连击×' + p.streak + '</span>' : '') + ' <span class="lives">' + '♥'.repeat(p.lives) + '</span>';
      $('hr').innerHTML = '最高 <b>' + S.best + '</b>';
    } else {
      $('hl').innerHTML = '<span style="color:' + K.SK[S.skin[0]].body[1] + ';font-weight:600">' + K.nm(0) + '</span> 胜 <b>' + S.wins[0] + '</b> · 长 ' + S.pl[0].body.length;
      $('hr').innerHTML = '长 ' + S.pl[1].body.length + ' · 胜 <b>' + S.wins[1] + '</b> <span style="color:' + K.SK[S.skin[1]].body[1] + ';font-weight:600">' + K.nm(1) + '</span>';
    }
  }
  const ebs = document.querySelectorAll('.eb'), sps = document.querySelectorAll('.pad .sp'),
        hds = document.querySelectorAll('.cmp .hd'), fds = document.querySelectorAll('.cmp .fd'), cmps = document.querySelectorAll('.cmp');
  const barCache = [{}, {}];             // 变更检测：值没变就不写 DOM（并入 render 单 rAF 后每帧调用，避免无谓样式重算）
  function updateBars() {
    S.pl.forEach((p, i) => {
      if (!ebs[i]) return;
      const c = barCache[i];
      const ew = Math.round(p.energy) + '%';
      if (c.ew !== ew) { c.ew = ew; ebs[i].firstElementChild.style.width = ew; }
      if (c.lock !== p.locked) { c.lock = p.locked; ebs[i].classList.toggle('lock', p.locked); }
      if (c.spr !== p.sprint) { c.spr = p.sprint; ebs[i].classList.toggle('on', p.sprint); sps[i].classList.toggle('on', p.sprint); }
      // 罗盘：箭头 = 朝向，橙点 = 最近食物（均按屏上视角）；角度量化到整度，不变不写
      const d = p.dir, h = p.body[0];
      const hr = 'rotate(' + (Math.atan2((d[0] + d[1]) * K.HH, (d[0] - d[1]) * K.HW) * 57.3).toFixed(0) + 'deg)';
      if (c.hr !== hr) { c.hr = hr; hds[i].style.transform = hr; }
      let f = null, bd = 1e9;
      S.foods.forEach(o => { const m = Math.abs(o.x - h.x) + Math.abs(o.y - h.y); if (m < bd) { bd = m; f = o; } });
      if (f) {
        const ex = f.x - h.x, ey = f.y - h.y;
        const fr = 'rotate(' + (Math.atan2((ex + ey) * K.HH, (ex - ey) * K.HW) * 57.3).toFixed(0) + 'deg)';
        if (c.fr !== fr) { c.fr = fr; fds[i].style.transform = fr; }
      }
      const hc = K.SK[S.skin[i]].body[1];
      if (c.hc !== hc) { c.hc = hc; cmps[i].style.setProperty('--hc', hc); }
    });
  }

  /* ---------- 皮肤选择 ---------- */
  function drawSwatches() {
    document.querySelectorAll('.sw').forEach(box => {
      const p = +box.dataset.p; box.innerHTML = '';
      K.SK.forEach((s, k) => {
        const b = document.createElement('button');
        b.className = 'dot' + (S.skin[p] === k ? ' on' : ''); b.style.background = s.body[1];
        b.disabled = S.skin[1 - p] === k; b.setAttribute('aria-label', 'P' + (p + 1) + ' 颜色 ' + s.name);
        b.addEventListener('click', () => { b.blur(); api.setSkin(p, k); drawSwatches(); });
        box.appendChild(b);
      });
    });
  }

  /* ---------- 全屏 / 主屏提示 ---------- */
  const hint = $('hint'), showHint = () => hint.classList.add('show');
  const fullscreen = e => {
    e.currentTarget.blur();
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!rq) return showHint();
    try { const r = rq.call(el); if (r && r.catch) r.catch(showHint); } catch (err) { showHint(); }
  };

  function init() {
    hint.addEventListener('click', () => hint.classList.remove('show'));
    if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) $('fs').style.display = 'none';
    $('fs').addEventListener('click', fullscreen);

    addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'KeyP') { e.preventDefault(); api.togglePause(); return; }
      const sp = SPKEYS[e.code];
      if (sp !== undefined) { e.preventDefault(); if (S.state !== 'playing') api.start(); api.setHold(S.mode === 'pk' ? sp : 0, true); return; }
      const k1 = K1[e.code], k2 = K2[e.code];
      if (k1 || k2) { e.preventDefault(); api.press(k1 ? 0 : (S.mode === 'pk' ? 1 : 0), k1 || k2); }
    });
    addEventListener('keyup', e => { const s = SPKEYS[e.code]; if (s !== undefined) api.setHold(S.mode === 'pk' ? s : 0, false); });
    addEventListener('blur', () => S.pl.forEach(p => p.hold = false));
    document.addEventListener('visibilitychange', () => { // 切后台自动暂停，回来不会盲走暴毙
      if (document.hidden) { S.pl.forEach(p => p.hold = false); if (S.state === 'playing') api.togglePause(); }
    });

    document.querySelectorAll('.pad button[data-s]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); api.press(+b.parentElement.dataset.p, b.dataset.s); }));
    document.querySelectorAll('.pad .sp').forEach(b => { // 按住冲刺
      const i = +b.parentElement.dataset.p;
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} if (S.state !== 'playing') api.start(); api.setHold(i, true); });
      ['pointerup', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => api.setHold(i, false)));
      b.addEventListener('contextmenu', e => e.preventDefault());
    });
    const wideMQ = window.matchMedia ? matchMedia('(orientation: landscape), (min-width: 760px)') : { matches: false, addEventListener() {} };
    function syncModeUi() { // body 类与按钮高亮跟随 S.mode + 视口（点击与 URL ?mode= 两个入口共用）
      document.body.classList.toggle('pk', K.MODES[S.mode].players === 2);
      document.body.classList.toggle('ai', !!K.MODES[S.mode].ai);
      document.body.classList.toggle('im', wideMQ.matches); // 横屏/宽屏 → 统一沉浸式
      document.querySelectorAll('.mode button[data-m]').forEach(x => x.classList.toggle('on', x.dataset.m === S.mode));
      if (Snake.Render.refit) Snake.Render.refit();
    }
    wideMQ.addEventListener('change', syncModeUi);
    document.querySelectorAll('.mode button[data-m]').forEach(b => b.addEventListener('click', () => {
      b.blur(); api.setMode(b.dataset.m); syncModeUi();
    }));
    syncModeUi(); // ?mode= 进入时同样生效（沉浸布局/滚动锁定不再依赖点击）
    drawSwatches();

    // 棋盘滑动转向 / 点按暂停（短距+短按才算点按，慢按与小拖动不再误触暂停）
    // 转向在「越过阈值」的瞬间就生效，不再等抬手——抬手才判定会白白多等一整个手势的时间。
    const SWIPE_MIN = 20;
    let sx0 = 0, sy0 = 0, st0 = 0, fired = false;
    const cv = $('c');
    const swipe = e => {
      const dx = e.clientX - sx0, dy = e.clientY - sy0;
      if (fired || S.mode === 'pk' || Math.hypot(dx, dy) < SWIPE_MIN) return;
      fired = true;
      // 滑动按屏幕象限直接对应一个格方向（右上/右下/左下/左上）——等距下「取主轴」会整体偏 45°
      api.press(0, dx > 0 ? (dy > 0 ? 'right' : 'up') : (dy > 0 ? 'down' : 'left'));
    };
    cv.addEventListener('pointerdown', e => { sx0 = e.clientX; sy0 = e.clientY; st0 = performance.now(); fired = false; });
    cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType !== 'mouse') swipe(e); });
    cv.addEventListener('pointerup', e => {
      const dx = e.clientX - sx0, dy = e.clientY - sy0, dist = Math.hypot(dx, dy);
      if (!fired && dist < 16 && performance.now() - st0 < 300) return api.togglePause();
      swipe(e);   // 慢速拖动（未达阈值前就抬手）兜底
    });

    /* ---------- 震动反馈（移动端）：吃食/撞击/起冲轻震，可一键关闭并持久化 ---------- */
    const RM = matchMedia('(prefers-reduced-motion: reduce)');   // 系统「减弱动态」：同时禁震动
    let vibOn = K.safeGet('iso-snake-vib', '1') !== '0';
    const vib = ms => { if (vibOn && !RM.matches && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } };
    const vibBtn = $('vib');
    const vibLabel = () => { vibBtn.textContent = '震动'; vibBtn.classList.toggle('off', !vibOn); vibBtn.title = '震动反馈：' + (vibOn ? '开' : '关'); };
    vibBtn.addEventListener('click', () => {
      vibBtn.blur(); vibOn = !vibOn; K.safeSet('iso-snake-vib', vibOn ? '1' : '0'); vibLabel();
      if (vibOn) vib(12);                                  // 开启时震一下作确认
    });
    vibLabel();
    bus.on('eat', () => vib(10));
    bus.on('crash', () => vib(50));
    bus.on('sprintOn', () => vib(5));

    /* ---------- 轻提示 toast ---------- */
    const toastEl = $('toast');
    let toastTimer = 0;
    const toast = msg => {
      toastEl.textContent = msg; toastEl.classList.add('show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
    };

    /* ---------- 每日挑战 / 幽灵回放 / 复制成绩 ---------- */
    $('daily').addEventListener('click', e => {
      e.currentTarget.blur();
      api.startDaily();                    // 今日种子（YYYYMMDD），固定普通模式
      syncModeUi();                        // 模式按钮高亮同步回「普通」
      toast('每日挑战 · 种子 ' + S.seed + ' · 和全世界同一局');
    });
    const ghostBtn = $('ghost');
    const ghostLabel = () => { ghostBtn.textContent = '幽灵'; ghostBtn.classList.toggle('off', !S.ghostOn); ghostBtn.title = '幽灵回放：' + (S.ghostOn ? '开' : '关'); };
    ghostBtn.addEventListener('click', () => {
      ghostBtn.blur();
      if (!S.ghostOn && !S.ghost) { toast('还没有幽灵数据：破纪录时自动保存你的路径'); return; }
      api.setGhostOn(!S.ghostOn); ghostLabel();
      if (S.ghostOn) toast('幽灵 = 你破纪录的那局' + (S.ghostMeta ? '（' + S.ghostMeta.score + ' 分 · ' + S.ghostMeta.date + '）' : ''));
    });
    ghostLabel();
    /* 3D 地形开关：与模式正交——普通/双人/人机都能开，关掉就是 2.0 的原版玩法（用户要求两条线并行） */
    const terrBtn = $('terrain');
    const terrLabel = () => { if (!terrBtn) return; terrBtn.textContent = '3D'; terrBtn.classList.toggle('off', !S.terrain); terrBtn.title = '3D 地形：' + (S.terrain ? '开（' + (S.levelName || S.levelId) + '）' : '关'); };
    if (terrBtn) {
      terrBtn.addEventListener('click', () => {
        api.setTerrain(!S.terrain);
        terrLabel(); syncModeUi();
        toast(S.terrain ? '3D 地形：开 · ' + (S.levelName || S.levelId) : '3D 地形：关 · 回到原版玩法');
        terrBtn.blur();
      });
      terrLabel();
    }
    function fallbackCopy(txt) {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta); return ok;
      } catch (e) { return false; }
    }
    function copyText(txt) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(() => true, () => fallbackCopy(txt));
      return Promise.resolve(fallbackCopy(txt));
    }
    $('copy').addEventListener('click', e => {
      e.currentTarget.blur();
      const home = 'https://kkkk16689.github.io/isometric-snake/';
      const live = '等距贪吃蛇 2.0 · ' + (S.daily ? '每日挑战 种子 ' + S.seed : K.MODE_NAME[S.mode]) + '（进行中，得分 ' + (S.pl[0] ? S.pl[0].score : 0) + '）。来战：' + home + (S.daily ? '?daily=1' : '');
      copyText(S.state === 'over' && S.resultText ? S.resultText : live)
        .then(ok => toast(ok ? '成绩已复制，去粘贴分享吧' : '复制失败：请截图分享'));
    });

    /* ---------- 读屏播报（#live aria-live）：只播关键节点，不做逐帧刷屏 ---------- */
    const live = $('live');
    let sayT = 0;
    const say = msg => { clearTimeout(sayT); live.textContent = ''; sayT = setTimeout(() => { live.textContent = msg; }, 80); };   // 先清空再置值：同文案也能重播
    let lastSayScore = 0;
    bus.on('gameStart', () => { lastSayScore = 0; say('游戏开始'); });
    bus.on('hud', () => {   // 每 10 分播报一次进度
      if (K.MODES[S.mode].players === 1 && S.state === 'playing' && S.pl[0] && S.pl[0].score - lastSayScore >= 10) { lastSayScore = S.pl[0].score; say('得分 ' + S.pl[0].score); }
    });
    bus.on('goldSpawn', () => say('金苹果出现了'));
    bus.on('eat', e => { if (e.gold) say('金苹果，加 3 分'); });
    bus.on('crash', e => { if (e.partial && S.pl[0]) say('撞到了，还剩 ' + S.pl[0].lives + ' 条命'); });
    bus.on('sprintLock', () => say('冲刺能量耗尽，回充中'));
    bus.on('lose', () => { if (S.pl[0]) say('游戏结束，得分 ' + S.pl[0].score + '，最高 ' + S.best); });
    bus.on('win', e => say(e.winner < 0 ? '平局' : K.nm(e.winner) + ' 获胜'));

    bus.on('hud', updateHud);
    Snake.uiTick = updateBars;   // 并入 render 的唯一 rAF 循环（render.frame 末尾调用），去掉第二条 rAF
  }
  Snake.UI = { init, updateHud };
})();