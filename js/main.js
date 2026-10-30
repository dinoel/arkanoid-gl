'use strict';
// Запуск: масштабирование под окно, ввод (мышь/тач/клавиатура), HUD, экраны, главный цикл.
(function (AK) {
  const { R, A, G } = AK;
  const $ = id => document.getElementById(id);
  const wrap = $('wrap'), canvas = $('gl'), overlay = $('overlay'), banner = $('banner');
  const el = { score: $('score'), level: $('level'), lives: $('lives'), combo: $('combo'), powers: $('powers'), music: $('music') };

  const params = new URLSearchParams(location.search);
  let urlSeed = parseInt(params.get('seed'), 10);
  let urlLevel = parseInt(params.get('level'), 10); // ?level=4 — начать с этого уровня (например, с босса)
  const randomSeed = () => 1 + Math.floor(Math.random() * 99999);

  let bannerTimer = 0;
  const last = {};
  const POWER_LABELS = { expand: 'ШИРЕ', slow: 'МЕДЛЕННО', laser: 'ЛАЗЕР', fire: 'ОГОНЬ' };

  AK.UI = {
    banner(title, sub, dur) {
      $('bannerTitle').textContent = title;
      $('bannerSub').textContent = sub || '';
      banner.style.opacity = 1;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.style.opacity = 0; }, (dur || 2.5) * 1000);
    },
    gameOver(score, level) {
      overlay.innerHTML =
        `<h1>GAME OVER</h1><div class="score">${score.toLocaleString('ru-RU')}</div>` +
        `<div class="sub">УРОВЕНЬ ${level} · СИД ${G.seed}</div><div class="go">КЛИК — ЕЩЁ РАЗ</div>`;
      overlay.classList.remove('hidden');
      banner.style.opacity = 0;
    },
    hud() {
      const set = (k, v, f) => { if (last[k] !== v) { last[k] = v; f(v); } };
      set('score', G.score, v => { el.score.textContent = v.toLocaleString('ru-RU'); });
      set('level', G.level, v => { el.level.textContent = v; });
      set('lives', G.lives, v => { el.lives.textContent = '●'.repeat(Math.max(0, v)); });
      set('combo', G.combo >= 3 ? G.combo : 0, v => { el.combo.textContent = v ? `КОМБО ×${v}` : ''; });
      let pw = '';
      for (const k in POWER_LABELS) if (G.pw[k] > 0) pw += `<span>${POWER_LABELS[k]} ${Math.ceil(G.pw[k])}</span>`;
      for (const f of G.fishes) if (f.left > 0) pw += `<span>РЫБКА ${Math.ceil(f.left)}</span>`;
      set('pw', pw, v => { el.powers.innerHTML = v; });
      const mi = AK.A.playing && AK.A.musicOn ? '♪ ' + AK.Music.info() : '';
      set('music', mi, v => { el.music.textContent = v; });
    },
    // Накал игры для музыки: мультимяч, комбо, бонусы и близость к концу уровня
    intensity() {
      let alive = 0, total = 0;
      for (const k of G.bricks) if (k.kind !== 'steel') { total++; if (k.alive) alive++; }
      const x = 0.2 + 0.12 * Math.min(G.balls.length - 1, 4) + Math.min(G.combo, 12) * 0.035
        + (G.pw.fire > 0 ? 0.15 : 0) + (G.pw.laser > 0 ? 0.08 : 0) + 0.3 * (1 - alive / Math.max(1, total))
        + (G.boss ? 0.25 + 0.2 * G.boss.dive : 0);
      AK.Music.setIntensity(x);
    },
  };

  // ---------- Масштаб ----------
  function resize() {
    const s = Math.min(window.innerWidth / 720, window.innerHeight / 960);
    const cw = Math.floor(720 * s), ch = Math.floor(960 * s);
    wrap.style.width = cw + 'px';
    wrap.style.height = ch + 'px';
    wrap.style.fontSize = (ch / 960) * 16 + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    R.resize(Math.max(1, Math.round(cw * dpr)), Math.max(1, Math.round(ch * dpr)));
  }

  // ---------- Игра ----------
  let playing = false;
  function start() {
    showSettings(false);
    A.init();
    A.playing = true;
    const seed = Number.isFinite(urlSeed) ? urlSeed : randomSeed();
    const level = Number.isFinite(urlLevel) ? urlLevel : 1;
    urlSeed = urlLevel = NaN;
    G.newGame(seed, false, level);
    playing = true;
    overlay.classList.add('hidden');
    A.start();
  }
  function setPaused(p) {
    if (!playing || G.demo) return;
    G.paused = p;
    A.playing = !p;
    if (p) AK.UI.banner('ПАУЗА', 'P — продолжить', 1e6);
    else { clearTimeout(bannerTimer); banner.style.opacity = 0; }
  }
  // Панель настроек (settings.js). Посреди игры ставит её на паузу без баннера — и снимает, когда закрыта.
  let settingsPause = false;
  function showSettings(on) {
    on = AK.Settings.toggle(on);
    if (on && playing && !G.demo && !G.paused) { G.paused = true; A.playing = false; settingsPause = true; }
    else if (!on && settingsPause) { settingsPause = false; if (G.paused) setPaused(false); }
  }

  // ---------- Ввод ----------
  const keys = {};
  function toWorldX(clientX) {
    const r = canvas.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 720;
  }
  window.addEventListener('pointermove', e => { G.input.x = toWorldX(e.clientX); });
  canvas.addEventListener('pointerdown', e => {
    G.input.x = toWorldX(e.clientX);
    if (AK.Settings.open) { showSettings(false); return; } // клик мимо панели закрывает её
    if (G.paused) { setPaused(false); return; }
    G.input.fire = true; G.input.held = true;
  });
  window.addEventListener('pointerup', () => { G.input.held = false; });
  overlay.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (AK.Settings.open) showSettings(false); else start();
  });

  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!overlay.classList.contains('hidden')) { start(); break; }
        if (!e.repeat) G.input.fire = true;
        G.input.held = true;
        break;
      case 'Enter': if (!overlay.classList.contains('hidden')) start(); break;
      case 'Escape': if (AK.Settings.open) { showSettings(false); break; } // fallthrough
      case 'KeyP': setPaused(!G.paused); break;
      case 'KeyO': if (!e.repeat) showSettings(); break;
      case 'KeyM': {
        const on = A.toggleMusic();
        AK.UI.banner(on ? 'МУЗЫКА ВКЛ' : 'МУЗЫКА ВЫКЛ', '', 1.2);
        break;
      }
      case 'KeyG': {
        const on = G.toggleGravity();
        AK.UI.banner(on ? 'ГРАВИТАЦИЯ ВКЛ' : 'ГРАВИТАЦИЯ ВЫКЛ', on ? 'кирпичи притягивают мяч' : 'мяч летит по прямой', 1.4);
        break;
      }
      case 'KeyL': {
        const on = R.toggleGI();
        if (!R.giAvailable) AK.UI.banner('СВЕТ', 'глобальное освещение не поддерживается этим браузером', 1.6);
        else AK.UI.banner(on ? 'ГЛОБАЛЬНОЕ ОСВЕЩЕНИЕ' : 'ПРОСТОЕ ОСВЕЩЕНИЕ', on ? 'мягкие тени, свет от всего, что светится' : 'как раньше', 1.4);
        break;
      }
      case 'KeyW': {
        const on = AK.Water.toggle();
        AK.UI.banner(on ? 'ВОДА ВКЛ' : 'ВОДА ВЫКЛ', on ? 'ракетка плавает; упавшие осколки поднимают воду, пойманные — убавляют' : '', 1.6);
        break;
      }
      case 'KeyN': if (playing && !G.demo && !G.paused) G.skipLevel(); break;
      case 'KeyR': if (playing && !G.demo) { urlSeed = NaN; start(); } break;
    }
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Space') G.input.held = false;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', resize);

  // ---------- Старт ----------
  if (!R.init(canvas)) {
    const err = $('err');
    err.style.display = 'flex';
    err.textContent = 'WebGL2 не поддерживается этим браузером.';
    overlay.classList.add('hidden');
    return;
  }
  resize();
  G.newGame(randomSeed(), true);

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    if (R.gi) AK.GI.adapt(now - lastT);
    lastT = now;
    const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (dir) {
      if (Math.abs(G.input.x - G.paddle.x) > 120) G.input.x = G.paddle.x;
      G.input.x = Math.max(0, Math.min(720, G.input.x + dir * 900 * dt));
    }
    if (G.state === 'over' && playing) playing = false;
    G.update(dt);
    AK.Draw.frame(G.time);
    AK.UI.hud();
    if (playing) AK.UI.intensity();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(window.AK);
