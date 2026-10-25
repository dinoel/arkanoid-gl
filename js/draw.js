'use strict';
// Отрисовка сцены: сцена для глобального освещения (что светит и что заслоняет), сетка поля тяготения,
// тени, кирпичи с фаской и освещением, трещины, обломки, ракетка, мячи со следом и маркерами вращения,
// бонусы, лазеры, частицы, ударные волны, рамка поля.
(function (AK) {
  const { R, U, P } = AK;
  const { clamp } = U;
  const LX = -0.45, LY = -0.89; // направление на источник света (вверх-влево)
  const tmpO = new Float32Array(128), tmpI = new Float32Array(128), tmpS = new Float32Array(128);
  const cap = new Float32Array(52);

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
    const t0 = ((k.y - 100) / 460) * 0.55 + Math.abs(k.x - 360) / 360 * 0.15;
    return U.smooth(clamp((g.levelTime - t0) / 0.35, 0, 1));
  }

  // ---------- Поле тяготения ----------
  // Сетка прогибается к массам: узел смещён по направлению поля тем сильнее, чем поле больше
  // (с насыщением), а линии ярче там, где поле сильное, — так видны гравитационные колодцы.
  const GS = 32;
  let gx = null, gy = null, gi = null, gcols = 0, grows = 0;
  const fv = [0, 0];
  function gravityGrid(g) {
    const k = g.gview * (R.gi ? 0.65 : 1); // на освещённом полу сетка скромнее
    if (k < 0.01) return;
    const cols = Math.ceil((g.R - g.L) / GS) + 1, rows = Math.ceil((g.H - g.T) / GS) + 1;
    if (cols !== gcols || rows !== grows) {
      gcols = cols; grows = rows;
      gx = new Float32Array(cols * rows); gy = new Float32Array(cols * rows); gi = new Float32Array(cols * rows);
    }
    for (let r = 0, i = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const x = g.L + c * GS, y = g.T + r * GS;
        g.field(x, y, fv);
        const a = Math.hypot(fv[0], fv[1]);
        const d = a > 0 ? (13 * k) / (a + 500) : 0; // смещение 13·a/(a+500) px вдоль поля
        gx[i] = x + fv[0] * d; gy[i] = y + fv[1] * d;
        gi[i] = k * Math.min(1, a / 1100);
      }
    }
    const c = g.lv.c2;
    for (let r = 0, i = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++, i++) {
        if (cc + 1 < cols) {
          R.color(c[0], c[1], c[2], 0.03 * k + 0.2 * (gi[i] + gi[i + 1]), 1);
          R.line(gx[i], gy[i], gx[i + 1], gy[i + 1], 1);
        }
        if (r + 1 < rows) {
          const j = i + cols;
          R.color(c[0], c[1], c[2], 0.03 * k + 0.2 * (gi[i] + gi[j]), 1);
          R.line(gx[i], gy[i], gx[j], gy[j], 1);
        }
      }
    }
  }

  // ---------- Сцена для глобального освещения ----------
  // Рисуется до основной, в низком разрешении: rgb — излучение, альфа — заслонка. Всё рисуется непрозрачным:
  // луч останавливается на первой поверхности и забирает её свет, поэтому светить должен контур предмета.
  // На плоскости свет от точки спадает как 1/r, поэтому маленький мяч должен быть очень ярким.
  const E_BALL = 26, E_FIRE = 30, E_PADDLE = 1.6, E_CAP = 3, E_LASER = 6, E_SPARK = 3, E_EDGE = 0.6, E_HIT = 2;
  const E_SPOT = 60; // прожекторы на стенах
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
    for (const q of g.spots) {
      const c = q.col, a = spotAng(q, t), [x, y] = spotBase(q, sb);
      const d = SPOT_LENS + 3;
      R.giSpot(x + Math.cos(a) * d, y + Math.sin(a) * d, 3.5, c[0] * E_SPOT, c[1] * E_SPOT, c[2] * E_SPOT, a, q.half, 0.3);
    }
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
    // ракетка светится цветом уровня, торцы — красным
    const p = g.paddle, pe = E_PADDLE * (1 + p.flash * 1.5);
    R.color(c2[0] * pe, c2[1] * pe, c2[2] * pe, 1);
    R.poly(capsule(p.x, p.y, p.hw, p.r, cap));
    const ce = E_CAP * (0.45 + 0.15 * Math.sin(t * 5) + p.flash * 0.5);
    R.color(ce, ce * 0.28, ce * 0.35, 1);
    R.disc(p.x - p.hw, p.y, p.r); R.disc(p.x + p.hw, p.y, p.r);
    for (const z of g.lasers) { R.color(E_LASER, E_LASER * 0.4, E_LASER * 0.4, 1); R.line(z.x, z.y, z.x, z.y + 18, 4); }
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
    // мячи — главный источник; считаются аналитически, в растр — только если их слишком много
    const fire = g.pw.fire > 0;
    const er = fire ? E_FIRE : E_BALL * 0.85, eg = fire ? E_FIRE * 0.55 : E_BALL * 0.92, eb = fire ? E_FIRE * 0.22 : E_BALL;
    for (const b of g.balls) {
      if (R.giLight(b.x, b.y, b.r, er, eg, eb, true)) continue;
      R.color(er, eg, eb, 1);
      R.disc(b.x, b.y, b.r);
    }
  }

  // ---------- Прожекторы ----------
  // Корпус сидит на кромке стены; side: 1 — левая стена, -1 — правая, 0 — верхняя. Луч медленно покачивается.
  const spotAng = (q, t) => q.ang + q.amp * Math.sin(t * q.fr + q.ph);
  function spotBase(q, out) {
    out[0] = q.x - (q.side === 0 ? 0 : q.side); out[1] = q.side === 0 ? q.y - 1 : q.y;
    return out;
  }
  const sb = [0, 0];
  const SPOT_LENS = 10; // линза — на таком расстоянии от крепления вдоль оси
  // дымка луча — на полу, под кирпичами; при глобальном освещении конус и так виден по полу, дымка едва заметна
  function spotBeams(g, t) {
    const k = R.gi ? 0.05 : 0.12;
    for (const q of g.spots) {
      const c = q.col, a = spotAng(q, t), [x, y] = spotBase(q, sb);
      R.color(c[0], c[1], c[2], k, 1); R.color2(c[0], c[1], c[2], 0, 1);
      R.beam(x + Math.cos(a) * (SPOT_LENS + 1), y + Math.sin(a) * (SPOT_LENS + 1), a, q.half * 0.9, 460);
    }
  }
  // Крепление на стене и тубус к линзе. Корпус не освещается светом поля — он у самой стены, за спиной
  // своего же луча, и в темноте его было бы не разглядеть; тени на нём — от того же условного света, что у кирпичей.
  function spotFixtures(g, t) {
    const gi = R.gi;
    R.lit(0);
    for (const q of g.spots) {
      const c = q.col, a = spotAng(q, t), ca = Math.cos(a), sa = Math.sin(a), [x, y] = spotBase(q, sb);
      const bx = x + ca * 2, by = y + sa * 2, lx = x + ca * SPOT_LENS, ly = y + sa * SPOT_LENS;
      const s = -sa * LX + ca * LY >= 0 ? 1 : -1, nx = -sa * s, ny = ca * s; // бок тубуса, обращённый к свету
      R.color(0.17, 0.18, 0.22, 1); R.disc(x, y, 5.5);
      R.color(0.42, 0.45, 0.53, 1); R.ring(x, y, 5.5, 0.3);
      R.color(0.27, 0.29, 0.35, 1); R.line(bx, by, lx, ly, 8);
      R.color(0.55, 0.58, 0.66, 1); R.line(bx + nx * 2.6, by + ny * 2.6, lx + nx * 2.6, ly + ny * 2.6, 1.5);
      R.color(0.1, 0.11, 0.13, 1); R.line(bx - nx * 3.2, by - ny * 3.2, lx - nx * 3.2, ly - ny * 3.2, 1.6);
      R.color(c[0], c[1], c[2], gi ? 0.45 : 0.6, 1); R.soft(lx + ca * 3, ly + sa * 3, gi ? 14 : 22);
      R.color(c[0], c[1], c[2], 1); R.line(lx - nx * 4.2, ly - ny * 4.2, lx + nx * 4.2, ly + ny * 4.2, 2.8);
      R.color(1 - (1 - c[0]) * 0.3, 1 - (1 - c[1]) * 0.3, 1 - (1 - c[2]) * 0.3, 1);
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
    R.poly(capsule(p.x + 7, p.y + 9, p.hw, p.r, cap));
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
        R.lit(LIT_BRICK, nx * 4, ny * 4);
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
      R.lit(LIT_BRICK);
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
      R.lit(gi ? LIT_BRICK : 0);
      R.color(0.2, 0.03, 0.02, 0.9); R.disc(k.x, k.y, k.rad * 0.36 * s);
      R.lit(0);
      R.color(1, 0.85 + 0.15 * pulse, 0.4, 1, 1); R.disc(k.x, k.y, k.rad * (0.12 + 0.06 * pulse) * s);
      R.lit(gi ? LIT_BRICK : 0);
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
      R.lit(R.gi ? 0.9 : 0);
      R.color(r * 0.8, gg * 0.8, b * 0.8, a);
      R.poly(w);
      const n = w.length / 2;
      const o = Math.sign(P.signedArea(w)) || 1;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = w[j * 2] - w[i * 2], ey = w[j * 2 + 1] - w[i * 2 + 1], l = Math.hypot(ex, ey) || 1;
        const nx = (o * ey) / l, ny = (-o * ex) / l;
        const sh = (R.gi ? 0.75 : 0.55) + (R.gi ? 0.4 : 0.6) * (nx * LX + ny * LY);
        if (R.gi) R.lit(0.9, nx * 3, ny * 3);
        R.color(Math.min(1, r * sh), Math.min(1, gg * sh), Math.min(1, b * sh), a);
        R.line(w[i * 2], w[i * 2 + 1], w[j * 2], w[j * 2 + 1], 1.6);
      }
    }
    R.lit(0);
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
  }

  // ---------- Мячи ----------
  function balls(g, t) {
    const fire = g.pw.fire > 0;
    const col = fire ? [1, 0.55, 0.2] : [0.6, 0.85, 1];
    for (const b of g.balls) {
      const tr = b.trail, m = tr.length / 2;
      for (let i = 0; i < m; i++) {
        const k = (i + 1) / m;
        R.color(col[0], col[1], col[2], 0.22 * k * k, 1);
        R.soft(tr[i * 2], tr[i * 2 + 1], b.r * (0.5 + 1.1 * k));
      }
      R.color(col[0], col[1], col[2], 0.32, 1); R.soft(b.x, b.y, b.r * 3.4);
      if (fire) R.color(1, 0.72, 0.4, 1); else R.color(0.9, 0.94, 1, 1);
      R.sphere(b.x, b.y, b.r);
      for (const off of [0, Math.PI]) {
        const a = b.ang + off;
        R.color(0.08, 0.15, 0.35, 0.55);
        R.disc(b.x + Math.cos(a) * b.r * 0.55, b.y + Math.sin(a) * b.r * 0.55, b.r * 0.2);
      }
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
      if (R.beginGI(sx, sy)) { giScene(g, t); R.endGI(SKY); }
      R.begin(t, sx, sy, g.lv.c1, g.lv.c2);
      gravityGrid(g);
      spotBeams(g, t);
      if (!R.gi) shadows(g); // при глобальном освещении тени настоящие
      for (const k of g.bricks) if (k.alive) brick(g, k, t);
      debris(g);
      powerups(g, t);
      paddle(g, t);
      balls(g, t);
      lasers(g);
      particles(g);
      frame(g, t);
      spotFixtures(g, t);
      R.end(g.aberr, g.flash, [1, 0.92, 0.85]);
    },
  };
})(window.AK);
