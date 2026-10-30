'use strict';
// Боссы — на каждом четвёртом уровне вместо раскладки (levelgen.js). Босс собран из настоящих кирпичей: мяч их
// бьёт, они трескаются, рассыпаются осколками, роняют бонусы и притягивают мяч, как обычные. Только стоять им
// не дают: каждый шаг позы кирпичей задаёт скелет босса. Жар-змей вьётся по следу своей головы, Лунная медуза
// дышит колоколом и волочит щупальца-верёвки, Ночной скат гонит по крыльям волну взмаха, у ИИ-Горгоны вьются
// змеи из двоичного кода, а её взгляд обращает ракетку в камень. Сердце босса — кирпич
// с глазом, который следит за ракеткой: пока оно цело, босс жив, а разбитое рушит всё тело цепью вспышек.
// У ската жизнь общая на всё тело: шкалу убавляет любой выбитый кирпич, а глаз — крупными кусками.
// Время от времени босс заряжается и стреляет в ракетку (снаряды и оглушение ракетки — в game.js), а время от
// времени пикирует к ней и несколько секунд кружит низко над ней.
// Здесь же рисуется всё, что не кирпичи: глаза, рога, усы, плавники, перепонки, нити щупалец, шкала жизни.
(function (AK) {
  const { U, P, R } = AK;
  const { clamp, TAU, lerp } = U;
  const EVERY = 4;        // босс — на каждом EVERY-м уровне
  const ASSEMBLE = 2.4;   // с: за столько кирпичи слетаются в босса
  const FLY = 0.9;        // с: полёт одного кирпича на место
  const VCAP = 1100;      // px/s: предел скорости кирпича, которую чувствует мяч при ударе
  const CHARGE = 0.8;     // с: заряд перед выстрелом
  const KILL_GAP = 0.06;  // с: между вспышками кирпичей поверженного босса
  const CLEAR = 150;      // px: ближе этого к ракетке нижний край босса в пике не опускается
  const DIVE_K = 2.2;     // 1/с: жёсткость пружины, которая ведёт босса вниз и обратно
  // Размер боссов: формы кирпичей, их места на скелете, верёвки и рисунок заданы ниже в единицах босса,
  // на поле они в SZ раз больше. Пределы полёта по полю — уже в пикселях, под этот размер.
  const SZ = 1.15;
  const wrap = a => a - TAU * Math.round(a / TAU);
  const shade = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
  const lighter = (c, k) => [lerp(c[0], 1, k), lerp(c[1], 1, k), lerp(c[2], 1, k)];
  const pan = x => ((x / 720) * 2 - 1) * 0.8;
  const tp = [0, 0, 0], tq = [0, 0, 0];

  // ---------- Общее ----------
  // Заготовка: имя, палитра и кирпичи в формате levelgen.js; meta[i] — данные скелета для i-го кирпича
  function boss(name, level, rng, hue, tier) {
    return {
      name, level, rng, tier, specs: [], meta: [], parts: [], t: 0, mt: rng.range(0, 60),
      p1: rng.range(0, TAU), p2: rng.range(0, TAU),
      c1: U.hsl(hue, 0.7, 0.5), c2: U.hsl(hue + 0.08, 0.75, 0.55),
      core: null, coreHp: 0, hpShow: 1, born: false, dying: false, deathT: 0, order: null, nextKill: 0,
      charging: false, charge: 0, cool: 2.2, period: 3.4, hurt: 0, recoil: 0, look: [0, 1], api: null,
      dive: 0, diveV: 0, diving: false, diveIn: rng.range(6, 9), diveLeft: 0, fx: 360, floor: 738,
    };
  }
  function part(bs, role, local, kind, hp, color, o = {}) {
    bs.specs.push({ local: local.map(v => v * SZ), x: 360, y: 300, ang: 0, kind, hp, color, note: o.note ?? 5, circle: (o.circle || 0) * SZ,
      motion: { type: 'boss' }, boss: role, density: o.density });
    const m = {};
    bs.meta.push(m);
    return m;
  }
  // Доля жизни на шкале. Обычно это здоровье сердца; если у босса задана цена кирпичей bs.worth(k) — урон,
  // нанесённый всему телу (каждая выбитая единица прочности стоит worth), против запаса bs.bar
  function frac(bs) {
    const c = bs.core;
    if (!c.alive) return 0;
    if (!bs.worth) return c.hp / c.maxHp;
    let d = 0;
    for (const k of bs.parts) d += bs.worth(k) * (k.maxHp - (k.alive ? Math.max(0, k.hp) : 0));
    return Math.max(0, 1 - d / bs.bar);
  }
  const rage = bs => bs.core.alive && frac(bs) <= 0.5;
  // Насколько опустить центр босса, стоящего на высоте base, чтобы в пике его нижний край (below под центром)
  // оказался на bs.floor
  const sink = (bs, base, below) => Math.max(0, bs.floor - below - base) * bs.dive;
  // Снаряды, выпущенные в пике, летят медленнее: с близкого расстояния от них иначе не увернуться
  const shotSpeed = (bs, v) => v * (1 - 0.35 * bs.dive);

  // Живые кирпичи (game.js) — к скелету. Каждый прилетит из-за края поля по лучу от сердца, со своей задержкой;
  // сердце — последним, точно к концу сборки.
  function bind(bs, bricks, api) {
    bs.parts = bricks; bs.api = api;
    bricks.forEach((k, i) => {
      k.m = bs.meta[i]; k.base = k.color; k.show = 0; k.ghost = true;
      k.spin = bs.rng.range(-4, 4);
      if (k.boss === 'core') { bs.core = k; k.delay = ASSEMBLE - FLY; } else k.delay = bs.rng.range(0.1, ASSEMBLE - FLY - 0.25);
    });
    bs.coreHp = bs.core.hp;
    if (bs.bound) bs.bound();
  }

  // Поза кирпича и скорость его поверхности — для удара о мяч и для осколков
  function place(k, x, y, a, dt) {
    if (k.placed) {
      k.vx = clamp((x - k.x) / dt, -VCAP, VCAP); k.vy = clamp((y - k.y) / dt, -VCAP, VCAP);
      k.w = clamp(wrap(a - k.ang) / dt, -12, 12);
    } else k.placed = true;
    k.x = x; k.y = y; k.ang = a; k.dirty = true;
  }

  // Скелет задал каждому кирпичу место (tx, ty, ta); пока босс собирается, кирпичи летят туда, вращаясь
  function commit(bs, dt) {
    const c = bs.core;
    for (const k of bs.parts) {
      if (!k.alive) continue;
      let x = k.tx, y = k.ty, a = k.ta;
      if (k.ghost) {
        if (k.sx === undefined) {
          let dx = x - c.tx, dy = y - c.ty;
          const d = Math.hypot(dx, dy);
          if (d < 1) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }
          k.sx = x + dx * 640; k.sy = y + dy * 640;
        }
        const f = clamp((bs.t - k.delay) / FLY, 0, 1), e = 1 - (1 - f) ** 3;
        x = lerp(k.sx, x, e); y = lerp(k.sy, y, e); a += (1 - e) * k.spin;
        k.show = f > 0 ? 0.3 + 0.7 * e : 0;
        if (f >= 1) { k.ghost = false; k.show = 1; bs.api.burst(x, y, k.base, 0); }
      }
      place(k, x, y, a, dt);
    }
  }

  // Прицел в ракетку с упреждением; не круче 60° от вертикали, чтобы снаряд не летел вдоль поля
  function aim(g, x, y, speed, spread) {
    const p = g.paddle;
    let a = Math.atan2(p.y - p.r - y, p.x + p.vx * 0.25 - x) + spread;
    a = clamp(a, Math.PI / 2 - 1.05, Math.PI / 2 + 1.05);
    return [Math.cos(a) * speed, Math.sin(a) * speed];
  }

  // Пике: раз в 9–14 с (в ярости чаще) босс спускается к ракетке, 3,5–5 с держится над ней и возвращается.
  // bs.dive — глубина 0..1 на пружине без перелёта; bs.floor — ниже него босс не опускается: CLEAR над ракеткой,
  // даже если вода её подняла; bs.fx — сглаженный x ракетки, к которому босс в пике тянется
  function diveStep(bs, dt, g) {
    if (bs.dying) return; // рассыпается там, где застали
    const p = g.paddle, on = bs.born && g.state === 'play';
    bs.floor += (p.y - p.r - CLEAR - bs.floor) * (1 - Math.exp(-dt * 2));
    bs.fx += (p.x - bs.fx) * (1 - Math.exp(-dt * 1.2));
    if (bs.diving) {
      bs.diveLeft -= dt;
      if (bs.diveLeft <= 0 || !on) { bs.diving = false; bs.diveIn = bs.rng.range(9, 14) * (rage(bs) ? 0.7 : 1); }
    } else if (on && (bs.diveIn -= dt) <= 0) {
      bs.diving = true; bs.diveLeft = bs.rng.range(3.5, 5);
      bs.api.sfx('bossDive', pan(bs.core.x));
    }
    bs.diveV += (((bs.diving ? 1 : 0) - bs.dive) * DIVE_K * DIVE_K - 2 * DIVE_K * bs.diveV) * dt;
    bs.dive = clamp(bs.dive + bs.diveV * dt, 0, 1);
  }

  function update(bs, dt, g) {
    const api = bs.api, c = bs.core;
    bs.t += dt;
    diveStep(bs, dt, g);
    bs.hurt = Math.max(0, bs.hurt - dt * 2.5);
    bs.recoil *= Math.exp(-dt * 7);
    // глаз смотрит на ракетку, а на мяч — когда тот подлетел близко
    let tx = g.paddle.x, ty = g.paddle.y;
    for (const b of g.balls) if (!b.stuck && Math.hypot(b.x - c.x, b.y - c.y) < 170) { tx = b.x; ty = b.y; }
    const d = Math.hypot(tx - c.x, ty - c.y) || 1, kl = 1 - Math.exp(-dt * 8);
    bs.look[0] += ((tx - c.x) / d - bs.look[0]) * kl; bs.look[1] += ((ty - c.y) / d - bs.look[1]) * kl;
    bs.pose(dt, g);
    commit(bs, dt);
    if (!bs.born && bs.t >= ASSEMBLE) {
      bs.born = true;
      api.sfx('bossRoar', pan(c.x)); api.shake(8); api.flash(0.12);
    }
    // удар в сердце: вздрагивает всё тело
    if (c.alive && c.hp < bs.coreHp) {
      bs.coreHp = c.hp; bs.hurt = 1;
      for (const k of bs.parts) if (k.alive) k.flash = Math.max(k.flash, 0.45);
      api.sfx('bossHurt', pan(c.x)); api.shake(5);
    }
    // общая жизнь кончилась — сердце гаснет само
    if (bs.worth && bs.born && c.alive && frac(bs) <= 0) api.destroy(c, true);
    bs.hpShow += (frac(bs) - bs.hpShow) * (1 - Math.exp(-dt * 2.5));
    // сердце разбито: тело рушится от него к краям
    if (!bs.dying && !c.alive) {
      bs.dying = true; bs.charging = false; bs.charge = 0;
      bs.order = bs.parts.filter(k => k.alive).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
      api.burst(c.x, c.y, bs.eyeCol, 2); api.shake(16); api.flash(0.3);
      api.defeated(`${bs.name} ${bs.fem ? 'ПОВЕРЖЕНА' : 'ПОВЕРЖЕН'}`);
    }
    if (bs.dying) {
      bs.deathT += dt;
      while (bs.order.length && bs.deathT >= bs.nextKill) {
        const k = bs.order.shift();
        if (!k.alive) continue;
        api.destroy(k, bs.order.length % 4 === 0);
        api.burst(k.x, k.y, k.base, 1);
        bs.nextKill += KILL_GAP;
      }
      return;
    }
    // стрельба: только когда мяч в игре, после сборки
    if (!bs.born || g.state !== 'play') { bs.charging = false; bs.charge = 0; return; }
    if (!bs.charging) {
      bs.cool -= dt;
      if (bs.cool <= 0) { bs.charging = true; bs.charge = 0; api.sfx('bossCharge', pan(c.x), CHARGE); }
    } else {
      bs.charge += dt / CHARGE;
      if (bs.charge >= 1) {
        bs.charging = false; bs.charge = 0; bs.recoil = 1;
        bs.fire(g);
        bs.cool = bs.period * (rage(bs) ? 0.62 : 1) * bs.rng.range(0.85, 1.15);
      }
    }
  }

  // След: пройденный путь с длиной дуги — по нему тело змея повторяет путь головы
  function trail() { return { x: [], y: [], s: [], len: 0 }; }
  function trailPush(h, x, y) {
    const n = h.x.length;
    if (n) {
      const d = Math.hypot(x - h.x[n - 1], y - h.y[n - 1]);
      if (d < 0.75) return;
      h.len += d;
    }
    h.x.push(x); h.y.push(y); h.s.push(h.len);
    if (n > 4000) { h.x.splice(0, 2000); h.y.splice(0, 2000); h.s.splice(0, 2000); }
  }
  function trailPoint(h, s, out) {
    const S = h.s, n = S.length;
    if (n < 2 || s <= S[0]) { out[0] = h.x[0]; out[1] = h.y[0]; return out; }
    if (s >= S[n - 1]) { out[0] = h.x[n - 1]; out[1] = h.y[n - 1]; return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const f = (s - S[lo]) / (S[hi] - S[lo] || 1);
    out[0] = lerp(h.x[lo], h.x[hi], f); out[1] = lerp(h.y[lo], h.y[hi], f);
    return out;
  }
  // Точка следа в d px позади головы и направление пути в ней: out = [x, y, угол]
  function trailAt(h, d, out) {
    const s = h.len - d;
    trailPoint(h, s + 6, tq);
    const fx = tq[0], fy = tq[1];
    trailPoint(h, s - 6, tq);
    out[2] = Math.atan2(fy - tq[1], fx - tq[0]);
    trailPoint(h, s, out);
    return out;
  }

  // Верёвка из n звеньев длиной len (в единицах босса; схема Верле): висит на (ax, ay), её тянет сила (gx, gy)
  // и раскачивает поперёк волна амплитуды amp — щупальца медузы и хвост ската
  function rope(n, len, ax, ay) {
    len *= SZ;
    const r = { n, len, x: [], y: [], px: [], py: [] };
    for (let j = 0; j <= n; j++) { r.x.push(ax); r.y.push(ay + j * len); r.px.push(ax); r.py.push(ay + j * len); }
    return r;
  }
  function ropeStep(r, ax, ay, gx, gy, amp, ph, dt) {
    const dt2 = dt * dt, gl = Math.hypot(gx, gy) || 1, nx = -gy / gl, ny = gx / gl;
    if (!r.hung) { // в первый раз — просто свисает
      r.hung = true;
      for (let j = 0; j <= r.n; j++) { r.x[j] = r.px[j] = ax + (gx / gl) * j * r.len; r.y[j] = r.py[j] = ay + (gy / gl) * j * r.len; }
    }
    r.x[0] = ax; r.y[0] = ay; r.px[0] = ax; r.py[0] = ay;
    for (let j = 1; j <= r.n; j++) {
      const vx = (r.x[j] - r.px[j]) * 0.985, vy = (r.y[j] - r.py[j]) * 0.985, s = amp * Math.sin(ph + j * 0.55);
      r.px[j] = r.x[j]; r.py[j] = r.y[j];
      r.x[j] += vx + (gx + nx * s) * dt2; r.y[j] += vy + (gy + ny * s) * dt2;
    }
    for (let it = 0; it < 6; it++) {
      for (let j = 0; j < r.n; j++) {
        const dx = r.x[j + 1] - r.x[j], dy = r.y[j + 1] - r.y[j], d = Math.hypot(dx, dy) || 1e-6, e = (d - r.len) / d;
        if (j === 0) { r.x[1] -= dx * e; r.y[1] -= dy * e; }
        else { r.x[j] += dx * e * 0.5; r.y[j] += dy * e * 0.5; r.x[j + 1] -= dx * e * 0.5; r.y[j + 1] -= dy * e * 0.5; }
      }
    }
  }
  // Звено j верёвки ушло: всё, что ниже, отрывается и падает осколками
  function cut(bs, chain, r) {
    const j = chain.findIndex(k => !k.alive);
    if (j < 0 || j >= r.n) return;
    for (let i = j + 1; i < chain.length; i++) if (chain[i].alive) bs.api.destroy(chain[i], false);
    r.n = j;
  }

  // ---------- Рисование ----------
  // Глаз: тёмная впадина, светящаяся радужка и зрачок-щель, который смотрит на look. Заряд раскаляет радужку
  // и расширяет зрачок, удар — белая вспышка.
  function eye(x, y, r, bs, col) {
    const ch = bs.charge, lx = bs.look[0] * r * 0.3, ly = bs.look[1] * r * 0.3;
    R.lit(0);
    R.color(col[0], col[1], col[2], 0.3 + 0.45 * ch, 1); R.soft(x, y, r * (2.4 + 1.6 * ch));
    R.color(0.03, 0.01, 0.04, 1); R.disc(x, y, r);
    const ic = lighter(col, 0.15 + 0.55 * ch);
    R.color(ic[0], ic[1], ic[2], 1, 1); R.disc(x + lx * 0.5, y + ly * 0.5, r * 0.8);
    R.color(1, 1, 1, 0.2 + 0.5 * ch, 1); R.ring(x + lx * 0.5, y + ly * 0.5, r * 0.8, 0.16);
    const pw = r * (0.17 + 0.25 * ch) * (1 - 0.5 * bs.hurt), ph = r * 0.6, pts = [];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; pts.push(x + lx + Math.cos(a) * pw, y + ly + Math.sin(a) * ph); }
    R.color(0.02, 0, 0.03, 1); R.poly(pts);
    R.color(1, 1, 1, 0.85, 1); R.disc(x - r * 0.32, y - r * 0.34, r * 0.15);
    if (bs.hurt > 0) { R.color(1, 1, 1, bs.hurt * 0.8, 1); R.disc(x, y, r * 1.05); }
  }
  // Заряд в точке выстрела: свет растёт, к нему стягиваются искры
  function chargeFx(bs, x, y, col, t) {
    const ch = bs.charge;
    if (ch <= 0) return;
    R.color(col[0], col[1], col[2], 0.25 + 0.5 * ch, 1); R.soft(x, y, 10 + 34 * ch);
    const hc = lighter(col, 0.6);
    R.color(hc[0], hc[1], hc[2], ch, 1); R.disc(x, y, 2 + 4 * ch);
    for (let i = 0; i < 8; i++) {
      const f = (t * 2.3 + i / 8) % 1, a = i * 2.4 + t * 0.7, d = 38 * (1 - f) * (0.6 + 0.4 * ch);
      R.color(hc[0], hc[1], hc[2], ch * f, 1); R.disc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.6);
    }
  }
  // Шкала жизни сердца — неоновая полоса под верхней кромкой поля; отнятая жизнь гаснет следом белым
  function hpBar(bs) {
    const c = bs.core, a = clamp((bs.t - ASSEMBLE + 0.6) / 0.8, 0, 1) * (bs.dying ? Math.max(0, 1 - bs.deathT) : 1);
    if (a <= 0) return;
    const x0 = 150, x1 = 570, y = 84, w = x1 - x0, f = frac(bs), n = bs.ticks || c.maxHp;
    const hc = lighter(bs.c2, 0.3);
    R.lit(0);
    R.color(0, 0, 0, 0.55 * a); R.rect(x0 - 3, y - 3.5, w + 6, 7);
    R.color(bs.c2[0], bs.c2[1], bs.c2[2], 0.2 * a, 1); R.rect(x0, y - 1.5, w, 3);
    R.color(1, 1, 1, 0.5 * a, 1); R.rect(x0 + w * f, y - 1.5, w * Math.max(0, bs.hpShow - f), 3);
    R.color(hc[0], hc[1], hc[2], a, 1); R.rect(x0, y - 1.5, w * f, 3);
    R.color(hc[0], hc[1], hc[2], 0.35 * a, 1); R.soft(x0 + w * f, y, 14);
    R.color(0, 0, 0, 0.6 * a);
    for (let i = 1; i < n; i++) R.rect(x0 + (w * i) / n - 0.5, y - 1.5, 1, 3);
  }
  // Язык пламени от основания (bx0, by0)-(bx1, by1) через изгиб (mx, my) к острию (tx, ty): цвет col у основания
  // гаснет к острию в tip
  function tongue(bx0, by0, bx1, by1, mx, my, tx, ty, col, tip, a) {
    const hx = (bx1 - bx0) * 0.25, hy = (by1 - by0) * 0.25, mc = [(col[0] + tip[0]) / 2, (col[1] + tip[1]) / 2, (col[2] + tip[2]) / 2];
    R.color(col[0], col[1], col[2], a, 1); R.color2(mc[0], mc[1], mc[2], a * 0.7, 1);
    R.quadG(bx0, by0, bx1, by1, mx + hx, my + hy, mx - hx, my - hy);
    R.color(mc[0], mc[1], mc[2], a * 0.7, 1); R.color2(tip[0], tip[1], tip[2], 0, 1);
    R.quadG(mx - hx, my - hy, mx + hx, my + hy, tx, ty, tx, ty);
  }
  // Ломаная из точек [x0, y0, x1, y1, ...] — светящаяся нить
  function strand(pts, col, a, w) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      R.color(col[0], col[1], col[2], a * 0.3, 1); R.line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w * 3);
      R.color(col[0], col[1], col[2], a, 1); R.line(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], w);
    }
  }

  // ---------- Жар-змей ----------
  // Голова — сердце. Она гонится за точкой, бегущей по фигуре Лиссажу, и поворачивает не круче OM рад/с, так что
  // путь выходит плавными петлями. Сегменты тела стоят на следе головы, каждый на своём расстоянии позади,
  // и чуть извиваются поперёк. Выбитый сегмент оставляет дыру, которую хвост плавно догоняет.
  const OM = 1.7;
  const HEAD = [30, 0, 18, 15, -2, 20, -16, 13, -16, -13, -2, -20, 18, -15];
  function serpent(level, rng, tier) {
    const hue = rng.range(-0.02, 0.05);
    const bs = boss('ЖАР-ЗМЕЙ', level, rng, hue, tier);
    bs.period = 3.3 - 0.3 * tier;
    bs.eyeCol = [1, 0.78, 0.25];
    part(bs, 'core', HEAD, 'strong', 10 + 4 * tier, U.hsl(hue + 0.1, 0.9, 0.58), { density: 2 });
    const n = Math.min(14 + 2 * tier, 20);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), s = lerp(1, 0.5, u), a = 10 * s + 3, b = 15 * s + 5, strong = i % 4 === 1;
      const m = part(bs, 'seg', [a, 0, a * 0.45, b, -a * 0.45, b, -a, 0, -a * 0.45, -b, a * 0.45, -b],
        strong ? 'strong' : 'normal', strong ? 2 : 1, U.hsl(hue + 0.13 * u, 0.85, i % 2 ? 0.5 : 0.58), { note: 9 - Math.round(u * 6) });
      m.a = a * SZ; m.b = b * SZ;
    }
    bs.h = trail(); bs.hx = 360; bs.hy = 280; bs.hd = rng.range(0, TAU); bs.speed = 150;
    for (let i = 0; i < 600; i++) headStep(bs, 1 / 60); // проползает 10 с заранее: тело уже лежит на следе
    bs.bound = () => { bs.segs = bs.parts.filter(k => k.boss === 'seg'); };
    const at = (k, lx, ly, out) => {
      const c = Math.cos(k.ang), s = Math.sin(k.ang), q = k.show;
      out[0] = k.x + (lx * c - ly * s) * q * SZ; out[1] = k.y + (lx * s + ly * c) * q * SZ;
      return out;
    };
    const pa = [0, 0], pb = [0, 0];

    bs.pose = dt => {
      bs.speed += ((bs.dying ? 25 : rage(bs) ? 205 : 150) - bs.speed) * (1 - Math.exp(-dt * 2));
      headStep(bs, dt);
      const h = bs.core, rc = bs.recoil * 9;
      h.tx = bs.hx - Math.cos(bs.hd) * rc; h.ty = bs.hy - Math.sin(bs.hd) * rc; h.ta = bs.hd;
      let want = 16 * SZ;
      for (const k of bs.segs) {
        if (!k.alive) continue;
        want += k.m.a + 2;
        k.m.d = k.m.d === undefined ? want : k.m.d + (want - k.m.d) * (1 - Math.exp(-dt * 3));
        trailAt(bs.h, k.m.d, tp);
        const wig = 4.5 * SZ * Math.sin(bs.t * 4.2 - k.m.d * 0.05) * Math.min(1, k.m.d / 120) + (bs.dying ? (Math.random() - 0.5) * 6 : 0);
        k.tx = tp[0] - Math.sin(tp[2]) * wig; k.ty = tp[1] + Math.cos(tp[2]) * wig; k.ta = tp[2];
        want += k.m.a + 2;
      }
    };
    bs.fire = g => {
      const h = bs.core, [x, y] = at(h, 34, 0, pa), n = rage(bs) ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const [vx, vy] = aim(g, x, y, shotSpeed(bs, 270), (i - (n - 1) / 2) * 0.22);
        bs.api.shoot(x, y, vx, vy, 'fire', [1, 0.5, 0.15]);
      }
      bs.api.sfx('bossShot', 'fire', pan(x));
    };

    const mane = [1, 0.36, 0.08];
    bs.under = t => {
      const col = lighter(bs.c1, 0.2), fc = lighter(bs.c2, 0.35);
      R.lit(0);
      // огненная жемчужина, за которой гонится змей
      const pr = clamp((bs.t - ASSEMBLE) / 0.8, 0, 1) * (bs.dying ? Math.max(0, 1 - bs.deathT * 2) : 1);
      if (pr > 0) {
        const px = bs.gx, py = bs.gy, pu = 0.85 + 0.15 * Math.sin(t * 6);
        R.color(1, 0.55, 0.2, 0.3 * pr * pu, 1); R.soft(px, py, 30);
        for (let i = 0; i < 5; i++) {
          const a0 = t * 2.2 + (i / 5) * TAU, ca = Math.cos(a0), sa = Math.sin(a0);
          tongue(px + ca * 6 - sa * 3, py + sa * 6 + ca * 3, px + ca * 6 + sa * 3, py + sa * 6 - ca * 3,
            px + ca * 12 + sa * 4, py + sa * 12 - ca * 4, px + ca * 18 + sa * 9, py + sa * 18 - ca * 9, mane, [1, 0.85, 0.4], 0.6 * pr);
        }
        R.color(1, 0.95, 0.85, 0.9 * pr, 1); R.disc(px, py, 6.5);
        R.color(0.6, 0.85, 1, 0.5 * pr, 1); R.ring(px, py, 6.5, 0.3);
        R.color(1, 1, 1, pr, 1); R.disc(px - 2, py - 2, 1.8);
      }
      // хребет — светящаяся лента от головы через все сегменты
      let prev = bs.core.alive && !bs.core.ghost ? bs.core : null;
      for (const k of bs.segs) {
        if (!k.alive) continue;
        if (k.ghost) { prev = null; continue; }
        if (prev) {
          R.color(col[0], col[1], col[2], 0.16, 1); R.line(prev.x, prev.y, k.x, k.y, 10);
          R.color(fc[0], fc[1], fc[2], 0.45, 1); R.line(prev.x, prev.y, k.x, k.y, 2.4);
        }
        prev = k;
      }
      // грива по бокам — языки пламени, которые волной вспыхивают от головы к хвосту и загибаются назад
      for (const k of bs.segs) {
        if (!k.alive || k.ghost) continue;
        const ca = Math.cos(k.ang), sa = Math.sin(k.ang), m = k.m;
        for (const sd of [-1, 1]) {
          const fl = Math.sin(t * 5 - m.d * 0.04 + sd), len = m.b * (1.15 + 0.35 * fl), w = m.b * 0.75;
          const ox = -sa * sd, oy = ca * sd; // наружу от хребта
          const bx = k.x + ox * w, by = k.y + oy * w;
          const mx = bx + ox * len * 0.55 - ca * m.a * 0.9, my = by + oy * len * 0.55 - sa * m.a * 0.9;
          const tx = bx + ox * len * 0.8 - ca * m.a * (2.4 + 0.4 * fl), ty = by + oy * len * 0.8 - sa * m.a * (2.4 + 0.4 * fl);
          tongue(bx + ca * m.a * 0.6, by + sa * m.a * 0.6, bx - ca * m.a * 0.7, by - sa * m.a * 0.7, mx, my, tx, ty, mane, [1, 0.9, 0.5], 0.75);
        }
      }
      // хвост — огненная кисть, языки мерцают
      let last = null;
      for (const k of bs.segs) if (k.alive && !k.ghost) last = k;
      if (last) {
        for (let j = 0; j < 7; j++) {
          trailAt(bs.h, last.m.d + last.m.a + (4 + j * 7) * SZ, tp);
          const fl = 0.75 + 0.25 * Math.sin(t * 17 + j * 2.1), r = (12 - j * 1.4) * fl * SZ;
          R.color(1, 0.45 + j * 0.05, 0.12, 0.5 - j * 0.05, 1); R.soft(tp[0], tp[1], r * 1.8);
          R.color(1, 0.85, 0.5, 0.5 - j * 0.06, 1); R.disc(tp[0], tp[1], r * 0.35);
        }
      }
    };
    bs.over = t => {
      const h = bs.core;
      if (h.alive && h.show > 0) {
        const s = h.show;
        // рога — ветвистые, тёмное золото с бликом
        for (const sd of [-1, 1]) {
          const pts = [at(h, -6, 16 * sd, [0, 0]), at(h, -22, 26 * sd, [0, 0]), at(h, -41, 23 * sd, [0, 0])];
          const br = [at(h, -25, 26 * sd, [0, 0]), at(h, -31, 37 * sd, [0, 0])];
          R.lit(R.gi ? 0.8 : 0);
          R.color(0.42, 0.3, 0.12, 1);
          R.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], 4 * s); R.line(pts[1][0], pts[1][1], pts[2][0], pts[2][1], 3 * s);
          R.line(br[0][0], br[0][1], br[1][0], br[1][1], 2.6 * s);
          R.lit(0);
          R.color(1, 0.85, 0.45, 0.7);
          R.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], 1.2 * s); R.line(pts[1][0], pts[1][1], pts[2][0], pts[2][1], 1 * s);
          // усы струятся назад по следу головы
          const w = [];
          at(h, 25, 7 * sd, pa); w.push(pa[0], pa[1]);
          for (let d = 0; d <= 96; d += 8) {
            trailAt(bs.h, d * SZ, tp);
            const off = sd * (10 + d * 0.33 + 3.5 * Math.sin(t * 6 - d * 0.13)) * s * SZ;
            w.push(tp[0] - Math.sin(tp[2]) * off, tp[1] + Math.cos(tp[2]) * off);
          }
          for (let i = 0; i + 3 < w.length; i += 2) {
            const f = 1 - i / w.length;
            R.color(1, 0.8, 0.35, 0.7 * f, 1); R.line(w[i], w[i + 1], w[i + 2], w[i + 3], 1.6 * f + 0.4);
          }
        }
        // огненная грива за головой
        R.lit(0);
        for (const sd of [-1, 1]) {
          for (let i = 0; i < 4; i++) {
            const fl = Math.sin(t * 7 + i * 1.9 + sd), b0 = at(h, -2 - i * 5, (15 - i) * sd, [0, 0]), b1 = at(h, -9 - i * 5, (13 - i) * sd, [0, 0]);
            const m = at(h, -16 - i * 6, (25 + i * 2 + 2 * fl) * sd, [0, 0]), tp2 = at(h, -34 - i * 7 + 3 * fl, (31 + i * 4 + 3 * fl) * sd, [0, 0]);
            tongue(b0[0], b0[1], b1[0], b1[1], m[0], m[1], tp2[0], tp2[1], mane, [1, 0.85, 0.4], 0.8 * s);
          }
        }
        for (const sd of [-1, 1]) { at(h, 7, 9.5 * sd, pb); eye(pb[0], pb[1], 5.4 * s * SZ, bs, bs.eyeCol); }
        // ноздри тлеют, перед выстрелом пасть разгорается
        at(h, 31, 0, pa);
        R.color(1, 0.5, 0.15, 0.25 + 0.1 * Math.sin(t * 13), 1); R.soft(pa[0], pa[1], 9);
        chargeFx(bs, pa[0], pa[1], [1, 0.55, 0.2], t);
      }
      hpBar(bs);
    };
    bs.gi = () => {
      const h = bs.core;
      if (!h.alive || h.show <= 0) return;
      for (const sd of [-1, 1]) { at(h, 7, 9.5 * sd, pb); R.color(2.5, 1.8, 0.5, 1); R.disc(pb[0], pb[1], 3.5); }
      if (bs.charge > 0) { at(h, 33, 0, pa); const e = 5 * bs.charge; R.color(e, e * 0.5, e * 0.15, 1); R.disc(pa[0], pa[1], 6); }
      if (bs.born && !bs.dying) { R.color(3, 2, 1.2, 1); R.disc(bs.gx, bs.gy, 4); }
    };
    return bs;
  }
  function headStep(bs, dt) {
    bs.mt += dt;
    const t = bs.mt;
    // в пике жемчужина ныряет к ракетке, и голова за ней
    const low = bs.floor - 25; // ниже голова не опускается
    const gx = lerp(360 + 205 * Math.sin(0.31 * t + bs.p1), clamp(bs.fx, 140, 580), 0.6 * bs.dive);
    const gy = lerp(290 + 110 * Math.sin(0.53 * t + bs.p2), low - 70, bs.dive);
    bs.gx = gx; bs.gy = gy;
    let dx = gx - bs.hx, dy = gy - bs.hy;
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    // у стен — разворот: если точка в 80 px впереди головы уже за краем, голова сворачивает к середине поля,
    // и тем круче, чем дальше за край та точка
    const fx = bs.hx + Math.cos(bs.hd) * 80, fy = bs.hy + Math.sin(bs.hd) * 80;
    const w = clamp((Math.max(120 - fx, fx - 600, 0) + Math.max(170 - fy, fy - lerp(480, low - 40, bs.dive), 0)) / 50, 0, 1);
    let om = OM;
    if (w > 0) {
      const mx = 360 - bs.hx, my = 300 - bs.hy, ml = Math.hypot(mx, my) || 1;
      dx += (mx / ml) * 3 * w; dy += (my / ml) * 3 * w; om = OM * (1 + 2.5 * w);
    }
    bs.hd += clamp(wrap(Math.atan2(dy, dx) - bs.hd), -om * dt, om * dt) + Math.cos(t * 2.6) * 0.9 * dt;
    bs.hx = clamp(bs.hx + Math.cos(bs.hd) * bs.speed * dt, 60, 660);
    bs.hy = clamp(bs.hy + Math.sin(bs.hd) * bs.speed * dt, 112, Math.max(low, 300));
    trailPush(bs.h, bs.hx, bs.hy);
  }

  // ---------- Лунная медуза ----------
  // Колокол — две дуги секторов над сердцем; он дышит: сектора расходятся и сходятся, и на каждом сжатии медуза
  // чуть подскакивает. Щупальца — верёвки из круглых кирпичей с прочными огненными колбами на концах (не взрывными:
  // колбы висят тесно, и взрыв одной цепочкой снёс бы все щупальца разом); качаются и тянутся
  // за медузой. Перебитое щупальце ниже удара отрывается.
  const BELL = 92, BELL_T = 26;
  function jelly(level, rng, tier) {
    const hue = rng.range(0.48, 0.58);
    const bs = boss('ЛУННАЯ МЕДУЗА', level, rng, hue, tier);
    bs.period = 3.6 - 0.3 * tier;
    bs.eyeCol = lighter(U.hsl(hue + 0.4, 0.8, 0.6), 0.1);
    bs.fem = true; // «медуза повержена»
    bs.sporeCol = U.hsl(hue + 0.35, 0.9, 0.65);
    const sector = (r0, r1, th, h, bulge) => {
      const pts = [[r1, th - h], [r1 + bulge, th], [r1, th + h], [r0, th + h], [r0, th - h]]
        .map(([r, a]) => [r * Math.cos(a), r * Math.sin(a)]);
      const cx = pts.reduce((s, p) => s + p[0], 0) / 5, cy = pts.reduce((s, p) => s + p[1], 0) / 5;
      return { local: pts.flatMap(p => [p[0] - cx, p[1] - cy]), cx, cy };
    };
    const K = 7;
    for (let j = 0; j < K; j++) {
      const sc = sector(BELL - BELL_T, BELL, Math.PI + ((j + 0.5) / K) * Math.PI, Math.PI / K / 2 - 0.04, 3);
      const m = part(bs, 'bell', sc.local, j % 2 ? 'strong' : 'normal', j % 2 ? 2 : 1,
        U.hsl(hue + 0.05 * Math.sin(j * 1.3), 0.6, j % 2 ? 0.46 : 0.58), { note: 8 });
      m.ox = sc.cx; m.oy = sc.cy;
    }
    for (let j = 0; j < 5; j++) {
      const span = Math.PI - 0.7, sc = sector(50, 68, Math.PI + 0.35 + ((j + 0.5) / 5) * span, span / 10 - 0.04, 1.5);
      const m = part(bs, 'inner', sc.local, 'normal', 1, U.hsl(hue + 0.1, 0.55, 0.7), { note: 7 });
      m.ox = sc.cx; m.oy = sc.cy;
    }
    part(bs, 'core', P.ngon(20, 21), 'strong', 10 + 4 * tier, U.hsl(hue + 0.12, 0.45, 0.78), { circle: 21, density: 2 });
    bs.tents = [];
    for (let i = 0; i < 6; i++) {
      const n = i === 0 || i === 5 ? 5 : 6, chain = [];
      for (let j = 0; j < n; j++) {
        const tip = j === n - 1, r = tip ? 9 : lerp(8.5, 5.5, j / (n - 2));
        const m = part(bs, 'tent', P.ngon(16, r), tip ? 'strong' : 'normal', tip ? 2 : 1,
          tip ? [1, 0.33, 0.08] : U.hsl(hue - 0.04 + 0.03 * j, 0.7, 0.6 - 0.03 * j), { circle: r, note: 3 });
        m.tent = i; m.j = j;
        chain.push(m);
      }
      bs.tents.push({ ax: lerp(-0.8, 0.8, i / 5) * BELL, chain, r: rope(n, 17, 360, 300) });
    }
    bs.ph = rng.range(0, TAU); bs.tilt = 0; bs.cx = null;
    bs.bound = () => {
      for (const tn of bs.tents) tn.chain = tn.chain.map(m => bs.parts.find(k => k.m === m));
    };
    let s = 1, cx = 360, cy = 250, cr = 1, sr = 0;
    const at = (x, y, out) => { out[0] = cx + (x * cr - y * sr) * SZ; out[1] = cy + (x * sr + y * cr) * SZ; return out; };
    const pa = [0, 0];

    bs.pose = dt => {
      bs.ph += (rage(bs) ? 2.9 : 2.1) * dt * (bs.dying ? 0.3 : 1);
      bs.mt += dt;
      const t = bs.mt;
      s = 1 + 0.075 * Math.sin(bs.ph);
      const s2 = 1 + 0.06 * Math.sin(bs.ph - 0.7);
      let nx = 360 + 185 * Math.sin(0.19 * t + bs.p1), ny = 265 + 45 * Math.sin(0.33 * t + bs.p2);
      // пике: опускается к ракетке, щупальцами почти до неё, и тянется к ней вбок
      ny += sink(bs, ny, 130 * SZ) - 9 * Math.sin(bs.ph);
      nx = clamp(lerp(nx, bs.fx, 0.55 * bs.dive), 140, 580);
      const vx = bs.cx === null ? 0 : (nx - bs.cx) / dt;
      bs.cx = nx; cx = nx; cy = ny;
      if (bs.dying) { cx += (Math.random() - 0.5) * 4; cy += (Math.random() - 0.5) * 4; }
      bs.tilt += (clamp(vx * 0.004, -0.3, 0.3) - bs.tilt) * (1 - Math.exp(-dt * 2));
      const rot = bs.tilt + 0.05 * Math.sin(t * 1.3);
      cr = Math.cos(rot); sr = Math.sin(rot);
      for (const k of bs.parts) {
        if (!k.alive) continue;
        if (k.boss === 'bell' || k.boss === 'inner') {
          const q = k.boss === 'bell' ? s : s2;
          at(k.m.ox * q, k.m.oy * q, pa); k.tx = pa[0]; k.ty = pa[1]; k.ta = rot;
        } else if (k.boss === 'core') { at(0, -26 * s, pa); k.tx = pa[0]; k.ty = pa[1]; k.ta = rot; }
      }
      bs.tents.forEach((tn, i) => {
        cut(bs, tn.chain, tn.r);
        // щупальца чуть расходятся веером, и волна качания бежит по ним по очереди — так они не путаются
        at(tn.ax * s, 6, pa);
        const fan = (tn.ax / BELL) * 80;
        ropeStep(tn.r, pa[0], pa[1], -sr * 300 + cr * fan, cr * 300 + sr * fan, 110, t * 1.6 + i * 0.45, dt);
        tn.chain.forEach((k, j) => {
          if (!k.alive) return;
          const r = tn.r;
          k.tx = r.x[j + 1]; k.ty = r.y[j + 1]; k.ta = Math.atan2(r.y[j + 1] - r.y[j], r.x[j + 1] - r.x[j]);
        });
      });
    };
    bs.fire = g => {
      const c = bs.core, n = rage(bs) ? 7 : 5, y = c.y + 18 * SZ;
      for (let i = 0; i < n; i++) {
        const [vx, vy] = aim(g, c.x, y, shotSpeed(bs, 150), (i - (n - 1) / 2) * 0.26);
        bs.api.shoot(c.x, y, vx, vy, 'spore', bs.sporeCol);
      }
      bs.api.sfx('bossShot', 'spore', pan(c.x));
    };

    bs.under = t => {
      const a = clamp((bs.t - 1.2) / 1.2, 0, 1) * (bs.dying ? Math.max(0, 1 - bs.deathT * 1.5) : 1);
      if (a <= 0) return;
      const c1 = bs.c1, c2 = lighter(bs.c2, 0.3);
      // студень колокола — полупрозрачный купол за кирпичами
      const dome = [];
      at(0, 0, pa); dome.push(pa[0], pa[1]);
      for (let i = 0; i <= 16; i++) { const th = Math.PI + (i / 16) * Math.PI; at(Math.cos(th) * (BELL + 6) * s, Math.sin(th) * (BELL + 6) * s, pa); dome.push(pa[0], pa[1]); }
      R.lit(0);
      R.color(c1[0], c1[1], c1[2], 0.13 * a, 1); R.poly(dome);
      at(0, -30, pa);
      R.color(c2[0], c2[1], c2[2], 0.2 * a * (0.75 + 0.25 * Math.sin(bs.ph)), 1); R.soft(pa[0], pa[1], 120 * s * SZ);
      // нити щупалец
      for (const tn of bs.tents) {
        const r = tn.r, pts = [];
        for (let j = 0; j <= r.n; j++) pts.push(r.x[j], r.y[j]);
        strand(pts, c2, 0.4 * a, 1.6);
      }
      // ротовые лопасти — волнистые ленты из-под сердца
      for (let i = -1; i <= 1; i++) {
        const pts = [];
        for (let y = 0; y <= 84; y += 7) { at(i * 13 + Math.sin(t * 2.2 + y * 0.07 + i * 2) * (3 + y * 0.12), -8 + y, pa); pts.push(pa[0], pa[1]); }
        strand(pts, lighter(bs.c1, 0.4), 0.22 * a, 3);
      }
    };
    bs.over = t => {
      const c = bs.core;
      // по краю колокола бегут огоньки
      const a = clamp((bs.t - ASSEMBLE + 0.4) / 0.6, 0, 1) * (bs.dying ? 0 : 1);
      for (let i = 0; i < 10 && a > 0; i++) {
        const th = Math.PI + ((t * 0.09 + i / 10) % 1) * Math.PI, tw = 0.55 + 0.45 * Math.sin(t * 5 + i * 1.7);
        at(Math.cos(th) * (BELL + 4) * s, Math.sin(th) * (BELL + 4) * s, pa);
        const lc = lighter(U.hsl(0.5 + i * 0.05 + t * 0.02, 0.9, 0.6), 0.2);
        R.color(lc[0], lc[1], lc[2], 0.35 * tw * a, 1); R.soft(pa[0], pa[1], 9);
        R.color(lc[0], lc[1], lc[2], tw * a, 1); R.disc(pa[0], pa[1], 2);
      }
      if (c.alive && c.show > 0) {
        eye(c.x, c.y, 12.5 * c.show * SZ, bs, bs.eyeCol);
        chargeFx(bs, c.x, c.y + 18 * SZ, bs.sporeCol, t);
      }
      hpBar(bs);
    };
    bs.gi = () => {
      const c = bs.core;
      if (!c.alive || c.show <= 0) return;
      const e = 1.6 + 3 * bs.charge, k = bs.eyeCol;
      R.color(k[0] * e, k[1] * e, k[2] * e, 1); R.disc(c.x, c.y, 8 * SZ);
    };
    return bs;
  }

  // ---------- Ночной скат ----------
  // Ромб тела с сердцем-самоцветом, рожки спереди, стальная пластина на спине. Крылья — панели в два ряда; по ним
  // от тела к концам бежит волна взмаха: панели сходятся к телу (крыло поднято и видно в проекции короче),
  // смещаются вперёд-назад и светлеют, повернувшись к свету. За телом вьётся хвост-хлыст на верёвке.
  // Жизнь ската — во всём теле: каждая выбитая единица прочности крыла или тела убавляет шкалу на 1, хвоста —
  // на 0,5, а глаза — на EYE_W; шкала — это EYE ударов в глаз. Теряя крылья, скат проседает к ракетке, кренится
  // на побитый бок и машет чаще.
  const WROOT = 30, WSPAN = 175, WAMP = 0.5, EYE_W = 4;
  const wLead = u => 34 - 74 * u ** 1.1, wTrail = u => -46 - 4 * u;
  function manta(level, rng, tier) {
    const hue = rng.range(0.72, 0.8);
    const bs = boss('НОЧНОЙ СКАТ', level, rng, hue, tier);
    bs.period = 3.1 - 0.3 * tier;
    bs.eyeCol = [0.45, 1, 0.85];
    bs.dartCol = [0.8, 0.5, 1];
    const put = (role, local, x, y, kind, hp, col, o) => { const m = part(bs, role, local, kind, hp, col, o); m.ox = x; m.oy = y; return m; };
    const EYE = 6 + 2 * tier;
    put('core', P.ngon(20, 16), 0, 0, 'strong', EYE, U.hsl(hue + 0.45, 0.6, 0.62), { circle: 16, density: 2 });
    put('body', [-24, -7, 24, -7, 16, 9, -16, 9], 0, 27, 'normal', 1, U.hsl(hue, 0.5, 0.45));
    const fin = [-5, -9, 6, -5, 1, 13];
    put('fin', fin, -22, 44, 'normal', 1, U.hsl(hue + 0.05, 0.7, 0.6));
    put('fin', P.mirrorX(fin), 22, 44, 'normal', 1, U.hsl(hue + 0.05, 0.7, 0.6));
    put('body', [-17, -9, 17, -9, 12, 9, -12, 9], 0, -28, 'steel', 1, [0.56, 0.6, 0.68]);
    const cols = [0, 0.25, 0.5, 0.72, 0.88, 1];
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const u0 = cols[i], u1 = cols[i + 1], x0 = WROOT + WSPAN * u0, x1 = WROOT + WSPAN * u1;
        const rows = i < 3 ? [[wLead, u => (wLead(u) + wTrail(u)) / 2], [u => (wLead(u) + wTrail(u)) / 2, wTrail]] : [[wLead, wTrail]];
        rows.forEach(([top, bot], row) => {
          let q = P.inset([x0, top(u0), x1, top(u1), x1, bot(u1), x0, bot(u0)], 2.2);
          const cx = (q[0] + q[2] + q[4] + q[6]) / 4, cy = (q[1] + q[3] + q[5] + q[7]) / 4;
          q = q.map((v, j) => (j % 2 ? v - cy : v - cx));
          if (sd < 0) q = P.mirrorX(q);
          const uc = (cx - WROOT) / WSPAN;
          const m = put('wing', q, cx * sd, cy, i === 0 ? 'strong' : 'normal', i === 0 ? 2 : 1,
            U.hsl(hue - 0.13 * uc, 0.72, row ? 0.4 : 0.54), { note: 4 + i });
          m.u = uc; m.u1 = u1; m.sd = sd;
        });
      }
    }
    bs.tail = [];
    for (let j = 0; j < 8; j++) {
      const z = lerp(7, 3.5, j / 7), last = j === 7;
      bs.tail.push(part(bs, 'tail', last ? [0, -13, 6, 5, -6, 5] : [0, -z * 1.6, z, 0, 0, z * 1.6, -z, 0],
        last ? 'strong' : 'normal', last ? 2 : 1, U.hsl(hue + 0.05 * j, 0.7, 0.55), { note: 2 }));
    }
    bs.r = rope(8, 12, 360, 200);
    bs.ph = rng.range(0, TAU); bs.bank = 0; bs.cx = null; bs.lift = 1; bs.list = 0;
    bs.reach = [1, 1]; // докуда (доля размаха) уцелело левое и правое крыло — до туда кромка, перепонка и огонь
    bs.worth = k => k.boss === 'core' ? EYE_W : k.boss === 'tail' ? 0.5 : k.kind === 'steel' ? 0 : 1;
    bs.bar = EYE_W * EYE; bs.ticks = EYE;
    bs.bound = () => {
      bs.tail = bs.tail.map(m => bs.parts.find(k => k.m === m));
      bs.wings = bs.parts.filter(k => k.boss === 'wing');
      bs.wingHp = bs.wings.reduce((s, k) => s + k.maxHp, 0);
    };
    let cx = 360, cy = 250, cr = 1, sr = 0;
    const at = (x, y, out) => { out[0] = cx + (x * cr - y * sr) * SZ; out[1] = cy + (x * sr + y * cr) * SZ; return out; };
    const phi = u => WAMP * Math.sin(bs.ph - 1.3 * u) * u;
    // Видимый размах до доли u: крыло изогнуто волной, и в проекции каждый его кусок короче в cos(φ) раз
    const span = u => { let x = 0; for (let i = 0; i < 6; i++) x += Math.cos(phi(((i + 0.5) / 6) * u)); return WROOT + (WSPAN * u * x) / 6; };
    const wave = u => 10 * Math.sin(bs.ph - 1.3 * u) * u;
    const pa = [0, 0], tips = [[0, 0], [0, 0]], armed = [true, true];
    // стреляют концы крыльев, пока от крыла что-то осталось; бескрылый или разъярённый скат бьёт и со лба
    const brow = () => rage(bs) || !armed[0] && !armed[1];

    bs.pose = dt => {
      // подъёмная сила — сколько крыла осталось; крен — на тот бок, где его меньше
      let l = 0, r = 0, ul = 0, ur = 0;
      for (const k of bs.wings) if (k.alive) { if (k.m.sd < 0) { l += k.hp; ul = Math.max(ul, k.m.u1); } else { r += k.hp; ur = Math.max(ur, k.m.u1); } }
      const ke = 1 - Math.exp(-dt * 1.5), kr = 1 - Math.exp(-dt * 6);
      bs.reach[0] += (ul - bs.reach[0]) * kr; bs.reach[1] += (ur - bs.reach[1]) * kr;
      bs.lift += ((l + r) / bs.wingHp - bs.lift) * ke;
      bs.list += ((l - r) / bs.wingHp * 0.5 - bs.list) * ke;
      bs.ph += (rage(bs) ? 3.4 : 2.4) * (1 + 0.6 * (1 - bs.lift)) * dt * (bs.dying ? 0.35 : 1);
      bs.mt += dt;
      const t = bs.mt;
      let nx = 360 + 98 * Math.sin(0.26 * t + bs.p1), ny = 320 + 50 * Math.sin(0.52 * t + bs.p2) + 110 * (1 - bs.lift);
      // пике: скользит к ракетке и тянется к ней вбок; концы крыльев (236 px от середины) не уходят в стены
      ny += sink(bs, ny, 70 * SZ) + 5 * Math.sin(bs.ph);
      nx = clamp(lerp(nx, bs.fx, 0.5 * bs.dive), 262, 458);
      const vx = bs.cx === null ? 0 : (nx - bs.cx) / dt;
      bs.cx = nx; cx = nx; cy = ny;
      if (bs.dying) { cx += (Math.random() - 0.5) * 4; cy += (Math.random() - 0.5) * 4; }
      bs.bank += (clamp(-vx * 0.0022, -0.3, 0.3) + bs.list - bs.bank) * (1 - Math.exp(-dt * 2));
      cr = Math.cos(bs.bank); sr = Math.sin(bs.bank);
      for (const k of bs.parts) {
        if (!k.alive) continue;
        const m = k.m;
        if (k.boss === 'wing') {
          at(m.sd * span(m.u), m.oy + wave(m.u), pa);
          k.color = shade(k.base, 0.82 + 0.3 * Math.sin(phi(m.u) + 0.3));
        } else if (k.boss === 'fin') at(m.ox, m.oy + 2 * Math.sin(bs.ph * 1.5), pa);
        else if (k.boss !== 'tail') at(m.ox, m.oy, pa);
        else continue;
        k.tx = pa[0]; k.ty = pa[1]; k.ta = bs.bank;
      }
      cut(bs, bs.tail, bs.r);
      at(0, -44, pa);
      ropeStep(bs.r, pa[0], pa[1], sr * 260, -cr * 260, 170, t * 2.6, dt);
      bs.tail.forEach((k, j) => {
        if (!k.alive) return;
        const r = bs.r;
        k.tx = r.x[j + 1]; k.ty = r.y[j + 1]; k.ta = Math.atan2(r.y[j + 1] - r.y[j], r.x[j + 1] - r.x[j]) - Math.PI / 2;
      });
      for (const sd of [0, 1]) {
        const u = bs.reach[sd];
        armed[sd] = u > 0.15;
        at((sd ? 1 : -1) * span(u), (wLead(u) + wTrail(u)) / 2 + wave(u), tips[sd]);
      }
    };
    bs.fire = g => {
      tips.forEach((q, i) => {
        if (!armed[i]) return;
        const [vx, vy] = aim(g, q[0], q[1], shotSpeed(bs, 380), 0);
        bs.api.shoot(q[0], q[1], vx, vy, 'dart', bs.dartCol);
      });
      if (brow()) {
        at(0, 36, pa);
        const [vx, vy] = aim(g, pa[0], pa[1], shotSpeed(bs, 380), 0);
        bs.api.shoot(pa[0], pa[1], vx, vy, 'dart', bs.dartCol);
      }
      bs.api.sfx('bossShot', 'dart', pan(cx));
    };

    bs.under = t => {
      const a = clamp((bs.t - 1.4) / 1.0, 0, 1) * (bs.dying ? Math.max(0, 1 - bs.deathT * 1.5) : 1);
      if (a <= 0) return;
      const c1 = bs.c1, c2 = lighter(bs.c2, 0.35);
      R.lit(0);
      at(0, 0, pa);
      R.color(c2[0], c2[1], c2[2], 0.16 * a, 1); R.soft(pa[0], pa[1], 95 * SZ);
      // перепонки крыльев и неоновая передняя кромка
      for (const sd of [-1, 1]) {
        const v = [], lead = [];
        at(sd * WROOT, (wLead(0) + wTrail(0)) / 2, pa); v.push(pa[0], pa[1]);
        const ru = bs.reach[sd < 0 ? 0 : 1];
        if (ru < 0.05) continue;
        for (let i = 0; i <= 8; i++) { const u = (i / 8) * ru; at(sd * span(u), wLead(u) + 3 + wave(u), pa); v.push(pa[0], pa[1]); lead.push(pa[0], pa[1]); }
        for (let i = 8; i >= 0; i--) { const u = (i / 8) * ru; at(sd * span(u), wTrail(u) - 3 + wave(u), pa); v.push(pa[0], pa[1]); }
        R.color(c1[0], c1[1], c1[2], 0.16 * a, 1); R.poly(v);
        strand(lead, c2, 0.6 * a, 1.5);
      }
      const r = bs.r, pts = [];
      for (let j = 0; j <= r.n; j++) pts.push(r.x[j], r.y[j]);
      strand(pts, c2, 0.45 * a, 1.6);
    };
    bs.over = t => {
      const c = bs.core;
      if (c.alive && c.show > 0) {
        eye(c.x, c.y, 10 * c.show * SZ, bs, bs.eyeCol);
        tips.forEach((q, i) => { if (armed[i]) chargeFx(bs, q[0], q[1], bs.dartCol, t); });
        if (brow()) { at(0, 36, pa); chargeFx(bs, pa[0], pa[1], bs.dartCol, t); }
      }
      // кончики крыльев мерцают огоньками
      if (bs.born && !bs.dying) {
        for (let i = 0; i < 2; i++) {
          if (!armed[i]) continue;
          const q = tips[i], tw = 0.5 + 0.5 * Math.sin(t * 4 + q[0] * 0.05);
          R.color(bs.dartCol[0], bs.dartCol[1], bs.dartCol[2], 0.3 * tw, 1); R.soft(q[0], q[1], 12);
        }
      }
      hpBar(bs);
    };
    bs.gi = () => {
      const c = bs.core;
      if (!c.alive || c.show <= 0) return;
      const k = bs.eyeCol, e = 1.6 + 3 * bs.charge;
      R.color(k[0] * e, k[1] * e, k[2] * e, 1); R.disc(c.x, c.y, 6.5 * SZ);
      if (bs.charge > 0) tips.forEach((q, i) => { if (!armed[i]) return; const d = bs.dartCol, f = 5 * bs.charge; R.color(d[0] * f, d[1] * f, d[2] * f, 1); R.disc(q[0], q[1], 5); });
    };
    return bs;
  }

  // ---------- ИИ-Горгона ----------
  // Голова-маска из стальных пластин, во лбу — третий глаз-сердце, вместо рта — строка бегущего кода. Волосы —
  // змеи-верёвки из кирпичей-ячеек: на каждой горит зелёная цифра 0 или 1, цифры то и дело перещёлкиваются,
  // а со змей осыпается двоичный дождь; на концах — змеиные головы. Атака — взгляд: глаза-фонари разгораются,
  // пунктир прицела ложится туда, где ракетка сейчас, и через миг оттуда бьют два зелёных конуса света. Пятно
  // взгляда ползёт за ракеткой не быстрее GAZE_SPEED; ракетка, задержавшаяся в конусе, каменеет (game.js:
  // рывок сквозь луч проходит), и взгляд гаснет.
  // Разбитый фонарь не светит; без обоих смотрит третий глаз. Жизнь общая на всё тело, как у ската.
  const GAZE = 2.4, GAZE_HALF = 0.075, GAZE_SPEED = 300, GORGON_EYE_W = 4;
  const GREEN = [0.4, 1, 0.5];
  // Пластины лица левой половины (правая — зеркальная) и середины: [точки, прочность]; кирпич выпуклый —
  // берём оболочку точек
  const FACE_L = [
    [[[-50, -40], [-46, -62], [-30, -72], [-17, -70], [-17, -40]], 2], // лоб
    [[[-58, -26], [-52, -36], [-16, -36], [-12, -28], [-16, -23]], 1], // бровь
    [[[-62, -2], [-60, -22], [-44, -20], [-42, 8], [-54, 14]], 1],     // скула
    [[[-50, 16], [-40, 8], [-16, 12], [-14, 26], [-36, 30]], 1],       // щека
  ];
  const FACE_C = [
    [[[-6, -22], [6, -22], [8, 4], [0, 10], [-8, 4]], 1],                // нос
    [[[-32, 34], [32, 34], [22, 52], [0, 60], [-22, 52]], 2],            // подбородок
  ];
  const LAMPS = [[-28, -8], [28, -8]], LAMP_R = 11, THIRD = [0, -53];
  function hull(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // Цифра 0 или 1 высотой h с центром (x, y) — неоновыми штрихами; glow — ширина ореола (0 — без него)
  function glyph(d, x, y, h, a, glow) {
    const w = h * 0.3, hh = h / 2, c = GREEN;
    const stroke = (x0, y0, x1, y1) => {
      if (glow) { R.color(c[0], c[1], c[2], a * 0.25, 1); R.line(x0, y0, x1, y1, glow); }
      R.color(0.75, 1, 0.8, a, 1); R.line(x0, y0, x1, y1, Math.max(1, h * 0.14));
    };
    if (d) { stroke(x, y - hh, x, y + hh); stroke(x, y - hh, x - w, y - hh + w); }
    else {
      let px = x + w, py = y;
      for (let i = 1; i <= 8; i++) { const a2 = (i / 8) * TAU, nx = x + Math.cos(a2) * w, ny = y + Math.sin(a2) * hh; stroke(px, py, nx, ny); px = nx; py = ny; }
    }
  }

  function gorgon(level, rng, tier) {
    const hue = rng.range(0.33, 0.38);
    const bs = boss('ИИ-ГОРГОНА', level, rng, hue, tier);
    bs.fem = true; // «Горгона повержена»
    bs.period = 6.2 - 0.4 * tier;
    bs.eyeCol = [0.5, 1, 0.55];
    const EYE = 8 + 2 * tier;
    const put = (role, local, x, y, kind, hp, col, o) => { const m = part(bs, role, local, kind, hp, col, o); m.ox = x; m.oy = y; return m; };
    const plate = ([pts, hp], i) => {
      const h = hull(pts), cx = h.reduce((s, p) => s + p[0], 0) / h.length, cy = h.reduce((s, p) => s + p[1], 0) / h.length;
      put('face', h.flatMap(p => [p[0] - cx, p[1] - cy]), cx, cy, hp > 1 ? 'strong' : 'normal', hp, U.hsl(hue + 0.03 * Math.sin(i * 2.1), 0.22, 0.3 + 0.05 * (i % 2)), { note: 6 });
    };
    put('core', P.ngon(18, 13), THIRD[0], THIRD[1], 'strong', EYE, U.hsl(hue, 0.5, 0.7), { circle: 13, density: 2 });
    FACE_L.forEach(plate);
    FACE_L.forEach(([pts, hp], i) => plate([pts.map(([x, y]) => [-x, y]), hp], i + 4));
    FACE_C.forEach((f, i) => plate(f, i + 8));
    LAMPS.forEach(([x, y]) => put('lamp', P.ngon(16, LAMP_R), x, y, 'strong', 3, [0.5, 0.95, 0.55], { circle: LAMP_R }));
    // змеи: семь вверх и в стороны, две свисают по бокам; ячейки с цифрами и голова на конце
    bs.snakes = [];
    const angs = [];
    for (let i = 0; i < 7; i++) angs.push(Math.PI + 0.3 + (i * (Math.PI - 0.6)) / 6);
    angs.push(Math.PI - 0.55, 0.55);
    angs.forEach((th, i) => {
      const chain = [];
      for (let j = 0; j < 5; j++) {
        const m = part(bs, 'cell', P.ngon(8, 6.6), 'normal', 1, U.hsl(hue + 0.02 * j, 0.6, 0.2 + 0.04 * j), { note: 3 + (j % 3) });
        m.bit = rng.int(0, 1); m.ft = rng.range(0.2, 1.2);
        chain.push(m);
      }
      chain.push(part(bs, 'fang', [10, 0, 1, 6.5, -6, 4, -6, -4, 1, -6.5], 'strong', 2, U.hsl(hue - 0.03, 0.75, 0.42), { note: 2 }));
      const up = th > Math.PI, dx = Math.cos(th) * (up ? 1.2 : 1), dy = Math.sin(th) + (up ? 0 : 0.5), dl = Math.hypot(dx, dy);
      bs.snakes.push({ ax: Math.cos(th) * 56, ay: Math.sin(th) * 64 - 10, fx: dx / dl, fy: dy / dl, chain, r: rope(6, 13, 360, 300), ph: rng.range(0, TAU) });
    });
    bs.worth = k => ({ core: GORGON_EYE_W, lamp: 1.5, face: 1, cell: 0.25, fang: 0.4 })[k.boss] || 0;
    bs.bar = GORGON_EYE_W * EYE; bs.ticks = EYE;
    bs.bound = () => {
      for (const sn of bs.snakes) sn.chain = sn.chain.map(m => bs.parts.find(k => k.m === m));
      bs.lamps = bs.parts.filter(k => k.boss === 'lamp');
    };
    bs.cx = null; bs.rot = 0; bs.still = 0;
    bs.gazeT = 0; bs.open = 0; bs.aimX = 0; bs.aimY = 900; bs.aimed = false;
    bs.rain = []; bs.code = 0b1011001110001011; bs.codeT = 0;
    let cx = 360, cy = 280, cr = 1, sr = 0;
    const at = (x, y, out) => { out[0] = cx + (x * cr - y * sr) * SZ; out[1] = cy + (x * sr + y * cr) * SZ; return out; };
    const pa = [0, 0], pb = [0, 0];
    // Откуда смотрит взгляд: живые фонари, а без них — третий глаз
    const srcs = [], sl = [{ col: [0, 0, 0] }, { col: [0, 0, 0] }];
    function sources() {
      srcs.length = 0;
      for (const k of bs.lamps) if (k.alive && !k.ghost) srcs.push(k);
      if (!srcs.length && bs.core.alive) srcs.push(bs.core);
      return srcs;
    }
    const beamAng = k => Math.atan2(bs.aimY - k.y, bs.aimX - k.x);

    bs.pose = (dt, g) => {
      bs.mt += dt;
      const t = bs.mt, p = g.paddle;
      let nx = 360 + 130 * Math.sin(0.21 * t + bs.p1), ny = 310 + 30 * Math.sin(0.37 * t + bs.p2);
      // пике: опускается к ракетке, тянется к ней вбок
      ny += sink(bs, ny, 125 * SZ);
      nx = clamp(lerp(nx, bs.fx, 0.5 * bs.dive), 185, 535);
      const vx = bs.cx === null ? 0 : (nx - bs.cx) / dt;
      bs.cx = nx; cx = nx; cy = ny;
      if (bs.dying) { cx += (Math.random() - 0.5) * 4; cy += (Math.random() - 0.5) * 4; }
      // голова покачивается, а когда смотрит — замирает
      bs.still += ((bs.charging || bs.gazeT > 0 ? 1 : 0) - bs.still) * (1 - Math.exp(-dt * 4));
      bs.rot += (clamp(vx * 0.002, -0.2, 0.2) * (1 - bs.still) + 0.08 * Math.sin(t * 0.9) * (1 - bs.still) - bs.rot) * (1 - Math.exp(-dt * 2));
      cr = Math.cos(bs.rot); sr = Math.sin(bs.rot);
      for (const k of bs.parts) {
        if (!k.alive || k.boss === 'cell' || k.boss === 'fang') continue;
        at(k.m.ox, k.m.oy, pa); k.tx = pa[0]; k.ty = pa[1]; k.ta = bs.rot;
      }
      // змеи вьются: тянутся наружу и бегут поперечной волной
      bs.snakes.forEach(sn => {
        cut(bs, sn.chain, sn.r);
        at(sn.ax, sn.ay, pa);
        const gx = sn.fx * cr - sn.fy * sr, gy = sn.fx * sr + sn.fy * cr;
        ropeStep(sn.r, pa[0], pa[1], gx * 250, gy * 250, 190, t * 3.2 + sn.ph, dt);
        sn.chain.forEach((k, j) => {
          if (!k.alive) return;
          const r = sn.r;
          k.tx = r.x[j + 1]; k.ty = r.y[j + 1]; k.ta = Math.atan2(r.y[j + 1] - r.y[j], r.x[j + 1] - r.x[j]);
          if (k.boss === 'cell' && (k.m.ft -= dt) <= 0) { k.m.ft = 0.2 + Math.random(); if (Math.random() < 0.6) k.m.bit ^= 1; }
        });
      });
      // бегущий код во рту и двоичный дождь со змей
      if ((bs.codeT += dt) > 0.12) { bs.codeT = 0; bs.code = ((bs.code << 1) | (Math.random() < 0.5 ? 1 : 0)) & 0xffff; }
      if (bs.born && !bs.dying && bs.rain.length < 60 && Math.random() < dt * 22) {
        const sn = bs.snakes[Math.floor(Math.random() * bs.snakes.length)], k = sn.chain[Math.floor(Math.random() * 5)];
        if (k && k.alive && !k.ghost) bs.rain.push({ x: k.x, y: k.y, vy: 40 + Math.random() * 50, life: 1.3, d: Math.random() < 0.5 ? 1 : 0 });
      }
      for (const q of bs.rain) { q.y += q.vy * dt; q.life -= dt; }
      bs.rain = bs.rain.filter(q => q.life > 0);
      // взгляд: заряд прицеливается туда, где ракетка сейчас; потом пятно ползёт за ней
      if (bs.charging && !bs.aimed) { bs.aimed = true; bs.aimX = p.x; }
      if (!bs.charging) bs.aimed = false;
      bs.aimY = p.y;
      if (bs.gazeT > 0) {
        bs.gazeT -= dt;
        if (bs.dying || g.state !== 'play') bs.gazeT = 0;
        bs.open = Math.min(1, bs.open + dt / 0.15);
        let hit = false;
        for (const k of sources()) {
          const d = Math.hypot(bs.aimX - k.x, bs.aimY - k.y), w = d * Math.tan(GAZE_HALF * bs.open) * 0.85;
          if (Math.abs(p.x - bs.aimX) < w + p.hw + p.r * 0.5) hit = true;
        }
        if (hit && bs.open > 0.6 && bs.api.stare(dt)) bs.gazeT = Math.min(bs.gazeT, 0.25); // окаменила — и гаснет
        // пятно ползёт к ракетке, только пока она вне луча: проскочить сквозь него можно и с клавиатуры
        if (!hit) { const v = GAZE_SPEED * (rage(bs) ? 1.4 : 1) * dt; bs.aimX += clamp(p.x - bs.aimX, -v, v); }
      } else bs.open = Math.max(0, bs.open - dt / 0.25);
    };
    bs.fire = () => {
      bs.gazeT = GAZE * (rage(bs) ? 1.2 : 1);
      bs.api.sfx('gaze', pan(cx), bs.gazeT);
    };
    // Конусы взгляда — источники света для пола, верха кирпичей и бликов на воде (draw.js); источник — под
    // подбородком, чтобы голова не заслоняла свой же свет
    bs.lights = () => {
      if (bs.open <= 0 || !bs.core.alive) return [];
      return sources().slice(0, 2).map((k, i) => {
        const a = beamAng(k), s = sl[i], e = 45 * bs.open;
        s.x = k.x + Math.cos(a) * 72 * SZ; s.y = k.y + Math.sin(a) * 72 * SZ; s.r = 4; s.ang = a; s.half = GAZE_HALF * bs.open; s.soft = 0.35;
        s.col[0] = GREEN[0] * e; s.col[1] = GREEN[1] * e; s.col[2] = GREEN[2] * e;
        return s;
      });
    };

    bs.under = t => {
      const a = clamp((bs.t - 1.2) / 1.2, 0, 1) * (bs.dying ? Math.max(0, 1 - bs.deathT * 1.5) : 1);
      if (a <= 0) return;
      R.lit(0);
      at(0, -10, pa);
      R.color(0.2, 0.7, 0.3, 0.16 * a, 1); R.soft(pa[0], pa[1], 130 * SZ);
      // хребты змей — светящиеся нити, двоичный дождь
      for (const sn of bs.snakes) {
        const r = sn.r, pts = [];
        for (let j = 0; j <= r.n; j++) pts.push(r.x[j], r.y[j]);
        strand(pts, GREEN, 0.35 * a, 1.6);
      }
      for (const q of bs.rain) glyph(q.d, q.x, q.y, 6 * SZ, 0.5 * a * Math.min(1, q.life / 0.6), 0);
    };
    bs.over = t => {
      const c = bs.core;
      R.lit(0);
      // цифры на ячейках и головы змей с языками
      for (const sn of bs.snakes) for (const k of sn.chain) {
        if (!k.alive || k.show <= 0) continue;
        if (k.boss === 'cell') { glyph(k.m.bit, k.x, k.y, 9 * k.show * SZ, k.show * (0.75 + 0.25 * Math.sin(t * 9 + k.x)), 3.2); continue; }
        const ca = Math.cos(k.ang) * SZ, sa = Math.sin(k.ang) * SZ;
        for (const sd of [-1, 1]) { R.color(1, 0.25, 0.2, k.show, 1); R.disc(k.x + ca * 2 - sa * sd * 3, k.y + sa * 2 + ca * sd * 3, 1.3 * SZ); }
        if (Math.sin(t * 7 + k.x * 0.1) > 0.2) {
          const tx = k.x + ca * 10, ty = k.y + sa * 10, ex = tx + ca * 6, ey = ty + sa * 6;
          R.color(1, 0.3, 0.35, 0.9, 1); R.line(tx, ty, ex, ey, 1);
          R.line(ex, ey, ex + ca * 3 - sa * 2, ey + sa * 3 + ca * 2, 1); R.line(ex, ey, ex + ca * 3 + sa * 2, ey + sa * 3 - ca * 2, 1);
        }
      }
      if (c.alive && c.show > 0) {
        // бегущий код вместо рта
        for (let i = 0; i < 5; i++) { at(-12 + i * 6, 20, pa); glyph((bs.code >> i) & 1, pa[0], pa[1], 6 * c.show * SZ, 0.9 * c.show, 2.4); }
        // фонари: линза разгорается с зарядом и взглядом
        const heat = Math.max(bs.charge, bs.open);
        for (const k of bs.lamps) {
          if (!k.alive || k.show <= 0) continue;
          const z = k.show * SZ;
          R.color(GREEN[0], GREEN[1], GREEN[2], (0.25 + 0.5 * heat) * k.show, 1); R.soft(k.x, k.y, (16 + 26 * heat) * SZ);
          R.color(0.02, 0.06, 0.03, 1); R.disc(k.x, k.y, 8.5 * z);
          R.color(0.5 + 0.4 * heat, 1, 0.55 + 0.35 * heat, 1, 1); R.disc(k.x, k.y, (3.5 + 3.5 * heat) * z);
          R.color(0.6, 1, 0.7, 0.7, 1); R.ring(k.x, k.y, 8.5 * z, 0.2);
        }
        eye(c.x, c.y, 9 * c.show * SZ, bs, bs.eyeCol);
        // прицел: пунктир бежит от глаз к ракетке, пока взгляд заряжается
        if (bs.charging) {
          for (const k of sources()) {
            const dx = bs.aimX - k.x, dy = bs.aimY - k.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
            for (let s = (t * 220) % 24; s < d; s += 24) {
              R.color(GREEN[0], GREEN[1], GREEN[2], 0.25 + 0.6 * bs.charge, 1);
              R.line(k.x + ux * s, k.y + uy * s, k.x + ux * Math.min(d, s + 11), k.y + uy * Math.min(d, s + 11), 1.6);
            }
          }
          R.color(GREEN[0], GREEN[1], GREEN[2], 0.3 * bs.charge, 1); R.ring(bs.aimX, bs.aimY, 30 - 14 * bs.charge, 0.12);
        }
      }
      // конусы взгляда и пятно на ракетке
      if (bs.open > 0 && c.alive) {
        for (const k of sources()) {
          const a = beamAng(k), len = Math.hypot(bs.aimX - k.x, bs.aimY - k.y) + 60, h = GAZE_HALF * bs.open;
          R.color(GREEN[0], GREEN[1], GREEN[2], 0.34 * bs.open, 1); R.color2(GREEN[0], GREEN[1], GREEN[2], 0.1 * bs.open, 1);
          R.beam(k.x, k.y, a, h, len, 12);
          R.color(0.8, 1, 0.85, 0.55 * bs.open, 1); R.color2(0.8, 1, 0.85, 0.08 * bs.open, 1);
          R.beam(k.x, k.y, a, h * 0.3, len, 6);
        }
        R.color(GREEN[0], GREEN[1], GREEN[2], 0.4 * bs.open, 1); R.soft(bs.aimX, bs.aimY, 70);
        R.color(0.8, 1, 0.85, 0.35 * bs.open, 1); R.soft(bs.aimX, bs.aimY, 22);
      }
      hpBar(bs);
    };
    bs.gi = () => {
      const c = bs.core;
      if (!c.alive || c.show <= 0) return;
      const e = 1.6 + 3 * bs.charge, k = bs.eyeCol;
      R.color(k[0] * e, k[1] * e, k[2] * e, 1); R.disc(c.x, c.y, 6 * SZ);
      const h = 1.2 + 4 * Math.max(bs.charge, bs.open);
      for (const l of bs.lamps) if (l.alive && l.show > 0) { R.color(GREEN[0] * h, GREEN[1] * h, GREEN[2] * h, 1); R.disc(l.x, l.y, 5 * SZ); }
    };
    return bs;
  }

  const KINDS = [serpent, jelly, manta, gorgon];
  AK.Boss = {
    EVERY,
    isLevel: level => level % EVERY === 0,
    // Босс уровня level: по кругу змей, медуза, скат, Горгона; на каждом следующем круге — крепче и злее
    create(level, rng) {
      const n = level / EVERY - 1, bs = KINDS[n % KINDS.length](level, rng, Math.floor(n / KINDS.length));
      bs.bind = (bricks, api) => bind(bs, bricks, api);
      bs.update = (dt, g) => update(bs, dt, g);
      return bs;
    },
  };
})(window.AK);
