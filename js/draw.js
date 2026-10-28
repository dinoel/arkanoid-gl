'use strict';
// Отрисовка сцены: сцена для глобального освещения (что светит и что заслоняет), сетка поля тяготения,
// тени, кирпичи с фаской и освещением, трещины, обломки, ракетка, мячи со следом и маркерами вращения,
// бонусы, лазеры, частицы, ударные волны, рамка поля, прожекторы с цветомузыкой, магнит ракетки, снаряды
// боссов (сами боссы — кирпичи, а их глаза, усы и перепонки рисует boss.js).
(function (AK) {
  const { R, U, P } = AK;
  const Wt = AK.Water;
  const { clamp } = U;
  const LX = -0.45, LY = -0.89; // направление на источник света (вверх-влево)
  const tmpO = new Float32Array(128), tmpI = new Float32Array(128), tmpS = new Float32Array(128);
  const cap = new Float32Array(52);

  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  function capsule(x, y, hw, r, out) {
    let i = 0;
    const seg = 12;
    for (let s = 0; s <= seg; s++) { const a = -Math.PI / 2 + (s / seg) * Math.PI; out[i++] = x + hw + Math.cos(a) * r; out[i++] = y + Math.sin(a) * r; }
    for (let s = 0; s <= seg; s++) { const a = Math.PI / 2 + (s / seg) * Math.PI; out[i++] = x - hw + Math.cos(a) * r; out[i++] = y + Math.sin(a) * r; }
    return out;
  }
  function scaled(src, n, cx, cy, s, out) {
    for (let i = 0; i < n * 2; i += 2) { out[i] = cx + (src[i] - cx) * s; out[i + 1] = cy + (src[i + 1] - cy) * s; }
    return n * 2 === out.length ? out : out.subarray(0, n * 2);
  }
  function appear(g, k) {
    if (k.boss) return k.show; // босс собирается сам (boss.js)
    const t0 = ((k.y - 100) / 460) * 0.55 + Math.abs(k.x - 360) / 360 * 0.15;
    return U.smooth(clamp((g.levelTime - t0) / 0.35, 0, 1));
  }

  // ---------- Поле тяготения ----------
  // Сетка прогибается к массам: узел смещён по направлению поля тем сильнее, чем поле больше
  // (с насыщением), а линии ярче там, где поле сильное, — так видны гравитационные колодцы.
  const GS = 32;
  let gx = null, gy = null, gi = null, gw = null, gcols = 0, grows = 0;
  const fv = [0, 0];
  function gravityGrid(g) {
    const k = g.gview * (R.gi ? 0.65 : 1); // на освещённом полу сетка скромнее
    if (k < 0.01) return;
    const cols = Math.ceil((g.R - g.L) / GS) + 1, rows = Math.ceil((g.H - g.T) / GS) + 1;
    if (cols !== gcols || rows !== grows) {
      gcols = cols; grows = rows;
      gx = new Float32Array(cols * rows); gy = new Float32Array(cols * rows); gi = new Float32Array(cols * rows);
      gw = new Float32Array(cols * rows);
    }
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const x = g.L + c * GS, y = g.T + r * GS;
        g.field(x, y, fv);
        const a = Math.hypot(fv[0], fv[1]);
        const d = a > 0 ? (13 * k) / (a + 500) : 0; // смещение 13·a/(a+500) px вдоль поля
        gx[i] = x + fv[0] * d; gy[i] = y + fv[1] * d;
        gi[i] = k * Math.min(1, a / 1100);
        gw[i] = Wt.on ? clamp(1 - Wt.depth(x, y) / 40, 0.12, 1) : 1; // под водой сетка тонет
      }
    }
    const c = g.lv.c2;
    for (let r = 0, i = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++, i++) {
        if (cc + 1 < cols) {
          R.color(c[0], c[1], c[2], (0.03 * k + 0.2 * (gi[i] + gi[i + 1])) * Math.min(gw[i], gw[i + 1]), 1);
          R.line(gx[i], gy[i], gx[i + 1], gy[i + 1], 1);
        }
        if (r + 1 < rows) {
          const j = i + cols;
          R.color(c[0], c[1], c[2], (0.03 * k + 0.2 * (gi[i] + gi[j])) * Math.min(gw[i], gw[j]), 1);
          R.line(gx[i], gy[i], gx[j], gy[j], 1);
        }
      }
    }
  }

  // ---------- Приманка ----------
  // Кирпичи, которые сейчас тянут мяч сильнее обычного, окружены кольцами, стягивающимися к ним, — как воронка.
  function lureRings(g, t) {
    const I = clamp(g.lureEach / 2e7, 0, 1);
    if (I < 0.02) return;
    for (const k of g.bricks) {
      if (!k.alive || k.kind === 'steel') continue;
      const c = k.color;
      for (let i = 0; i < 3; i++) {
        const f = (t * 0.8 + i / 3 + k.phase) % 1;           // 0 — кольцо далеко, 1 — у самого кирпича
        const r = k.rad * (1 + 2.6 * (1 - f) * (0.6 + 0.4 * I));
        R.color(c[0], c[1], c[2], 0.5 * I * f * (1 - f) * 4 * 0.5, 1);
        R.ring(k.x, k.y, r, 0.05 + 0.05 * f);
      }
      R.color(c[0], c[1], c[2], 0.2 * I, 1); R.soft(k.x, k.y, k.rad * 2.2);
    }
  }

  // ---------- Сцена для глобального освещения ----------
  // Рисуется до основной, в низком разрешении: rgb — излучение, альфа — заслонка. Всё рисуется непрозрачным:
  // луч останавливается на первой поверхности и забирает её свет, поэтому светить должен контур предмета.
  // На плоскости свет от точки спадает как 1/r, поэтому маленький мяч должен быть очень ярким.
  const E_BALL = 26, E_FIRE = 30, E_PADDLE = 1.6, E_CAP = 3, E_LASER = 6, E_SPARK = 3, E_EDGE = 0.6, E_HIT = 2;
  const E_SPOT = 60; // прожекторы на стенах
  const E_SHOT = 4;  // снаряды босса
  const SELF = { normal: 0.25, strong: 0.14, explosive: 0, steel: 0 }; // собственное свечение кирпичей
  const SKY = [0.05, 0.055, 0.075];   // свет, приходящий из-за края экрана (снизу, из-под ракетки)
  const LIT_BRICK = 0.8;             // кирпич на 80% освещается и на 20% светится сам — всегда различим

  function giScene(g, t) {
    const { H, L, R: RX, T } = g;
    const c2 = g.lv.c2;
    // неоновая кромка поля — мягкий цветной свет по краям
    const e = E_EDGE * (0.65 + 0.25 * Math.sin(t * 2));
    R.color(c2[0] * e, c2[1] * e, c2[2] * e, 1);
    R.rect(L - 4, T, 4, H - T); R.rect(RX, T, 4, H - T); R.rect(L - 4, T - 4, RX - L + 8, 4);
    // прожекторы светят только в свой конус (см. gi.js); в список источников — раньше мячей, чтобы при
    // мультиболе в растр уходили лишние мячи, а не прожекторы. Источник — чуть впереди линзы, целиком в поле.
    for (const s of spotLights(g)) R.giSpot(s.x, s.y, s.r, s.col[0], s.col[1], s.col[2], s.ang, s.half, s.soft);
    // кирпичи заслоняют свет и слабо светятся своим цветом; взрывные тлеют оранжевым; удар вспыхивает
    for (const k of g.bricks) {
      if (!k.alive) continue;
      const s = appear(g, k);
      if (s <= 0) continue;
      const wo = s < 1 ? scaled(k.world, k.n, k.x, k.y, s, tmpO) : k.world;
      const [r, gg, b] = k.color, f = k.flash * E_HIT;
      if (k.kind === 'explosive') {
        const q = (0.8 + 0.7 * Math.sin(t * 6 + k.phase)) * s;
        R.color(q + f, q * 0.42 + f, q * 0.1 + f, 1);
      } else {
        const se = SELF[k.kind] * s;
        R.color(r * se + f, gg * se + f, b * se + f, 1);
      }
      R.poly(wo);
    }
    for (const d of g.debris) {
      R.color(0, 0, 0, clamp(d.life / 0.6, 0, 1));
      R.poly(P.transform(d.local, d.x, d.y, d.a, d.world));
    }
    for (const u of g.powerups) {
      const c = g.PU_COLORS[u.type];
      R.color(c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 1);
      R.poly(capsule(u.x, u.y + Math.sin(u.t * 6) * 1.5, 9, 9.5, cap));
    }
    // ракетка светится цветом уровня (под магнитом — ярче), торцы — красным
    const p = g.paddle, pe = E_PADDLE * (1 + p.flash * 1.5 + g.magnet * 1.5) * (p.stone > 0 ? 0.1 : 1); // камень не светится
    R.color(c2[0] * pe, c2[1] * pe, c2[2] * pe, 1);
    R.poly(capsule(p.x, p.y, p.hw, p.r, cap));
    const ce = E_CAP * (0.45 + 0.15 * Math.sin(t * 5) + p.flash * 0.5) * (p.stone > 0 ? 0.1 : 1);
    R.color(ce, ce * 0.28, ce * 0.35, 1);
    R.disc(p.x - p.hw, p.y, p.r); R.disc(p.x + p.hw, p.y, p.r);
    for (const z of g.lasers) { R.color(E_LASER, E_LASER * 0.4, E_LASER * 0.4, 1); R.line(z.x, z.y, z.x, z.y + 18, 4); }
    if (g.boss) g.boss.gi(t);
    for (const s of g.shots) { const c = s.col, e = E_SHOT; R.color(c[0] * e, c[1] * e, c[2] * e, 1); R.disc(s.x, s.y, s.r * 0.8); }
    // искры светят; пламя и дымки — нет: они непрозрачны для лучей, и огненный мяч, окутанный ими,
    // мерцал бы, загораживая сам себя
    for (const q of g.particles) {
      if (q.type !== 0) continue;
      const a = q.life / q.max, c = q.col, k = E_SPARK * a;
      R.color(c[0] * k, c[1] * k, c[2] * k, 1);
      R.disc(q.x, q.y, 2);
    }
    for (const w of g.waves) {
      const k = w.t / w.max, e2 = 1 - (1 - k) * (1 - k), q = 6 * (1 - k);
      R.color(q, q * 0.7, q * 0.35, 1); R.ring(w.x, w.y, w.r * (0.15 + 0.85 * e2), 0.07 + 0.1 * (1 - k));
      if (k < 0.3) { const f = (0.3 - k) * 40; R.color(f, f * 0.85, f * 0.6, 1); R.disc(w.x, w.y, w.r * 0.22); }
    }
    // мячи — главный источник; считаются аналитически, в растр — только если их слишком много.
    // Яркость задаётся в настройках; без света мяч остаётся непрозрачным диском и отбрасывает мягкую тень.
    const fire = g.pw.fire > 0, kl = AK.S.ballLight;
    const er = (fire ? E_FIRE : E_BALL * 0.85) * kl, eg = (fire ? E_FIRE * 0.55 : E_BALL * 0.92) * kl, eb = (fire ? E_FIRE * 0.22 : E_BALL) * kl;
    for (const b of g.balls) {
      if (R.giLight(b.x, b.y, b.r, er, eg, eb, true)) continue;
      R.color(er, eg, eb, 1);
      R.disc(b.x, b.y, b.r);
    }
  }

  // ---------- Прожекторы ----------
  // Корпус сидит на кромке стены; side: 1 — левая стена, -1 — правая, 0 — верхняя. Угол q.a, цвет q.c
  // и яркость q.e раз в кадр считает цветомузыка (lightshow.js).
  function spotBase(q, out) {
    out[0] = q.x - (q.side === 0 ? 0 : q.side); out[1] = q.side === 0 ? q.y - 1 : q.y;
    return out;
  }
  const sb = [0, 0];
  const SPOT_LENS = 10; // линза — на таком расстоянии от крепления вдоль оси
  // Источники света прожекторов в этом кадре — для каскадов (пол) и для верха кирпичей (renderer.js)
  const lights = [];
  function spotLights(g) {
    g.spots.forEach((q, i) => {
      const s = lights[i] || (lights[i] = { col: [0, 0, 0] });
      const [x, y] = spotBase(q, sb), d = SPOT_LENS + 3, e = E_SPOT * q.e;
      s.x = x + Math.cos(q.a) * d; s.y = y + Math.sin(q.a) * d; s.r = 3.5;
      s.ang = q.a; s.half = q.half; s.soft = 0.3;
      s.col[0] = q.c[0] * e; s.col[1] = q.c[1] * e; s.col[2] = q.c[2] * e;
    });
    lights.length = g.spots.length;
    if (g.boss && g.boss.lights) for (const s of g.boss.lights()) lights.push(s); // взгляд Горгоны
    return lights;
  }
  // дымка луча — на полу, под кирпичами; при глобальном освещении конус и так виден по полу, дымка слабее
  function spotBeams(g) {
    const k = R.gi ? 0.07 : 0.12;
    for (const q of g.spots) {
      const c = q.c, a = q.a, [x, y] = spotBase(q, sb);
      R.color(c[0], c[1], c[2], k * q.e, 1); R.color2(c[0], c[1], c[2], 0, 1);
      R.beam(x + Math.cos(a) * (SPOT_LENS + 1), y + Math.sin(a) * (SPOT_LENS + 1), a, q.half * 0.9, 460);
    }
  }
  // Крепление на стене и тубус к линзе. Корпус не освещается светом поля — он у самой стены, за спиной
  // своего же луча, и в темноте его было бы не разглядеть; тени на нём — от того же условного света, что у кирпичей.
  function spotFixtures(g) {
    const gi = R.gi;
    R.lit(0);
    for (const q of g.spots) {
      const c = q.c, a = q.a, ca = Math.cos(a), sa = Math.sin(a), [x, y] = spotBase(q, sb);
      const bx = x + ca * 2, by = y + sa * 2, lx = x + ca * SPOT_LENS, ly = y + sa * SPOT_LENS;
      const s = -sa * LX + ca * LY >= 0 ? 1 : -1, nx = -sa * s, ny = ca * s; // бок тубуса, обращённый к свету
      R.color(0.17, 0.18, 0.22, 1); R.disc(x, y, 5.5);
      R.color(0.42, 0.45, 0.53, 1); R.ring(x, y, 5.5, 0.3);
      R.color(0.27, 0.29, 0.35, 1); R.line(bx, by, lx, ly, 8);
      R.color(0.55, 0.58, 0.66, 1); R.line(bx + nx * 2.6, by + ny * 2.6, lx + nx * 2.6, ly + ny * 2.6, 1.5);
      R.color(0.1, 0.11, 0.13, 1); R.line(bx - nx * 3.2, by - ny * 3.2, lx - nx * 3.2, ly - ny * 3.2, 1.6);
      R.color(c[0], c[1], c[2], (gi ? 0.45 : 0.6) * q.e, 1); R.soft(lx + ca * 3, ly + sa * 3, (gi ? 14 : 22) * (0.8 + 0.2 * q.e));
      const lk = Math.min(1, 0.3 + 0.7 * q.e); // линза гаснет вместе с лучом
      R.color(c[0] * lk, c[1] * lk, c[2] * lk, 1); R.line(lx - nx * 4.2, ly - ny * 4.2, lx + nx * 4.2, ly + ny * 4.2, 2.8);
      R.color((1 - (1 - c[0]) * 0.3) * lk, (1 - (1 - c[1]) * 0.3) * lk, (1 - (1 - c[2]) * 0.3) * lk, 1);
      R.line(lx - nx * 2.6, ly - ny * 2.6, lx + nx * 2.6, ly + ny * 2.6, 1.3);
    }
  }

  // ---------- Тени ----------
  function shadows(g) {
    R.color(0, 0, 0, 0.38);
    for (const k of g.bricks) {
      if (!k.alive) continue;
      const s = appear(g, k);
      if (s <= 0) continue;
      const n = k.n, w = k.world;
      for (let i = 0; i < n * 2; i += 2) { tmpS[i] = k.x + (w[i] - k.x) * s + 7; tmpS[i + 1] = k.y + (w[i + 1] - k.y) * s + 9; }
      R.poly(tmpS.subarray(0, n * 2));
    }
    const p = g.paddle;
    if (!hullInWater(g)) R.poly(capsule(p.x + 7, p.y + 9, p.hw, p.r, cap)); // на воде тень рисует FS_BG
    R.color(0, 0, 0, 0.35);
    for (const b of g.balls) R.soft(b.x + 6, b.y + 8, b.r * 1.7);
    for (const u of g.powerups) R.soft(u.x + 6, u.y + 8, 20);
  }

  // ---------- Кирпичи ----------
  function brick(g, k, t) {
    const s = appear(g, k);
    if (s <= 0) return;
    const n = k.n;
    const wo = s < 1 ? scaled(k.world, n, k.x, k.y, s, tmpO) : k.world;
    const wi = s < 1 ? scaled(k.worldIn, n, k.x, k.y, s, tmpI) : k.worldIn;
    let [r, gg, b] = k.color;
    if (k.kind === 'strong') { const f = 0.7 + 0.3 * (k.hp / k.maxHp); r *= f; gg *= f; b *= f; }
    else if (k.kind === 'steel') { const f = 0.62 + 0.38 * (k.mass / k.mass0); r *= f; gg *= f; b *= f; } // сталь тускнеет, теряя массу
    const steel = k.kind === 'steel';
    const shimmer = steel ? 0.12 * Math.sin(t * 1.7 + k.x * 0.025 - k.y * 0.01) : 0;

    const gi = R.gi;

    // мягкое свечение вокруг (при глобальном освещении его даёт собственный свет кирпича)
    if (!gi) { R.color(r, gg, b, steel ? 0.04 : 0.09, 1); R.soft(k.x, k.y, k.rad * 2.1 * s); }

    // фаска: каждое ребро освещено по своей нормали
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      const ax = wo[i * 2], ay = wo[i * 2 + 1], bx = wo[j * 2], by = wo[j * 2 + 1];
      const ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey) || 1;
      const nx = (k.orient * ey) / l, ny = (-k.orient * ex) / l;
      if (gi) {
        // Та же светотень, что без освещения, только мягче, — кирпич остаётся объёмным даже в ровном свете.
        // Свет берём снаружи ребра, и шейдер добавит своё: фаска, обращённая к настоящему источнику, светлее.
        const d = nx * LX + ny * LY;
        const sh = 0.72 + 0.4 * d + shimmer;
        const hi = steel || k.kind === 'strong' ? 0.14 * Math.max(0, d) ** 2 : 0.05 * Math.max(0, d);
        R.lit(LIT_BRICK, nx * 4, ny * 4, 1);
        R.color(r * sh + hi, gg * sh + hi, b * sh + hi, 1);
      } else {
        const d = nx * LX + ny * LY;
        const sh = 0.6 + 0.55 * d + shimmer;
        const hi = steel || k.kind === 'strong' ? 0.22 * Math.max(0, d) ** 2 : 0.08 * Math.max(0, d);
        R.color(r * sh + hi, gg * sh + hi, b * sh + hi, 1);
      }
      R.quad(ax, ay, bx, by, wi[j * 2], wi[j * 2 + 1], wi[i * 2], wi[i * 2 + 1]);
    }
    // грань
    if (gi) {
      R.lit(LIT_BRICK, 0, 0, 1);
      R.color(r * 0.8, gg * 0.8, b * 0.8, 1);
      R.color2(r * 0.95, gg * 0.95, b * 0.95, 1);
      R.polyShade(wi, k.x, k.y, LX, LY, 0.15);
    } else {
      const f = steel ? 0.85 + shimmer : 0.9;
      R.color(r * f, gg * f, b * f, 1);
      R.color2(Math.min(1, r * 1.1 + 0.03), Math.min(1, gg * 1.1 + 0.03), Math.min(1, b * 1.1 + 0.03), 1);
      R.polyShade(wi, k.x, k.y, LX, LY, 0.2);
    }

    // заклёпки у прочных/стальных
    if ((steel || k.kind === 'strong') && n <= 8) {
      for (let i = 0; i < n; i++) {
        const x = U.lerp(k.x, wi[i * 2], 0.7), y = U.lerp(k.y, wi[i * 2 + 1], 0.7);
        R.color(0.05, 0.05, 0.08, 0.5); R.disc(x + 0.6, y + 0.8, 1.9 * s);
        R.color(0.9, 0.92, 1, 0.75); R.disc(x, y, 1.5 * s);
      }
    }
    if (k.kind === 'explosive') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 6 + k.phase);
      R.lit(0);
      R.color(1, 0.5, 0.12, (0.35 + 0.35 * pulse) * (gi ? 0.5 : 1), 1); R.soft(k.x, k.y, k.rad * 1.5 * s);
      R.lit(gi ? LIT_BRICK : 0, 0, 0, 1);
      R.color(0.2, 0.03, 0.02, 0.9); R.disc(k.x, k.y, k.rad * 0.36 * s);
      R.lit(0);
      R.color(1, 0.85 + 0.15 * pulse, 0.4, 1, 1); R.disc(k.x, k.y, k.rad * (0.12 + 0.06 * pulse) * s);
      R.lit(gi ? LIT_BRICK : 0, 0, 0, 1);
    }
    // трещины
    if (k.cracks.length) {
      const c = Math.cos(k.ang), sn = Math.sin(k.ang);
      for (const pts of k.cracks) {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const x0 = k.x + (pts[i] * c - pts[i + 1] * sn) * s, y0 = k.y + (pts[i] * sn + pts[i + 1] * c) * s;
          const x1 = k.x + (pts[i + 2] * c - pts[i + 3] * sn) * s, y1 = k.y + (pts[i + 2] * sn + pts[i + 3] * c) * s;
          R.color(1, 1, 1, 0.18); R.line(x0 + 0.8, y0 + 0.8, x1 + 0.8, y1 + 0.8, 1.2);
          R.color(0.03, 0.03, 0.06, 0.85); R.line(x0, y0, x1, y1, 1.5);
        }
      }
    }
    R.lit(0);
    if (k.flash > 0) { R.color(1, 1, 1, k.flash * 0.65, 1); R.poly(wo); }
  }

  // ---------- Обломки ----------
  function debris(g) {
    for (const d of g.debris) {
      const a = clamp(d.life / 0.6, 0, 1);
      const w = P.transform(d.local, d.x, d.y, d.a, d.world);
      const [r, gg, b] = d.color;
      // летящий осколок чуть светится — его можно поймать
      R.lit(0);
      if (d.rest < 0.3) { R.color(r, gg, b, (0.16 + 0.07 * Math.sin(d.age * 9 + d.x)) * a * (d.inW ? 0.45 : 1), 1); R.soft(d.x, d.y, d.r * 3.2); }
      R.lit(R.gi ? 0.9 : 0, 0, 0, 1);
      R.color(r * 0.8, gg * 0.8, b * 0.8, a);
      R.poly(w);
      const n = w.length / 2;
      const o = Math.sign(P.signedArea(w)) || 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = w[j * 2] - w[i * 2], ey = w[j * 2 + 1] - w[i * 2 + 1], l = Math.hypot(ex, ey) || 1;
        const nx = (o * ey) / l, ny = (-o * ex) / l;
        const sh = (R.gi ? 0.75 : 0.55) + (R.gi ? 0.4 : 0.6) * (nx * LX + ny * LY);
        if (R.gi) R.lit(0.9, nx * 3, ny * 3, 1);
        R.color(Math.min(1, r * sh), Math.min(1, gg * sh), Math.min(1, b * sh), a);
        R.line(w[i * 2], w[i * 2 + 1], w[j * 2], w[j * 2 + 1], 1.6);
      }
      if (d.inW) underWater(d.x, d.y, 70, a, () => R.poly(w));
    }
    R.lit(0);
  }

  // ---------- Вода ----------
  // Предмет в воде виден сквозь неё: сверху ложится плёнка цвета толщи, тем гуще, чем глубже.
  // span — на какой глубине (px ниже кромки) плёнка густеет до предела, shape — рисует очертание.
  const FILM = [0.03, 0.13, 0.16];
  function underWater(x, y, span, a, shape) {
    const k = clamp(Wt.depth(x, y) / span, 0, 0.7) * a;
    if (k <= 0) return;
    R.lit(R.gi ? 0.6 : 0);
    R.color(FILM[0], FILM[1], FILM[2], k);
    shape();
    R.lit(0);
  }
  // Капли, упавшие на пол, — бусины с бликом сверху-слева; под всем остальным, высыхают
  function wetSpots() {
    for (const p of Wt.spots) {
      const a = p.t < 2.5 ? 1 : 1 - (p.t - 2.5) / 1.5;
      R.color(0, 0.01, 0.015, 0.35 * a); R.soft(p.x, p.y, p.r * 1.6);
      R.color(0.55, 0.8, 1, 0.22 * a, 1); R.disc(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.38);
    }
  }
  // Капли над полом: z — высота, рисуем выше на экране и с тенью на полу
  function droplets() {
    for (const d of Wt.drops) {
      if (d.z > 3) { R.color(0, 0, 0, 0.22); R.disc(d.x + d.z * 0.12, d.y + d.z * 0.16, d.r * 0.9); }
    }
    for (const d of Wt.drops) {
      R.color(0.62, 0.85, 1, 0.75, 1); R.disc(d.x, d.y - d.z * 0.5, d.r);
      R.color(0.5, 0.75, 1, 0.12, 1); R.soft(d.x, d.y - d.z * 0.5, d.r * 3);
    }
  }
  // Ракетка на воде, как лодка: ниже ватерлинии корпус виден сквозь толщу. Плёнка начинается с нуля и густеет
  // с глубиной, так что самой линии воды на корпусе не видно. У борта вода взбирается на него на MEN px (мениск;
  // на ходу у носа выше, у кормы ниже — так же изгибается и кромка в FS_BG).
  const MEN = 2.5;
  const hullV = p => clamp(p.vx / 800, -1.5, 1.5);
  const waterline = (p, x, v) => Wt.shoreAt(x) - MEN * Math.max(1 + clamp((x - p.x) / (p.hw + p.r), -1, 1) * v, 0.2);
  const hullHalf = (p, x) => { const a = Math.abs(x - p.x) - p.hw; return a <= 0 ? p.r : Math.sqrt(Math.max(0, p.r * p.r - a * a)); };
  const filmA = dz => 0.5 * (1 - Math.exp(-Math.max(dz, 0) / 8));
  function hullInWater(g) {
    const p = g.paddle;
    return Wt.on && p.y + p.r > Wt.shoreAt(p.x) - MEN ? [p.x, p.y, p.hw, p.r, MEN, hullV(p)] : null;
  }
  function paddleWater(g) {
    const p = g.paddle, v = hullV(p), ext = p.hw + p.r, N = 2;
    if (waterline(p, p.x, v) > p.y + p.r) return;
    R.lit(R.gi ? 0.6 : 0);
    for (let x = p.x - ext; x < p.x + ext - 0.01; x += N) {
      const xa = x, xb = Math.min(x + N, p.x + ext), xm = (xa + xb) / 2;
      const ha = hullHalf(p, xa), hb = hullHalf(p, xb), hm = hullHalf(p, xm);
      const ya = waterline(p, xa, v), yb = waterline(p, xb, v), ym = (ya + yb) / 2;
      // под водой: от ватерлинии до днища
      const ba = p.y + ha, bb = p.y + hb, ta = Math.min(Math.max(ya, p.y - ha), ba), tb = Math.min(Math.max(yb, p.y - hb), bb);
      if (ta < ba || tb < bb) {
        R.color(FILM[0], FILM[1], FILM[2], filmA(Math.max(ym, p.y - hm) - ym));
        R.color2(FILM[0], FILM[1], FILM[2], filmA(p.y + hm - ym));
        R.quadG(xa, ta, xb, tb, xb, bb, xa, ba);
      }
    }
    R.lit(0);
  }

  // ---------- Очки за осколки ----------
  // Цифры — неоновый семисегментный индикатор: шрифта в WebGL нет, а отрезками они рисуются просто.
  const SEG = { a: [0, 0, 1, 0], b: [1, 0, 1, 0.5], c: [1, 0.5, 1, 1], d: [0, 1, 1, 1], e: [0, 0.5, 0, 1], f: [0, 0, 0, 0.5], g: [0, 0.5, 1, 0.5] };
  const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
  // Сегмент: ореол цвета осколка и светлая сердцевина
  function segLine(x0, y0, x1, y1, h, c, a) {
    R.color(c[0], c[1], c[2], 0.28 * a, 1); R.line(x0, y0, x1, y1, h * 0.26);
    R.color(Math.min(1, c[0] * 0.4 + 0.65), Math.min(1, c[1] * 0.4 + 0.65), Math.min(1, c[2] * 0.4 + 0.65), a, 1);
    R.line(x0, y0, x1, y1, h * 0.12);
  }
  // Строка из цифр и «+» с центром (cx, cy) и высотой знака h
  function segText(str, cx, cy, h, c, a) {
    const w = h * 0.55, sp = h * 0.3, gap = h * 0.02;
    const cw = ch => (ch === '1' ? w * 0.2 : w); // единица — одна палочка, узкая
    let x = cx - (str.split('').reduce((s, ch) => s + cw(ch), 0) + (str.length - 1) * sp) / 2;
    const y = cy - h / 2;
    for (const ch of str) {
      if (ch === '+') {
        segLine(x, y + h * 0.5, x + w, y + h * 0.5, h, c, a);
        segLine(x + w * 0.5, y + h * 0.5 - w * 0.5, x + w * 0.5, y + h * 0.5 + w * 0.5, h, c, a);
      } else if (ch === '1') segLine(x + w * 0.1, y, x + w * 0.1, y + h, h, c, a);
      else for (const sg of DIGITS[ch.charCodeAt(0) - 48]) {
        const q = SEG[sg];
        const x0 = x + q[0] * w, y0 = y + q[1] * h, x1 = x + q[2] * w, y1 = y + q[3] * h;
        const l = Math.hypot(x1 - x0, y1 - y0), ux = ((x1 - x0) / l) * gap, uy = ((y1 - y0) / l) * gap;
        segLine(x0 + ux, y0 + uy, x1 - ux, y1 - uy, h, c, a);
      }
      x += cw(ch) + sp;
    }
  }
  // Надпись всплывает над ракеткой и держится, пока идут поимки; с серией цифры крупнее
  function popups(g) {
    const y0 = g.paddle.y - g.paddle.r - 20;
    for (const q of g.popups) {
      const a = q.t < 0.7 ? 1 : Math.max(0, 1 - (q.t - 0.7) / 0.4);
      const y = y0 - 48 * (1 - Math.exp(-q.age * 3));
      const h = (17 + Math.min(q.n, 12) * 0.6) * (1 + 0.3 * Math.exp(-q.t * 14));
      const c = q.color, x = clamp(q.x, g.L + 50, g.R - 50);
      R.color(c[0], c[1], c[2], 0.14 * a, 1); R.soft(x, y, h * 2.4);
      segText('+' + q.v, x, y, h, c, a);
    }
  }

  // ---------- Магнит ----------
  // Над ракеткой сходятся к ней световые дуги, а от каждого мяча, которого она тянет, к ней бегут точки
  function magnetFx(g, t) {
    const m = g.magnet;
    if (m < 0.02) return;
    const p = g.paddle, c = g.lv.c2, top = p.y - p.r;
    R.color(c[0], c[1], c[2], 0.14 * m, 1); R.soft(p.x, top, p.hw * 1.5);
    for (let i = 0; i < 3; i++) {
      const f = (t * 1.6 + i / 3) % 1, h = 6 + 52 * (1 - f), w = p.hw + p.r + 30 * (1 - f);
      R.color(c[0], c[1], c[2], m * 0.7 * f * (1 - f) * 4 * 0.45, 1);
      let px = p.x - w, py = top;
      for (let s = 1; s <= 10; s++) {
        const a = Math.PI * (1 - s / 10), x = p.x + Math.cos(a) * w, y = top - Math.sin(a) * h;
        R.line(px, py, x, y, 2); px = x; py = y;
      }
    }
    const lr = 0.5 + 0.5 * c[0], lg = 0.5 + 0.5 * c[1], lb = 0.5 + 0.5 * c[2];
    for (const b of g.balls) {
      if (b.stuck || b.y > p.y) continue;
      const dx = clamp(b.x, p.x - p.hw, p.x + p.hw) - b.x, dy = top - b.y, d = Math.hypot(dx, dy);
      const n = Math.min(14, Math.floor(d / 26));
      for (let i = 0; i < n; i++) {
        const u = (i + ((t * 2.2) % 1)) / n;
        R.color(lr, lg, lb, m * 0.9 * Math.sin(Math.PI * u), 1);
        R.disc(b.x + dx * u, b.y + dy * u, 2.3);
      }
    }
  }

  // ---------- Ракетка ----------
  function paddle(g, t) {
    const p = g.paddle;
    const c2 = g.lv.c2;
    const gi = R.gi;
    for (let s = -1; s <= 1; s += 0.5) { R.color(c2[0], c2[1], c2[2], (0.05 + p.flash * 0.06) * (gi ? 0.6 : 1), 1); R.soft(p.x + s * p.hw, p.y + 2, 40); }
    // корпус отражает свет мяча; полоса и торцы светятся сами
    R.lit(gi ? 0.85 : 0);
    R.color(0.12, 0.14, 0.2, 1);
    R.poly(capsule(p.x, p.y, p.hw, p.r, cap));
    R.color(0.34, 0.38, 0.48, 1);
    R.color2(0.6, 0.64, 0.74, 1);
    R.polyShade(capsule(p.x, p.y, p.hw, p.r - 2.2, cap), p.x, p.y - p.r * 0.35, LX, LY, gi ? 0.12 : 0.35);
    R.color(1, 1, 1, 0.3); R.rect(p.x - p.hw, p.y - p.r + 3.2, p.hw * 2, 1.6);
    R.lit(0);
    R.color(c2[0], c2[1], c2[2], 1); R.rect(p.x - p.hw * 0.45, p.y - 1.5, p.hw * 0.9, 4);
    R.color(c2[0], c2[1], c2[2], 0.4 + p.flash * 0.6, 1); R.rect(p.x - p.hw * 0.45, p.y - 1.5, p.hw * 0.9, 4);
    const glow = 0.45 + 0.15 * Math.sin(t * 5) + p.flash * 0.5;
    for (const sx of [-1, 1]) {
      const ex = p.x + sx * p.hw;
      R.color(1, 0.28, 0.35, 1); R.disc(ex, p.y, p.r - 4.5);
      R.color(1, 0.3, 0.4, glow * 0.6, 1); R.soft(ex, p.y, p.r * 2.4);
      if (g.pw.laser > 0) {
        R.lit(gi ? 0.85 : 0);
        R.color(0.25, 0.28, 0.35, 1); R.rect(ex - 3.5, p.y - p.r - 7, 7, 9);
        R.lit(0);
        R.color(1, 0.35, 0.35, 0.9, 1); R.rect(ex - 1.5, p.y - p.r - 8, 3, 3);
      }
    }
    // окаменевшая взглядом Горгоны: серый камень поверх корпуса, крапины, а к концу — трещины; пока взгляд
    // только держится на ней, камень наползает полупрозрачно
    const stoneA = p.stone > 0 ? Math.min(1, (p.stone0 - p.stone) / 0.15) : 0.75 * Math.min(1, p.stare / p.stareMax);
    if (stoneA > 0) {
      const a = stoneA, end = p.stone > 0 ? 1 - Math.min(1, p.stone / 0.7) : 0;
      R.lit(gi ? 0.85 : 0);
      R.color(0.46, 0.45, 0.43, a); R.color2(0.8, 0.79, 0.75, a);
      R.polyShade(capsule(p.x, p.y, p.hw, p.r + 0.6, cap), p.x, p.y - p.r * 0.35, LX, LY, 0.35);
      R.lit(0);
      for (let i = 0; i < 18; i++) {
        R.color(0.18, 0.18, 0.17, 0.55 * a);
        R.disc(p.x + (hash(i * 1.7) * 2 - 1) * (p.hw + p.r * 0.4), p.y + (hash(i * 3.1 + 5) * 2 - 1) * p.r * 0.6, 0.8 + hash(i + 0.5) * 1.2);
      }
      for (let i = 0; i < 4 && end > 0; i++) {
        let x = p.x + (hash(i + 9) * 2 - 1) * p.hw, y = p.y - p.r;
        R.color(0.06, 0.06, 0.06, a);
        for (let j = 0; j < Math.ceil(4 * end); j++) { const nx = x + (hash(i * 7 + j) * 2 - 1) * 5, ny = y + 5.5; R.line(x, y, nx, ny, 1.2); x = nx; y = ny; }
      }
    }
    // оглушённая снарядом босса: голубой отсвет и треск разрядов вдоль корпуса
    if (p.stun > 0) {
      const a = Math.min(1, p.stun / 0.4);
      R.lit(0);
      R.color(0.5, 0.8, 1, 0.3 * a, 1); R.poly(capsule(p.x, p.y, p.hw, p.r, cap));
      for (let i = 0; i < 3; i++) {
        let x = p.x + (Math.random() * 2 - 1) * p.hw, y = p.y + (Math.random() * 2 - 1) * p.r;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let j = 0; j < 5; j++) {
          const nx = x + dir * (6 + Math.random() * 10), ny = clamp(p.y + (Math.random() * 2 - 1) * (p.r + 7), p.y - p.r - 8, p.y + p.r + 8);
          R.color(0.5, 0.8, 1, 0.3 * a, 1); R.line(x, y, nx, ny, 4);
          R.color(0.85, 0.95, 1, a, 1); R.line(x, y, nx, ny, 1.3);
          x = nx; y = ny;
        }
      }
    }
  }

  // ---------- Снаряды босса ----------
  // Огонь змея — раскалённый шар (шлейф пламени — частицы из game.js), споры медузы пульсируют кольцом,
  // разряды ската — короткие вытянутые молнии
  function shots(g, t) {
    R.lit(0);
    for (const s of g.shots) {
      const c = s.col;
      if (s.kind === 'fire') {
        const fl = 0.85 + 0.15 * Math.sin(t * 31 + s.x);
        R.color(1, 0.45, 0.1, 0.55, 1); R.soft(s.x, s.y, s.r * 3.4 * fl);
        R.color(1, 0.72, 0.3, 1, 1); R.disc(s.x, s.y, s.r * 0.9);
        R.color(1, 1, 0.85, 1, 1); R.disc(s.x, s.y, s.r * 0.45);
      } else if (s.kind === 'spore') {
        const pu = 0.5 + 0.5 * Math.sin(s.t * 9);
        R.color(c[0], c[1], c[2], 0.4, 1); R.soft(s.x, s.y, s.r * (3 + pu));
        R.color(c[0], c[1], c[2], 0.9, 1); R.ring(s.x, s.y, s.r * (1.15 + 0.25 * pu), 0.28);
        R.color(0.5 + c[0] * 0.5, 0.5 + c[1] * 0.5, 0.5 + c[2] * 0.5, 1, 1); R.disc(s.x, s.y, s.r * 0.5);
      } else {
        const sp = Math.hypot(s.vx, s.vy) || 1, dx = s.vx / sp, dy = s.vy / sp;
        R.color(c[0], c[1], c[2], 0.5, 1); R.soft(s.x, s.y, s.r * 3);
        R.color(c[0], c[1], c[2], 0.85, 1); R.line(s.x - dx * 26, s.y - dy * 26, s.x, s.y, s.r * 1.2);
        R.color(1, 1, 1, 1, 1); R.line(s.x - dx * 18, s.y - dy * 18, s.x + dx * 2, s.y + dy * 2, 2);
      }
    }
  }

  // ---------- Мячи ----------
  function balls(g, t) {
    const fire = g.pw.fire > 0;
    const col = fire ? [1, 0.55, 0.2] : [0.6, 0.85, 1];
    const S = AK.S, kt = 0.22 * S.ballTrail, kh = 0.32 * S.ballHalo, kb = S.ballBright; // см. settings.js
    for (const b of g.balls) {
      const tr = b.trail, m = kt > 0 ? tr.length / 2 : 0;
      for (let i = 0; i < m; i++) {
        const k = (i + 1) / m;
        R.color(col[0], col[1], col[2], kt * k * k, 1);
        R.soft(tr[i * 2], tr[i * 2 + 1], b.r * (0.5 + 1.1 * k));
      }
      if (kh > 0) { R.color(col[0], col[1], col[2], kh, 1); R.soft(b.x, b.y, b.r * 3.4); }
      if (fire) R.color(kb, 0.72 * kb, 0.4 * kb, 1); else R.color(0.9 * kb, 0.94 * kb, kb, 1);
      R.sphere(b.x, b.y, b.r);
      for (const off of [0, Math.PI]) {
        const a = b.ang + off;
        R.color(0.08, 0.15, 0.35, 0.55);
        R.disc(b.x + Math.cos(a) * b.r * 0.55, b.y + Math.sin(a) * b.r * 0.55, b.r * 0.2);
      }
      if (b.inW) underWater(b.x, b.y, 90, 1, () => R.disc(b.x, b.y, b.r));
      if (b.stuck && !g.demo) {
        const p = g.paddle;
        const a = -Math.PI / 2 + clamp(p.vx * 0.0006, -0.45, 0.45) + clamp(b.off / (p.hw + p.r), -1, 1) * 0.35;
        for (let i = 1; i <= 7; i++) {
          const d = 14 + i * 14;
          R.color(col[0], col[1], col[2], (0.5 * (8 - i)) / 7 * (0.6 + 0.4 * Math.sin(t * 6 - i)), 1);
          R.disc(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 2);
        }
      }
    }
  }

  // ---------- Бонусы ----------
  function icon(type, x, y) {
    R.color(1, 1, 1, 0.95);
    switch (type) {
      case 'expand': R.tri(x - 10, y, x - 4, y - 4.5, x - 4, y + 4.5); R.tri(x + 10, y, x + 4, y + 4.5, x + 4, y - 4.5); R.rect(x - 4, y - 1, 8, 2); break;
      case 'multi': R.disc(x - 6.5, y, 2.6); R.disc(x, y, 2.6); R.disc(x + 6.5, y, 2.6); break;
      case 'slow': R.rect(x - 5, y - 4.5, 3.2, 9); R.rect(x + 1.8, y - 4.5, 3.2, 9); break;
      case 'laser': R.rect(x - 5, y - 2, 2, 7); R.rect(x + 3, y - 2, 2, 7); R.tri(x - 6.5, y - 2, x - 1.5, y - 2, x - 4, y - 6.5); R.tri(x + 1.5, y - 2, x + 6.5, y - 2, x + 4, y - 6.5); break;
      case 'fire': R.poly([x, y - 7, x + 4.5, y + 0.5, x, y + 5.5, x - 4.5, y + 0.5]); break;
      case 'life': R.rect(x - 5.5, y - 1.6, 11, 3.2); R.rect(x - 1.6, y - 5.5, 3.2, 11); break;
    }
  }
  function powerups(g, t) {
    for (const u of g.powerups) {
      const c = g.PU_COLORS[u.type];
      const y = u.y + Math.sin(u.t * 6) * 1.5;
      R.color(c[0], c[1], c[2], 0.35 + 0.15 * Math.sin(u.t * 8), 1); R.soft(u.x, y, 34);
      R.lit(R.gi ? 0.55 : 0);
      R.color(c[0] * 0.35, c[1] * 0.35, c[2] * 0.35, 1);
      R.poly(capsule(u.x, y, 9, 9.5, cap));
      R.color(c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 1);
      R.color2(Math.min(1, c[0] * 1.15), Math.min(1, c[1] * 1.15), Math.min(1, c[2] * 1.15), 1);
      R.polyShade(capsule(u.x, y, 9, 7.8, cap), u.x, y - 2, LX, LY, 0.4);
      R.lit(0);
      icon(u.type, u.x, y);
      if (u.inW) underWater(u.x, y, 80, 1, () => R.poly(capsule(u.x, y, 9, 9.5, cap)));
    }
  }

  function lasers(g) {
    for (const z of g.lasers) {
      R.color(1, 0.3, 0.3, 0.45, 1); R.soft(z.x, z.y + 8, 14);
      R.color(1, 0.6, 0.6, 1, 1); R.line(z.x, z.y, z.x, z.y + 18, 3);
    }
  }

  function particles(g) {
    for (const p of g.particles) {
      const a = p.life / p.max, c = p.col;
      if (p.type === 0) {
        R.color(c[0] * 0.5 + 0.5, c[1] * 0.5 + 0.5, c[2] * 0.5 + 0.5, a, 1);
        R.line(p.x, p.y, p.x - p.vx * 0.022, p.y - p.vy * 0.022, p.size);
      } else if (p.type === 1) {
        R.color(c[0], c[1], c[2], 0.5 * a, 1);
        R.soft(p.x, p.y, p.size * (1.4 - 0.4 * a));
      } else if (p.type === 3) { // каменная крошка
        R.lit(R.gi ? 1 : 0);
        R.color(c[0], c[1], c[2], Math.min(1, a * 2));
        R.disc(p.x, p.y, p.size);
        R.lit(0);
      } else {
        R.lit(R.gi ? 1 : 0);
        R.color(c[0], c[1], c[2], 0.4 * a);
        R.soft(p.x, p.y, p.size * (1.7 - 0.7 * a));
        R.lit(0);
      }
    }
    for (const w of g.waves) {
      const k = w.t / w.max, e = 1 - (1 - k) * (1 - k);
      R.color(1, 0.7, 0.35, (1 - k) * 0.9, 1); R.ring(w.x, w.y, w.r * (0.15 + 0.85 * e), 0.07 + 0.1 * (1 - k));
      if (k < 0.3) { R.color(1, 0.9, 0.7, (0.3 - k) * 2.5, 1); R.soft(w.x, w.y, w.r * 0.9); }
    }
  }

  // ---------- Рамка ----------
  function frame(g, t) {
    const { W, H, HUD, WALL, L, R: RX, T } = g;
    const c2 = g.lv.c2;
    R.color(0.012, 0.015, 0.03, 1); R.color2(0.035, 0.045, 0.08, 1); R.rectV(0, 0, W, HUD);
    // стенки освещаются тем, что рядом с ними
    R.lit(R.gi ? 1 : 0);
    R.color(0.1, 0.12, 0.18, 1);
    R.rect(0, HUD, WALL, H - HUD); R.rect(RX, HUD, WALL, H - HUD); R.rect(0, HUD, W, WALL);
    R.color(0.26, 0.3, 0.42, 1);
    R.rect(0, HUD, W, 2); R.rect(2, HUD, 2, H - HUD); R.rect(RX + 2, HUD, 2, H - HUD);
    R.lit(0);
    const pulse = 0.65 + 0.25 * Math.sin(t * 2);
    R.color(c2[0], c2[1], c2[2], pulse, 1);
    R.rect(L - 1.5, T, 1.5, H - T); R.rect(RX, T, 1.5, H - T); R.rect(L - 1.5, T - 1.5, RX - L + 3, 1.5);
    // заклёпки рамки
    R.lit(R.gi ? 1 : 0);
    for (let y = HUD + 40; y < H; y += 80) {
      R.color(0.4, 0.45, 0.6, 1); R.disc(WALL / 2, y, 2.2); R.disc(RX + WALL / 2, y, 2.2);
    }
    R.lit(0);
    // опасная зона внизу
    R.color(1, 0.15, 0.3, 0, 1); R.color2(1, 0.15, 0.3, 0.1, 1); R.rectV(L, H - 36, RX - L, 36);
  }

  AK.Draw = {
    frame(t) {
      const g = AK.G;
      const sx = (Math.random() * 2 - 1) * g.shake, sy = (Math.random() * 2 - 1) * g.shake;
      AK.Show.update(g, t);
      if (R.beginGI(sx, sy)) { giScene(g, t); R.endGI(SKY); }
      R.topLights(R.gi ? spotLights(g) : []);
      R.water(Wt.on ? Wt.frame() : null, spotLights(g), hullInWater(g));
      R.begin(t, sx, sy, g.lv.c1, g.lv.c2);
      if (Wt.on) wetSpots();
      gravityGrid(g);
      spotBeams(g);
      if (!R.gi) shadows(g); // при глобальном освещении тени настоящие
      lureRings(g, t);
      if (g.boss) g.boss.under(t);
      for (const k of g.bricks) if (k.alive) brick(g, k, t);
      debris(g);
      if (g.boss) g.boss.over(t);
      powerups(g, t);
      magnetFx(g, t);
      paddle(g, t);
      if (Wt.on) paddleWater(g);
      balls(g, t);
      shots(g, t);
      lasers(g);
      particles(g);
      if (Wt.on) droplets();
      popups(g);
      frame(g, t);
      spotFixtures(g);
      R.end(g.aberr, g.flash, [1, 0.92, 0.85]);
    },
  };
})(window.AK);
