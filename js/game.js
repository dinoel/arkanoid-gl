'use strict';
// Игровая логика: фиксированный шаг физики 120 Гц с подшагами для мяча (без туннелирования),
// импульсы с трением и вращением, эффект Магнуса, притяжение кирпичей, обломки-твёрдые тела,
// которые ловятся ракеткой, бонусы, лазеры, взрывы.
(function (AK) {
  const { U, P, A } = AK;
  const { clamp, TAU } = U;
  const W = 720, H = 960, HUD = 56, WALL = 16;
  const L = WALL, RX = W - WALL, T = HUD + WALL;
  const PADDLE_Y = 900, STEP = 1 / 120, BALL_R = 8;
  const KM = 0.0045;          // коэффициент эффекта Магнуса
  // Осколки разбитых кирпичей падают с сопротивлением воздуха — не камнем, а так, чтобы их можно было
  // поймать ракеткой. За каждый пойманный — очки, а поимки подряд, без долгих пауз, их умножают.
  const SHARD_G = 1000, SHARD_DRAG = 2.6;     // скорость падения выходит на SHARD_G / SHARD_DRAG ≈ 385 px/s
  const SHARD_FADE = 0.6;                     // с, за сколько гаснет осколок, улёгшийся на кирпич
  const SHARD_PTS = { normal: 10, strong: 15, explosive: 20 };
  const STREAK_GAP = 1.2;                     // с между поимками, после которых серия прерывается
  const STREAK_MAX = 3;                       // предельный множитель серии
  // Притяжение кирпичей по закону всемирного тяготения. Масса = площадь × плотность материала;
  // постоянная подобрана так, чтобы у ракетки поле полного уровня было около 280 px/s², а у стальных
  // кирпичей мяч, пролетая вплотную, сворачивал на десятки градусов.
  const GCONST = 800;
  const DENSITY = { normal: 0.8, explosive: 0.6, steel: 6 }; // прочные: 0.8 + 0.5 за каждую единицу прочности
  // Удары выбивают из стали массу: m *= exp(-j / STEEL_WEAR), j — импульс удара. Обычный удар уносит
  // несколько процентов, а мяч, улёгшийся в ямку между стальными кирпичами, своим давлением стачивает её
  // за пару секунд и выкатывается.
  const STEEL_WEAR = 15000;
  const STEEL_ROUGH = 0.07;   // разброс нормали при ударе о сталь, рад (±4°)
  const VMAX = 1.8;           // во сколько раз мяч может разогнаться в колодце относительно скорости у ракетки
  const ZONE_B = AK.LevelGen.bounds.B;

  const G = {
    W, H, L, R: RX, T, HUD, WALL, PADDLE_Y,
    state: 'serve', demo: true, paused: false, time: 0, acc: 0, gravity: true, gview: 1,
    score: 0, lives: 3, level: 1, seed: 1, combo: 0, prevGen: null,
    shake: 0, flash: 0, aberr: 0,
    bricks: [], balls: [], debris: [], particles: [], powerups: [], lasers: [], waves: [], explQ: [], popups: [],
    streak: { n: 0, t: -9 },
    pw: { expand: 0, slow: 0, laser: 0, fire: 0 },
    input: { x: W / 2, fire: false, held: false },
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const pan = x => ((x / W) * 2 - 1) * 0.8;
  const sfx = (name, ...args) => { if (!G.demo && A[name]) A[name](...args); };

  // ---------- Создание ----------
  function makeBrick(s) {
    const local = s.local;
    const b = {
      local, inset: P.inset(local, 4.5), orient: Math.sign(P.signedArea(local)) || 1,
      circle: s.circle || 0, n: local.length / 2, rad: Math.max(P.radius(local), s.circle || 0),
      world: new Float32Array(local.length), worldIn: new Float32Array(local.length),
      bx: s.x, by: s.y, bang: s.ang || 0, x: s.x, y: s.y, ang: s.ang || 0, vx: 0, vy: 0, w: 0,
      motion: s.motion || null, kind: s.kind, hp: s.hp, maxHp: s.hp, color: s.color, note: s.note,
      flash: 0, cracks: [], alive: true, dirty: true, phase: Math.random() * TAU,
    };
    const area = s.circle ? Math.PI * s.circle * s.circle : Math.abs(P.signedArea(local));
    b.mass = b.mass0 = area * (s.kind === 'strong' ? 0.8 + 0.5 * s.hp : DENSITY[s.kind]);
    b.gm = GCONST * b.mass;
    b.soft2 = (0.5 * b.rad) ** 2;
    pose(b, 0);
    return b;
  }

  // Ускорение от притяжения кирпичей: a = Σ Gm·d / (d² + ε²)^{3/2}. Смягчение ε: масса распределена
  // по кирпичу, а не собрана в точку; снаружи кирпича это почти точный закон 1/r².
  // Масса мяча сокращается — от неё ускорение не зависит. Кирпичи закреплены, мяч их не сдвигает.
  G.field = function (x, y, out) {
    let ax = 0, ay = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      const dx = k.x - x, dy = k.y - y, d2 = dx * dx + dy * dy + k.soft2;
      const f = k.gm / (d2 * Math.sqrt(d2));
      ax += dx * f; ay += dy * f;
    }
    out[0] = ax; out[1] = ay;
    return out;
  };
  // Потенциал того же поля: φ = −Σ Gm / √(d² + ε²), поле — его антиградиент.
  G.potential = function (x, y) {
    let u = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      const dx = k.x - x, dy = k.y - y;
      u -= k.gm / Math.sqrt(dx * dx + dy * dy + k.soft2);
    }
    return u;
  };
  G.toggleGravity = () => { G.gravity = !G.gravity; return G.gravity; };

  function pose(b, t) {
    const m = b.motion;
    if (m) {
      if (m.type === 'orbit') {
        const th = m.a0 + m.w * t;
        b.x = m.cx + m.r * Math.cos(th); b.y = m.cy + m.r * Math.sin(th);
        b.ang = b.bang + m.w * t; b.w = m.w;
        b.vx = -m.w * (b.y - m.cy); b.vy = m.w * (b.x - m.cx);
      } else if (m.type === 'slide') {
        const ph = m.f * t + m.ph;
        b.x = b.bx + m.amp * Math.sin(ph); b.vx = m.amp * m.f * Math.cos(ph);
      } else if (m.type === 'spin') {
        b.ang = b.bang + m.w * t; b.w = m.w;
      }
    } else if (!b.dirty) return;
    b.dirty = false;
    P.transform(b.local, b.x, b.y, b.ang, b.world);
    P.transform(b.inset, b.x, b.y, b.ang, b.worldIn);
  }

  function newPaddle() { return { x: W / 2, y: PADDLE_Y, vx: 0, hw: 44, r: 11, cool: 0, flash: 0 }; }
  function newBall(x, y, vx, vy) { return { x, y, vx, vy, w: 0, ang: 0, r: BALL_R, stuck: false, off: 0, trail: [], dead: false, flame: 0 }; }

  // ---------- Прожекторы ----------
  // Разноцветные прожекторы на стенах светят конусом в поле и медленно чуть поводят лучом: только свет
  // и украшение, мяч их не задевает. У каждого уровня свой набор, но генератор отдельный, чтобы не сдвигать
  // случайности самого уровня.
  const SPOT_COLORS = [[1, 0.22, 0.28], [1, 0.55, 0.12], [1, 0.88, 0.25], [0.3, 1, 0.4],
    [0.15, 0.85, 1], [0.3, 0.4, 1], [0.72, 0.3, 1], [1, 0.3, 0.75]];
  function makeSpots(seed) {
    const rng = U.rng(seed ^ 0x1a3b5c7d);
    const cols = SPOT_COLORS.slice();
    for (let i = cols.length - 1; i > 0; i--) { const j = rng.int(0, i); [cols[i], cols[j]] = [cols[j], cols[i]]; }
    let ci = 0;
    // side: 1 — левая стена, -1 — правая, 0 — верхняя. Целимся в случайную точку на дальней стороне поля.
    const spot = (x, y, side) => {
      const tx = side === 1 ? rng.range(W * 0.45, RX - 60) : side === -1 ? rng.range(L + 60, W * 0.55) : rng.range(L + 80, RX - 80);
      const ty = side === 0 ? rng.range(H * 0.5, PADDLE_Y - 60) : rng.range(T + 120, PADDLE_Y - 60);
      return {
        x, y, side, col: cols[ci++ % cols.length], ang: Math.atan2(ty - y, tx - x),
        half: rng.range(0.31, 0.45),                                        // полуугол конуса
        amp: rng.range(0.04, 0.08), fr: rng.range(0.25, 0.4), ph: rng.range(0, TAU), // покачивание луча
      };
    };
    const spots = [];
    for (let i = 0; i < 4; i++) { const y = T + 100 + i * 200; spots.push(spot(L, y, 1), spot(RX, y, -1)); }
    spots.push(spot(L + (RX - L) * 0.3, T, 0), spot(L + (RX - L) * 0.7, T, 0));
    return spots;
  }

  function serve() {
    const p = G.paddle;
    const b = newBall(p.x, p.y - p.r - BALL_R - 0.5, 0, 0);
    b.stuck = true; b.off = rand(-12, 12);
    G.balls = [b];
    G.serveT = 0;
  }

  function resetPowers() { for (const k in G.pw) G.pw[k] = 0; }

  G.newGame = function (seed, demo) {
    G.demo = !!demo; G.seed = seed;
    G.level = 1; G.score = 0; G.lives = 3; G.prevGen = null; G.paused = false;
    G.paddle = newPaddle();
    G.startLevel();
  };

  G.startLevel = function () {
    const lv = AK.LevelGen.generate(G.level, G.seed, G.prevGen);
    G.lv = lv; G.prevGen = lv.gen;
    G.bricks = lv.bricks.map(makeBrick);
    G.spots = makeSpots(lv.seedInt);
    G.debris = []; G.particles = []; G.powerups = []; G.lasers = []; G.waves = []; G.explQ = []; G.popups = [];
    G.streak = { n: 0, t: -9 };
    G.levelTime = 0; G.combo = 0; G.acc = 0;
    if (!G.paddle) G.paddle = newPaddle();
    resetPowers();
    serve();
    G.state = 'serve';
    A.newSong(lv.rng);
    if (!G.demo) AK.UI.banner(`${lv.title} · ${lv.name}`, `уровень ${G.level} · сид ${G.seed}`, 3.2);
  };

  G.skipLevel = function () { G.level++; G.startLevel(); };

  // ---------- Скорость мяча ----------
  function targetSpeed() {
    const base = Math.min(470 + 20 * (G.level - 1), 740);
    const ramp = 1 + Math.min(G.levelTime / 100, 1) * 0.16;
    return base * ramp * (G.pw.slow > 0 ? 0.7 : 1);
  }

  // В поле кирпичей держим постоянной не скорость, а энергию: v² + 2φ такая же, как у ракетки на той же x.
  // Падая в колодец, мяч честно разгоняется и с той же энергией выбирается обратно. Если срезать эту скорость,
  // мяч теряет энергию, и тяжёлая сталь захватывает его — он ложится на неё и застревает.
  function fieldSpeed(b, tgt) {
    const v2 = tgt * tgt + 2 * (G.potential(b.x, PADDLE_Y) - G.potential(b.x, b.y));
    return clamp(Math.sqrt(Math.max(v2, 0)), tgt * 0.7, tgt * VMAX);
  }

  function regulate(b, dt) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const tgt = G.gravity ? fieldSpeed(b, targetSpeed()) : targetSpeed();
    const ns = sp + (tgt - sp) * (1 - Math.exp(-dt * 1.8));
    b.vx *= ns / sp; b.vy *= ns / sp;
    const minVy = ns * 0.22;
    if (Math.abs(b.vy) < minVy) {
      const s = b.vy < 0 || b.vy === 0 ? -1 : 1;
      b.vy += (s * minVy - b.vy) * (1 - Math.exp(-dt * 6));
      b.vx = U.sign(b.vx) * Math.sqrt(Math.max(ns * ns - b.vy * b.vy, 0));
    }
    // Трение о грани гасит горизонтальную скорость, и мяч мог навсегда уйти в вертикальный пинг-понг
    // между сталью и стенкой — держим хотя бы небольшой наклон.
    const minVx = ns * 0.08;
    if (Math.abs(b.vx) < minVx) {
      b.vx = (b.vx < 0 || (b.vx === 0 && Math.random() < 0.5) ? -1 : 1) * minVx;
      b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(ns * ns - minVx * minVx);
    }
    b.w = clamp(b.w * Math.exp(-dt * 0.5), -120, 120);
  }

  function launch(b) {
    const p = G.paddle, sp = targetSpeed();
    const a = -Math.PI / 2 + clamp(p.vx * 0.0006, -0.45, 0.45) + clamp(b.off / (p.hw + p.r), -1, 1) * 0.35 + rand(-0.06, 0.06);
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    b.w = -p.vx * 0.02; b.stuck = false;
    sfx('launch', pan(b.x));
    G.state = 'play';
  }

  // ---------- Эффекты ----------
  function sparks(x, y, n, col, speed, nx, ny, spread) {
    for (let i = 0; i < n; i++) {
      const a = nx !== undefined ? Math.atan2(ny, nx) + rand(-spread, spread) : rand(0, TAU);
      const s = rand(0.25, 1) * speed;
      const life = rand(0.2, 0.55);
      G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.2, 2.6), col, g: 700, drag: 2.2, type: 0 });
    }
  }
  function puff(x, y, col, size, life, type = 1) {
    G.particles.push({ x, y, vx: 0, vy: type === 2 ? -30 : 0, life, max: life, size, col, g: 0, drag: 1, type });
  }

  // ---------- Кирпичи ----------
  function addCrack(k, px, py) {
    const c = Math.cos(-k.ang), s = Math.sin(-k.ang);
    const lx = (px - k.x) * c - (py - k.y) * s, ly = (px - k.x) * s + (py - k.y) * c;
    for (let br = 0; br < 2; br++) {
      const pts = [lx * 0.95, ly * 0.95];
      const segs = 3 + ((Math.random() * 2) | 0);
      const ex = rand(-0.3, 0.3) * k.rad, ey = rand(-0.3, 0.3) * k.rad;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        pts.push(U.lerp(lx, ex, t) * 0.95 + rand(-3, 3), U.lerp(ly, ey, t) * 0.95 + rand(-3, 3));
      }
      k.cracks.push(pts);
    }
  }

  const SCORE = { normal: 50, strong: 60, explosive: 100, steel: 0 };

  function damageBrick(k, dmg, px, py, ivx, ivy, power, nx, ny) {
    k.flash = 1;
    if (k.kind === 'steel') {
      k.mass *= Math.exp(-power / STEEL_WEAR);
      k.gm = GCONST * k.mass;
      sfx('steel', power, pan(px));
      sparks(px, py, 7, [0.8, 0.9, 1], 380, nx, ny, 0.9);
      return;
    }
    k.hp -= dmg;
    G.combo++;
    const note = Math.min(k.note + Math.floor(G.combo / 2), 14);
    if (k.hp <= 0) destroyBrick(k, ivx, ivy, power, false, note);
    else {
      addCrack(k, px, py);
      G.score += 10;
      sfx('brick', note, power, pan(px));
      sparks(px, py, 6, k.color, 300, nx, ny, 1.0);
    }
  }

  function destroyBrick(k, ivx, ivy, power, quiet, note) {
    if (!k.alive) return;
    k.alive = false;
    const base = SCORE[k.kind] * (k.kind === 'strong' ? k.maxHp : 1);
    G.score += Math.round((base * (1 + G.combo * 0.15)) / 10) * 10;
    spawnDebris(k, ivx, ivy);
    sparks(k.x, k.y, 10, k.color, 260);
    puff(k.x, k.y, k.color, k.rad * 2.2, 0.3);
    if (!quiet) sfx('brickBreak', note != null ? note : k.note, power, pan(k.x), k.maxHp > 1);
    if (k.kind === 'explosive') G.explQ.push({ x: k.x, y: k.y, t: 0.07 });
    maybeDrop(k);
  }

  function spawnDebris(k, ivx, ivy) {
    const n = k.n, g = Math.max(1, Math.round(n / 6)), wv = k.world;
    for (let i = 0; i < n; i += g) {
      const cnt = Math.min(g, n - i);
      const poly = [k.x, k.y];
      for (let j = 0; j <= cnt; j++) { const id = (i + j) % n; poly.push(wv[id * 2], wv[id * 2 + 1]); }
      const m = poly.length / 2;
      let cx = 0, cy = 0;
      for (let q = 0; q < m; q++) { cx += poly[q * 2]; cy += poly[q * 2 + 1]; }
      cx /= m; cy /= m;
      const local = [];
      for (let q = 0; q < m; q++) local.push(poly[q * 2] - cx, poly[q * 2 + 1] - cy);
      const dx = cx - k.x, dy = cy - k.y, dl = Math.hypot(dx, dy) || 1;
      const sp = rand(60, 210);
      const bvx = k.vx - k.w * (cy - k.y), bvy = k.vy + k.w * (cx - k.x);
      G.debris.push({
        local, world: new Float32Array(local.length), x: cx, y: cy,
        vx: bvx + (dx / dl) * sp + ivx * 0.22, vy: bvy + (dy / dl) * sp + ivy * 0.22 - 60,
        a: k.ang, w: rand(-9, 9) + k.w, r: Math.max(3, P.radius(local) * 0.7), life: SHARD_FADE,
        color: k.color, kind: k.kind, pts: SHARD_PTS[k.kind] || 10, rest: 0, age: 0, caught: false,
      });
    }
    if (G.debris.length > 260) G.debris.splice(0, G.debris.length - 260);
  }

  // ---------- Бонусы ----------
  const PU = [['expand', 3], ['multi', 3], ['slow', 2], ['laser', 2.2], ['fire', 1.4], ['life', 0.6]];
  G.PU_COLORS = {
    expand: [0.3, 0.6, 1], multi: [1, 0.85, 0.25], slow: [0.35, 1, 0.55],
    laser: [1, 0.3, 0.35], fire: [1, 0.55, 0.12], life: [1, 0.45, 0.85],
  };
  function maybeDrop(k) {
    const chance = k.maxHp > 1 ? 0.22 : 0.12;
    if (Math.random() > chance || G.powerups.length > 5) return;
    G.powerups.push({ type: weighted(PU), x: k.x, y: k.y, vx: k.vx * 0.5 + rand(-30, 30), vy: -90, a: 0, t: 0 });
  }
  function weighted(items) {
    let s = 0; for (const it of items) s += it[1];
    let x = Math.random() * s;
    for (const it of items) { x -= it[1]; if (x <= 0) return it[0]; }
    return items[0][0];
  }
  function applyPower(type) {
    G.score += 100;
    switch (type) {
      case 'expand': G.pw.expand = 16; break;
      case 'slow': G.pw.slow = 12; break;
      case 'laser': G.pw.laser = 12; break;
      case 'fire': G.pw.fire = 9; break;
      case 'life': G.lives = Math.min(G.lives + 1, 6); break;
      case 'multi': {
        const add = [];
        for (const b of G.balls) {
          if (b.stuck) { launch(b); }
          for (const s of [-0.38, 0.38]) {
            if (G.balls.length + add.length >= 12) break;
            const c = Math.cos(s), sn = Math.sin(s);
            const nb = newBall(b.x, b.y, b.vx * c - b.vy * sn, b.vx * sn + b.vy * c);
            nb.w = -b.w; add.push(nb);
          }
        }
        G.balls.push(...add);
        break;
      }
    }
  }

  // ---------- Взрывы ----------
  function explode(x, y) {
    const RAD = 66;
    G.waves.push({ x, y, t: 0, max: 0.55, r: RAD * 1.35 });
    G.shake = Math.min(G.shake + 9, 18);
    G.aberr = Math.min(G.aberr + 0.8, 1.5);
    G.flash = Math.min(G.flash + 0.12, 0.3);
    sfx('explode', pan(x));
    sparks(x, y, 34, [1, 0.6, 0.2], 620);
    puff(x, y, [1, 0.55, 0.2], 120, 0.45);
    for (let i = 0; i < 5; i++) puff(x + rand(-30, 30), y + rand(-30, 30), [0.1, 0.08, 0.1], rand(30, 55), rand(0.8, 1.3), 2);
    for (const k of G.bricks) {
      if (!k.alive || k.kind === 'steel') continue;
      const d = Math.hypot(k.x - x, k.y - y) - k.rad * 0.5;
      if (d >= RAD) continue;
      // взрыв наносит 2 единицы урона: обычные и двухударные рушатся, трёхударные трескаются
      if (k.hp <= 2) destroyBrick(k, (k.x - x) * 3, (k.y - y) * 3, 600, true);
      else { k.hp -= 2; k.flash = 1; addCrack(k, (k.x + x) / 2, (k.y + y) / 2); }
    }
    // ударная волна толкает мячи и обломки
    for (const b of G.balls) {
      if (b.stuck) continue;
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < 170) { const f = 380 * (1 - d / 170); b.vx += (dx / d) * f; b.vy += (dy / d) * f; }
    }
    for (const p of G.debris) {
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
      if (d < 220) { const f = 700 * (1 - d / 220); p.vx += (dx / d) * f; p.vy += (dy / d) * f; p.w += rand(-12, 12); }
    }
  }

  // ---------- Шаг симуляции ----------
  function updatePaddle(dt) {
    const p = G.paddle, inp = G.input;
    const hwT = G.pw.expand > 0 ? 76 : 44;
    p.hw += (hwT - p.hw) * (1 - Math.exp(-dt * 10));
    const minX = L + p.hw + p.r, maxX = RX - p.hw - p.r;
    const target = clamp(G.demo ? demoTarget() : inp.x, minX, maxX);
    const k = 2200, c = 2 * Math.sqrt(k);
    p.vx += (k * (target - p.x) - c * p.vx) * dt;
    p.x += p.vx * dt;
    if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
    if (p.x > maxX) { p.x = maxX; if (p.vx > 0) p.vx = 0; }
    p.cool -= dt;
    p.flash = Math.max(0, p.flash - dt * 4);

    let fire = inp.fire;
    inp.fire = false;
    if (G.demo) { G.serveT += dt; fire = G.serveT > 0.9; }
    const stuck = G.balls.filter(b => b.stuck);
    if (fire && stuck.length) stuck.forEach(launch);
    else if ((fire || inp.held) && G.pw.laser > 0 && p.cool <= 0 && !G.demo) {
      p.cool = 0.22;
      G.lasers.push({ x: p.x - p.hw, y: p.y - p.r - 4 }, { x: p.x + p.hw, y: p.y - p.r - 4 });
      sfx('laser', pan(p.x));
    }
  }

  function demoTarget() {
    let best = null;
    for (const b of G.balls) if (!b.stuck && b.vy > 0 && (!best || b.y > best.y)) best = b;
    if (!best) best = G.balls[0];
    if (!best) return W / 2;
    return best.x + Math.sin(G.time * 0.7) * 18;
  }

  function hitBallWall(b, nx, ny, px, py) {
    const j = P.resolve(b, b.r, nx, ny, 0, 0, 0.98, 0.18, 0.4);
    if (j > 0) {
      sfx('wall', j, pan(px));
      sparks(px, py, 4, [0.6, 0.85, 1], 220, nx, ny, 1.1);
    }
  }

  function collideBall(b) {
    if (b.x - b.r < L) { b.x = L + b.r; hitBallWall(b, 1, 0, L, b.y); }
    if (b.x + b.r > RX) { b.x = RX - b.r; hitBallWall(b, -1, 0, RX, b.y); }
    if (b.y - b.r < T) { b.y = T + b.r; hitBallWall(b, 0, 1, b.x, T); }

    // ракетка: капсула с выпуклой верхней поверхностью
    const p = G.paddle;
    if (b.y + b.r > p.y - p.r - 2 && b.y - b.r < p.y + p.r + 2) {
      const h = P.circleVsCapsule(b.x, b.y, b.r, p.x, p.y, p.hw, p.r);
      if (h) {
        const hnx = h.nx, hny = h.ny, hpx = h.px, hpy = h.py;
        b.x += hnx * h.pen; b.y += hny * h.pen;
        let nx = hnx, ny = hny;
        if (ny < -0.2) {
          const off = clamp((b.x - p.x) / (p.hw + p.r), -1, 1);
          nx += off * 0.55;
          const l = Math.hypot(nx, ny); nx /= l; ny /= l;
        }
        let j = P.resolve(b, b.r, nx, ny, p.vx, 0, 1.0, 0.32, 0.4);
        if (!j) j = P.resolve(b, b.r, hnx, hny, p.vx, 0, 1.0, 0.32, 0.4);
        if (j > 0) {
          if (hny < -0.2) {
            const sp = Math.hypot(b.vx, b.vy), minVy = sp * 0.34;
            if (b.vy > -minVy) { b.vy = -minVy; b.vx = U.sign(b.vx) * Math.sqrt(Math.max(sp * sp - minVy * minVy, 0)); }
          }
          G.combo = 0;
          p.flash = 1;
          sfx('paddle', j, pan(b.x));
          sparks(hpx, hpy, 6, [0.5, 0.9, 1], 260, hnx, hny, 1.0);
        }
      }
    }

    // кирпичи
    const fireOn = G.pw.fire > 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      const rr = k.rad + b.r;
      if (Math.abs(b.x - k.x) > rr || Math.abs(b.y - k.y) > rr) continue;
      const h = k.circle ? P.circleVsCircle(b.x, b.y, b.r, k.x, k.y, k.circle) : P.circleVsPoly(b.x, b.y, b.r, k.world, k.orient);
      if (!h) continue;
      const nx = h.nx, ny = h.ny, px = h.px, py = h.py, pen = h.pen;
      if (fireOn && k.kind !== 'steel') {
        damageBrick(k, 99, px, py, b.vx, b.vy, 700, nx, ny);
        continue;
      }
      b.x += nx * pen; b.y += ny * pen;
      const cvx = k.vx - k.w * (py - k.y), cvy = k.vy + k.w * (px - k.x);
      let j = 0;
      if (k.kind === 'steel') {
        // Грани стали неровные (заклёпки, сколы): нормаль удара слегка гуляет. Это перемешивает горизонтальное
        // и вертикальное движение — иначе в прямоугольном стальном кармане, куда мяч прижимает притяжение,
        // он мог бы вечно летать по одной линии.
        const a = rand(-STEEL_ROUGH, STEEL_ROUGH), c = Math.cos(a), s = Math.sin(a);
        j = P.resolve(b, b.r, nx * c - ny * s, nx * s + ny * c, cvx, cvy, 0.97, 0.22, 0.4);
      }
      if (!j) j = P.resolve(b, b.r, nx, ny, cvx, cvy, 0.97, 0.22, 0.4);
      if (j > 0) damageBrick(k, 1, px, py, b.vx, b.vy, j, nx, ny);
    }
  }

  const ga = [0, 0];
  function updateBall(b, dt) {
    const p = G.paddle;
    if (b.stuck) {
      b.x = p.x + b.off; b.y = p.y - p.r - b.r - 0.5; b.vx = p.vx; b.vy = 0;
      b.trail.length = 0;
      return;
    }
    const sp = Math.hypot(b.vx, b.vy);
    const n = Math.max(1, Math.ceil((sp * dt) / (b.r * 0.45)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      let ax = -KM * b.w * b.vy, ay = KM * b.w * b.vx;
      if (G.gravity) { G.field(b.x, b.y, ga); ax += ga[0]; ay += ga[1]; }
      b.vx += ax * h; b.vy += ay * h;
      b.x += b.vx * h; b.y += b.vy * h;
      collideBall(b);
    }
    b.ang += b.w * dt;
    regulate(b, dt);
    b.trail.push(b.x, b.y);
    if (b.trail.length > 36) b.trail.splice(0, 2);
    // пламя огненного мяча — ровным потоком, а не случайными клочьями
    if (G.pw.fire > 0) {
      for (b.flame += dt * 70; b.flame >= 1; b.flame--) {
        const life = rand(0.26, 0.34);
        G.particles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-30, 30), life, max: life, size: rand(6, 8), col: [1, 0.5, 0.15], g: -200, drag: 1, type: 1 });
      }
    }
    if (b.y - b.r > H + 30) b.dead = true;
  }

  function ballBall() {
    const bs = G.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.stuck) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.stuck) continue;
        const h = P.circleVsCircle(a.x, a.y, a.r, b.x, b.y, b.r);
        if (!h) continue;
        const nx = h.nx, ny = h.ny, pen = h.pen * 0.5;
        a.x += nx * pen; a.y += ny * pen; b.x -= nx * pen; b.y -= ny * pen;
        const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rv < 0) {
          a.vx -= rv * nx; a.vy -= rv * ny; b.vx += rv * nx; b.vy += rv * ny;
          const tw = (a.w + b.w) * 0.5; a.w = tw; b.w = tw;
          sfx('wall', -rv, pan(a.x));
        }
      }
    }
  }

  function bodyVsWalls(d, e, mu) {
    if (d.x - d.r < L) { d.x = L + d.r; P.resolve(d, d.r, 1, 0, 0, 0, e, mu, 0.5); }
    if (d.x + d.r > RX) { d.x = RX - d.r; P.resolve(d, d.r, -1, 0, 0, 0, e, mu, 0.5); }
    if (d.y - d.r < T) { d.y = T + d.r; P.resolve(d, d.r, 0, 1, 0, 0, e, mu, 0.5); }
  }

  // Пойманный осколок: очки с множителем серии и всплывающая надпись над ракеткой. Поимки, идущие кучно,
  // складываются в одну надпись, и она растёт, пока поток осколков не кончится.
  function catchShard(d) {
    const p = G.paddle, st = G.streak;
    d.caught = true;
    st.n = G.time - st.t < STREAK_GAP ? st.n + 1 : 1;
    st.t = G.time;
    const pts = Math.round(d.pts * Math.min(1 + 0.1 * (st.n - 1), STREAK_MAX));
    G.score += pts;
    const last = G.popups[G.popups.length - 1];
    if (last && last.t < 0.35) { last.v += pts; last.t = 0; last.x += (d.x - last.x) * 0.3; last.n = st.n; last.color = d.color; }
    else G.popups.push({ x: d.x, v: pts, t: 0, age: 0, n: st.n, color: d.color }); // t — с последней поимки
    p.flash = Math.max(p.flash, 0.4);
    sparks(d.x, p.y - p.r, 5, d.color, 200, 0, -1, 1.1);
    sfx('shard', st.n, pan(d.x));
  }

  function updateDebris(dt) {
    const p = G.paddle, dr = Math.exp(-SHARD_DRAG * dt);
    for (const d of G.debris) {
      d.vy += SHARD_G * dt;
      d.vx *= dr; d.vy *= dr;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.a += d.w * dt;
      bodyVsWalls(d, 0.35, 0.5);
      if (d.y < ZONE_B + 60) {
        for (const k of G.bricks) {
          if (!k.alive) continue;
          const rr = k.rad + d.r;
          if (Math.abs(d.x - k.x) > rr || Math.abs(d.y - k.y) > rr) continue;
          const h = k.circle ? P.circleVsCircle(d.x, d.y, d.r, k.x, k.y, k.circle) : P.circleVsPoly(d.x, d.y, d.r, k.world, k.orient);
          if (!h) continue;
          d.x += h.nx * h.pen; d.y += h.ny * h.pen;
          const cvx = k.vx - k.w * (h.py - k.y), cvy = k.vy + k.w * (h.px - k.x);
          P.resolve(d, d.r, h.nx, h.ny, cvx, cvy, 0.3, 0.6, 0.5);
        }
      }
      if (P.circleVsCapsule(d.x, d.y, d.r + 3, p.x, p.y, p.hw, p.r)) { catchShard(d); continue; }
      // В полёте осколок живёт, пока его не поймают или он не упадёт за край; улёгшийся на кирпич — гаснет
      d.age += dt;
      d.rest = Math.hypot(d.vx, d.vy) < 40 ? d.rest + dt : 0;
      if (d.rest > 0.5 || d.age > 12) d.life -= dt;
    }
    G.debris = G.debris.filter(d => !d.caught && d.life > 0 && d.y < H + 60);
  }

  function updateParticles(dt) {
    for (const p of G.particles) {
      p.vy += p.g * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
    }
    G.particles = G.particles.filter(p => p.life > 0);
    if (G.particles.length > 1400) G.particles.splice(0, G.particles.length - 1400);
    for (const w of G.waves) w.t += dt;
    G.waves = G.waves.filter(w => w.t < w.max);
    for (const q of G.popups) { q.t += dt; q.age += dt; }
    G.popups = G.popups.filter(q => q.t < 1.1);
  }

  function updatePowerups(dt) {
    const p = G.paddle;
    for (const u of G.powerups) {
      u.t += dt;
      u.vy = Math.min(u.vy + 520 * dt, 210);
      u.vx *= Math.exp(-dt * 0.8);
      u.x += u.vx * dt; u.y += u.vy * dt;
      if (u.x < L + 18) { u.x = L + 18; u.vx = Math.abs(u.vx); }
      if (u.x > RX - 18) { u.x = RX - 18; u.vx = -Math.abs(u.vx); }
      if (Math.abs(u.x - p.x) < p.hw + p.r + 16 && Math.abs(u.y - p.y) < p.r + 9) {
        u.dead = true;
        applyPower(u.type);
        sfx('power', pan(u.x));
        const c = G.PU_COLORS[u.type];
        puff(u.x, u.y, c, 90, 0.4);
        sparks(u.x, u.y, 16, c, 340, 0, -1, 1.3);
      }
      if (u.y > H + 20) u.dead = true;
    }
    G.powerups = G.powerups.filter(u => !u.dead);
  }

  function updateLasers(dt) {
    for (const z of G.lasers) {
      for (let s = 0; s < 3 && !z.dead; s++) {
        z.y -= (1150 * dt) / 3;
        if (z.y < T) { z.dead = true; sparks(z.x, T, 5, [1, 0.4, 0.4], 200, 0, 1, 1); break; }
        for (const k of G.bricks) {
          if (!k.alive || Math.abs(z.x - k.x) > k.rad + 3 || Math.abs(z.y - k.y) > k.rad + 3) continue;
          const h = k.circle ? P.circleVsCircle(z.x, z.y, 3, k.x, k.y, k.circle) : P.circleVsPoly(z.x, z.y, 3, k.world, k.orient);
          if (!h) continue;
          z.dead = true;
          damageBrick(k, 1, h.px, h.py, 0, -400, 500, h.nx, h.ny);
          sparks(z.x, z.y, 6, [1, 0.4, 0.4], 260, 0, 1, 1.2);
          break;
        }
      }
    }
    G.lasers = G.lasers.filter(z => !z.dead);
  }

  function loseLife() {
    if (G.demo) { serve(); return; }
    G.lives--;
    G.shake = 14; G.aberr = 1.5; G.flash = 0.25;
    sfx('lose');
    resetPowers();
    G.powerups = []; G.lasers = [];
    if (G.lives <= 0) {
      G.state = 'over';
      A.playing = false;
      AK.UI.gameOver(G.score, G.level);
      G.demo = true;
      serve();
      return;
    }
    serve();
    G.state = 'serve';
  }

  function step(dt) {
    G.levelTime += dt;
    for (const k in G.pw) G.pw[k] = Math.max(0, G.pw[k] - dt);
    let rem = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      if (k.motion) pose(k, G.levelTime);
      k.flash = Math.max(0, k.flash - dt * 5);
      if (k.kind !== 'steel') rem++;
    }
    updatePaddle(dt);
    for (const b of G.balls) updateBall(b, dt);
    ballBall();
    G.balls = G.balls.filter(b => !b.dead);
    if (!G.balls.length && G.state !== 'clear') loseLife();

    for (const e of G.explQ) { e.t -= dt; if (e.t <= 0) { e.done = true; explode(e.x, e.y); } }
    G.explQ = G.explQ.filter(e => !e.done);

    updateLasers(dt);
    updatePowerups(dt);
    updateDebris(dt);
    updateParticles(dt);

    if (G.state === 'clear') {
      G.clearT -= dt;
      if (G.clearT <= 0) { G.level++; G.startLevel(); }
    } else if (rem === 0 && !G.explQ.length) {
      G.state = 'clear';
      G.clearT = 2.6;
      const bonus = 1000 + 250 * G.level;
      if (!G.demo) { G.score += bonus; AK.UI.banner('УРОВЕНЬ ПРОЙДЕН', '+' + bonus, 2.4); }
      sfx('clear');
      G.flash = 0.2;
    }
  }

  G.update = function (dt) {
    G.time += dt;
    if (G.paused) return;
    G.acc = Math.min(G.acc + dt, STEP * 10);
    while (G.acc >= STEP) { step(STEP); G.acc -= STEP; }
    const f = Math.exp(-dt * 7);
    G.shake *= f; G.aberr *= f; G.flash *= Math.exp(-dt * 5);
    G.gview += ((G.gravity ? 1 : 0) - G.gview) * (1 - Math.exp(-dt * 4)); // сетка поля плавно распрямляется
  };

  AK.G = G;
})(window.AK);
