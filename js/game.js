'use strict';
// Игровая логика: фиксированный шаг физики 120 Гц с подшагами для мяча (без туннелирования),
// импульсы с трением и вращением, эффект Магнуса, притяжение кирпичей, обломки-твёрдые тела,
// которые ловятся ракеткой, бонусы, лазеры, взрывы, боссы (boss.js) и их снаряды.
(function (AK) {
  const { U, P, A } = AK;
  const { clamp, TAU } = U;
  const Wt = AK.Water;
  const W = 720, H = 960, HUD = 56, WALL = 16;
  const L = WALL, RX = W - WALL, T = HUD + WALL;
  const PADDLE_Y = 900, STEP = 1 / 120, BALL_R = 8;
  const KM = 0.0045;          // коэффициент эффекта Магнуса
  // Осколки разбитых кирпичей падают с сопротивлением воздуха — не камнем, а так, чтобы их можно было
  // поймать ракеткой. За каждый пойманный — очки, а поимки подряд, без долгих пауз, их умножают.
  const SHARD_G = 1000, SHARD_DRAG = 2.6;     // скорость падения выходит на SHARD_G / SHARD_DRAG ≈ 385 px/s
  const SHARD_FADE = 0.6;                     // с, за сколько гаснет осколок, улёгшийся на кирпич
  const SHARD_PTS = { normal: 10, strong: 15, explosive: 20, glass: 5, armor: 15, regen: 15, crystal: 30, phase: 15 };
  const STREAK_GAP = 1.2;                     // с между поимками, после которых серия прерывается
  const STREAK_MAX = 3;                       // предельный множитель серии
  // Притяжение кирпичей по закону всемирного тяготения. Масса = площадь × плотность материала;
  // постоянная подобрана так, чтобы у ракетки поле полного уровня было около 280 px/s², а у стальных
  // кирпичей мяч, пролетая вплотную, сворачивал на десятки градусов.
  const GCONST = 800;
  const DENSITY = { normal: 0.8, explosive: 0.6, steel: 6, glass: 0.45, crystal: 1.4, phase: 0.5 }; // прочные, живые
                              // и бронированные: 0.8 + 0.5 за каждую единицу прочности
  const TOUGH = { strong: 1, regen: 1, armor: 1 };
  // Удары выбивают из стали массу: m *= exp(-j / STEEL_WEAR), j — импульс удара. Обычный удар уносит
  // несколько процентов, а мяч, улёгшийся в ямку между стальными кирпичами, своим давлением стачивает её
  // за пару секунд и выкатывается.
  const STEEL_WEAR = 15000;
  const STEEL_ROUGH = 0.07;   // разброс нормали при ударе о сталь, рад (±4°)
  const WELL_BOOST = 0.15;    // на сколько мяч может разогнаться в колодце сверх скорости у ракетки (см. fallSpeed2)
  const FALL_MAX = 1.8;       // в глубоком колодце путь гнётся как при такой скорости падения, в долях скорости у ракетки
  // Приманка. Если мяч долго не попадает по кирпичам — обычно когда их осталось один-два, — бьющиеся кирпичи
  // начинают притягивать его сильнее: к их массе добавляется прибавка, которая растёт со временем без
  // попаданий. Она делится поровну между ними, так что последний кирпич тянет так же, как двадцать вместе.
  // Попадание её снимает. Тянет и при выключенном притяжении кирпичей: это помощь, а не физика уровня.
  const LURE_T0 = 6;          // с без попаданий, после которых появляется приманка
  const LURE_RAMP = 8;        // ещё через столько секунд прибавка к Gm доходит до LURE_GM и растёт дальше как t²
  const LURE_GM = 5e7;        // ≈ сотня обычных кирпичей; в симуляции последний кирпич сбивается в среднем за ~14 с
  const LURE_MAX = 4;         // предел прибавки — в долях LURE_GM
  // Магнит. Пока зажата кнопка (если нет лазера — тогда она стреляет), ракетка заворачивает мячи к себе:
  // поворачивает их скорость к ближайшей точке своей верхней кромки, не меняя величины, — до MAG_W рад/с
  // и вдвое медленнее на расстоянии MAG_R. Сила притяжения тут не годится: скорость мяча держит regulate,
  // и мяч, летящий прямо вверх, только тормозился бы и тут же разгонялся снова. Ближе MAG_NEAR к ракетке
  // магнит слабеет до нуля: иначе отскочивший мяч тут же заворачивался бы обратно и дребезжал на ней,
  // а так описывает петлю в несколько сотен пикселей и возвращается. Ушедший ниже ракетки магнит не достаёт.
  const MAG_W = 6, MAG_R = 300, MAG_NEAR = 160;
  // Вода (water.js). Ракетка всегда плавает: у кромки её держит пружина плавучести FLOAT_K (центр — на PADDLE_DRAFT
  // ниже кромки), так что она качается на волнах, проседает от ударов мяча (PADDLE_KICK от импульса удара)
  // и поднимается вместе с водой — места до кирпичей становится меньше. Ушла вода — ракетка ложится на дно,
  // на PADDLE_SINK ниже обычного. Мяч с ракетки на воде мокрый.
  // Осколок, упавший в воду, поднимает её на свой объём — SHARD_VOL px на каждые 100 px² площади; в воде осколки
  // и бонусы тонут медленно, их можно догнать. Пойманный осколок забирает WATER_CATCH px, а выловленный из воды —
  // ещё и свой объём. Взрыв выпаривает WATER_BOIL px.
  const PADDLE_DRAFT = 0, PADDLE_SINK = 14, PADDLE_KICK = 0.06, FLOAT_K = 70, FLOAT_C = 4.2;
  const SHARD_VOL = 0.35, WATER_CATCH = 0.5, WATER_BOIL = 8;
  const SHARD_G_WET = 110, SHARD_DRAG_WET = 6;
  // Боссы (boss.js) стреляют в ракетку. Мяч и лазер снаряд сбивают (SHOT_PTS очков), вода гасит, а попавший
  // в ракетку оглушает её на STUN с: она еле ползёт за курсором (пружина STUN_K вместо обычной), и мяч легко
  // упустить. Сердце босса за один удар теряет не больше CORE_HIT — огненный мяч не убивает его с налёта.
  const STUN = 1.1, STUN_K = 90, SHOT_PTS = 25, CORE_HIT = 2;
  // Взгляд Горгоны обращает ракетку в камень на STONE с: она стоит как вкопанная (мяч от неё отскакивает),
  // не стреляет и не тянет магнитом, а в воде сидит на STONE_DRAFT px глубже. Каменеет она не сразу: взгляд
  // должен продержаться на ней STARE с (вне луча набранное спадает вдвое быстрее), так что рывок сквозь луч
  // проходит безнаказанно. Оттаяв, ракетка осыпается крошкой и ещё STONE_IMM с не каменеет снова.
  const STONE = 2, STONE_IMM = 1, STONE_DRAFT = 5, STARE = 0.3;
  const SHOT_R = { fire: 9, spore: 7, dart: 6 };
  // Особые кирпичи (levelgen.js). Живой, если его не добить за REGEN_T с, зарастает одной трещиной, и так до
  // целого, но всего он зарастает не больше maxHp раз (k.sap): иначе последний живой кирпич, по которому мяч
  // попадает реже раза в REGEN_T с (приманка тянет мяч лишь через LURE_T0), не добить никогда. Призрак PHASE_ON с виден, за PHASE_FADE гаснет, PHASE_OFF с его нет — мяч проходит насквозь, — и так
  // же проявляется; твердеет он, только когда в нём нет мяча.
  const REGEN_T = 3.2;
  const PHASE_ON = 3.4, PHASE_FADE = 0.45, PHASE_OFF = 1.7, PHASE_T = PHASE_ON + PHASE_OFF + 2 * PHASE_FADE;
  const ZONE_B = AK.LevelGen.bounds.B;
  // Уровень пройден: пауза до следующего CLEAR_T с. У картины (levelgen.js → art) — ART_CLEAR: когда стена разбита,
  // в зале за ART_LIGHTS с зажигается свет (G.reveal от 0 до 1) и картину дают рассмотреть.
  const CLEAR_T = 2.6, ART_CLEAR = 6, ART_LIGHTS = 1.5;

  const G = {
    W, H, L, R: RX, T, HUD, WALL, PADDLE_Y,
    state: 'serve', demo: true, paused: false, time: 0, acc: 0, gravity: true, gview: 1,
    dry: 0, lure: 0, lureEach: 0, // с без попаданий; прибавка к Gm всего и на каждый бьющийся кирпич
    magnet: 0, magLock: false,    // сила магнита 0…1; кнопка, которой запустили мяч, магнит не включает
    score: 0, lives: 3, level: 1, seed: 1, combo: 0, prevGen: null, reveal: 0,
    shake: 0, flash: 0, aberr: 0,
    bricks: [], balls: [], debris: [], particles: [], powerups: [], lasers: [], waves: [], explQ: [], popups: [],
    shots: [], boss: null, fishes: [],
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
      local, inset: P.inset(local, s.bevel || 4.5), orient: Math.sign(P.signedArea(local)) || 1,
      circle: s.circle || 0, n: local.length / 2, rad: Math.max(P.radius(local), s.circle || 0),
      world: new Float32Array(local.length), worldIn: new Float32Array(local.length),
      bx: s.x, by: s.y, bang: s.ang || 0, x: s.x, y: s.y, ang: s.ang || 0, vx: 0, vy: 0, w: 0,
      motion: s.motion || null, kind: s.kind, hp: s.hp, maxHp: s.hp, color: s.color, note: s.note,
      flash: 0, cracks: [], alive: true, dirty: true, phase: Math.random() * TAU, boss: s.boss || null,
      armor: s.armor || null, heal: 0, sap: s.hp, vis: 1, phOff: s.phOff || 0,
    };
    const area = s.circle ? Math.PI * s.circle * s.circle : Math.abs(P.signedArea(local));
    b.mass = b.mass0 = area * (s.density || (TOUGH[s.kind] ? 0.8 + 0.5 * s.hp : DENSITY[s.kind]));
    b.gm = GCONST * b.mass;
    b.soft2 = (0.5 * b.rad) ** 2;
    pose(b, 0);
    return b;
  }

  // Ускорение от притяжения кирпичей: a = Σ Gm·d / (d² + ε²)^{3/2}. Смягчение ε: масса распределена
  // по кирпичу, а не собрана в точку; снаружи кирпича это почти точный закон 1/r².
  // Масса мяча сокращается — от неё ускорение не зависит. Кирпичи закреплены, мяч их не сдвигает.
  // К Gm бьющихся кирпичей добавляется приманка. base — с собственной массой кирпичей, lure — с приманкой.
  const brickGm = (k, base, lure) => (base ? k.gm : 0) + (lure && k.kind !== 'steel' ? G.lureEach : 0);
  G.field = function (x, y, out, base = true) {
    let ax = 0, ay = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      const dx = k.x - x, dy = k.y - y, d2 = dx * dx + dy * dy + k.soft2;
      const f = brickGm(k, base, true) / (d2 * Math.sqrt(d2));
      ax += dx * f; ay += dy * f;
    }
    out[0] = ax; out[1] = ay;
    return out;
  };
  // Потенциал того же поля: φ = −Σ Gm / √(d² + ε²), поле — его антиградиент.
  G.potential = function (x, y, base = true, lure = true) {
    let u = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      const dx = k.x - x, dy = k.y - y;
      u -= brickGm(k, base, lure) / Math.sqrt(dx * dx + dy * dy + k.soft2);
    }
    return u;
  };
  // Мяч притягивается, если включено притяжение кирпичей или действует приманка
  const pulled = () => G.gravity || G.lureEach > 0;
  G.toggleGravity = () => { G.gravity = !G.gravity; return G.gravity; };

  function pose(b, t) {
    if (b.motion) P.pose(b.motion, b.bx, b.by, b.bang, t, b);
    else if (!b.dirty) return;
    b.dirty = false;
    P.transform(b.local, b.x, b.y, b.ang, b.world);
    P.transform(b.inset, b.x, b.y, b.ang, b.worldIn);
  }

  function newPaddle() { return { x: W / 2, y: PADDLE_Y, vx: 0, vy: 0, hw: 44, r: 11, cool: 0, flash: 0, stun: 0, stone: 0, stone0: STONE, stoneImm: 0, stare: 0, stareMax: STARE }; }
  function newBall(x, y, vx, vy) { return { x, y, vx, vy, w: 0, ang: 0, r: BALL_R, stuck: false, off: 0, trail: [], dead: false, flame: 0 }; }

  // ---------- Прожекторы ----------
  // Разноцветные прожекторы на стенах светят конусом в поле: только свет и украшение, мяч их не задевает.
  // Под музыку ими управляет цветомузыка (lightshow.js): свои цвета и покачивание — когда музыки нет.
  // У каждого уровня свой набор, но генератор отдельный, чтобы не сдвигать случайности самого уровня.
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
        x, y, side, row, col: cols[ci++ % cols.length], ang: Math.atan2(ty - y, tx - x),
        half: rng.range(0.31, 0.45),                                        // полуугол конуса
        amp: rng.range(0.04, 0.08), fr: rng.range(0.25, 0.4), ph: rng.range(0, TAU), // покачивание луча
      };
    };
    // row — ряд сверху вниз: верхние прожекторы — -1, на боковых стенах — 0…3
    const spots = [];
    let row;
    for (row = 0; row < 4; row++) { const y = T + 100 + row * 200; spots.push(spot(L, y, 1), spot(RX, y, -1)); }
    row = -1;
    spots.push(spot(L + (RX - L) * 0.3, T, 0), spot(L + (RX - L) * 0.7, T, 0));
    return spots;
  }

  function serve() {
    const p = G.paddle;
    const b = newBall(p.x, p.y - p.r - BALL_R - 0.5, 0, 0);
    b.stuck = true; b.off = rand(-12, 12);
    G.balls = [b];
    G.serveT = 0;
    G.dry = 0;
  }

  function resetPowers() { for (const k in G.pw) G.pw[k] = 0; }

  G.newGame = function (seed, demo, level = 1) {
    G.demo = !!demo; G.seed = seed;
    G.level = Math.max(1, level | 0); G.score = 0; G.lives = 3; G.prevGen = null; G.paused = false;
    G.paddle = newPaddle();
    G.fishes = [];
    G.startLevel();
    spawnFish(); // рыбки живут в воде всегда; бонус делает одну из них золотой
  };

  G.startLevel = function () {
    const lv = AK.LevelGen.generate(G.level, G.seed, G.prevGen);
    G.lv = lv; G.prevGen = lv.gen;
    G.bricks = lv.bricks.map(makeBrick);
    G.spots = makeSpots(lv.seedInt);
    G.debris = []; G.particles = []; G.powerups = []; G.lasers = []; G.waves = []; G.explQ = []; G.popups = [];
    G.shots = [];
    G.boss = lv.boss || null;
    if (G.boss) G.boss.bind(G.bricks, bossApi);
    G.streak = { n: 0, t: -9 };
    G.lure = G.lureEach = 0;
    G.magnet = 0;
    G.levelTime = 0; G.combo = 0; G.acc = 0; G.reveal = 0;
    Wt.reset();
    AK.Seabed.reset();
    if (!G.paddle) G.paddle = newPaddle();
    resetPowers();
    serve();
    for (const f of G.fishes) f.reset();
    G.state = 'serve';
    A.newSong(lv.rng);
    if (G.demo) return;
    if (G.boss) AK.UI.banner(`БОСС · ${G.boss.name}`, `уровень ${G.level} · бей в глаз`, 3.2);
    else AK.UI.banner(`${lv.title} · ${lv.name}`, `уровень ${G.level} · сид ${G.seed}`, 3.2);
  };

  G.skipLevel = function () { G.level++; G.startLevel(); };

  // ---------- Скорость мяча ----------
  function targetSpeed() {
    const base = Math.min(470 + 20 * (G.level - 1), 740);
    const ramp = 1 + Math.min(G.levelTime / 100, 1) * 0.16;
    return base * ramp * (G.pw.slow > 0 ? 0.7 : 1);
  }

  // Притяжение гнёт путь мяча так же, как путь честно падающего тела, которое на линии ракетки летит с tgt:
  // кривизна пути — поперечная сила / v², где v² = tgt² + 2(φ ракетки − φ) — квадрат скорости такого тела здесь.
  // Сама скорость мяча вдоль пути почти постоянна: в колодце он разгоняется лишь на WELL_BOOST. С полной
  // скоростью падения — у тяжёлых кирпичей вдвое, у приманки вшестеро выше — мяч, выбираясь из колодца
  // к ракетке, у всех на глазах тормозил бы. Путь от скорости не зависит, и раз v здесь — функция одного φ,
  // это геодезическая, как луч света в неоднородной среде: движение обратимо, энергия не утекает, и сталь
  // не захватывает мяч, как захватывала бы, если бы скорость падения просто срезали.
  // φ ракетки — потенциал посередине её линии (G.phiRef, раз за шаг). v зажата между tgt (где потенциал выше,
  // чем там: края линии ракетки, поле над низко пикирующим боссом) и FALL_MAX·tgt — в глубоком колодце путь
  // гнётся сильнее, чем у честного падения, так притяжение тяжёлых кирпичей заметнее. С приманкой потолка нет:
  // с ним вокруг последнего кирпича появляется кольцо круговых орбит, по которому мяч подолгу кружит, не попадая.
  // b.fallRamp — v не упёрлась в пределы, и мяч разгоняется вдоль пути.
  function fallSpeed2(b, tgt) {
    const v2 = tgt * tgt + 2 * (G.phiRef - G.potential(b.x, b.y, G.gravity, true));
    const hi = G.lureEach ? Infinity : (FALL_MAX * tgt) ** 2;
    b.fallRamp = v2 > tgt * tgt && v2 < hi;
    return clamp(v2, tgt * tgt, hi);
  }

  // Попадание по бьющемуся кирпичу сразу снимает приманку. Мяч, который в её колодце разогнался, после удара
  // летит с обычной скоростью — иначе он долетел бы до ракетки пулей.
  function unlure(b) {
    G.dry = 0;
    if (!G.lure) return;
    G.lure = G.lureEach = 0;
    if (!b) return;
    const sp = Math.hypot(b.vx, b.vy), cap = targetSpeed() * 1.15;
    if (sp > cap) { b.vx *= cap / sp; b.vy *= cap / sp; }
  }

  // fall2 — квадрат скорости падения из fallSpeed2 (0 — притяжения нет)
  function regulate(b, dt, fall2) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const base = targetSpeed(), tgt = fall2 ? base * (1 + WELL_BOOST * (1 - base * base / fall2)) : base;
    // Лишнюю скорость (толчок взрыва, удар подвижного кирпича) гасим быстрее, чем добираем недостающую:
    // разгон после удара выглядит естественно, а долгое торможение в полёте — нет.
    const ns = sp + (tgt - sp) * (1 - Math.exp(-dt * (sp > tgt ? 5 : 1.8)));
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

  const SCORE = { normal: 50, strong: 60, explosive: 100, steel: 0, glass: 30, armor: 70, regen: 60, crystal: 150, phase: 80 };

  // Ребро кирпича, о которое пришёлся удар с нормалью (nx, ny): то, чья внешняя нормаль к ней ближе всего
  function edgeOf(k, nx, ny) {
    const w = k.world, n = k.n;
    let best = 0, bd = -2;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      const ex = w[j * 2] - w[i * 2], ey = w[j * 2 + 1] - w[i * 2 + 1], l = Math.hypot(ex, ey) || 1;
      const d = (k.orient * (ey * nx - ex * ny)) / l;
      if (d > bd) { bd = d; best = i; }
    }
    return best;
  }
  // Удар пришёлся в броню (сталь — вся броня)
  const armored = (k, nx, ny) => k.kind === 'steel' || (k.armor !== null && k.armor[edgeOf(k, nx, ny)]);
  // Мяч или лазер попал в броню: звон и искры, кирпич цел
  function armorHit(k, px, py, power, nx, ny, ball) {
    k.flash = 0.6;
    if (ball && ball.wet > 0) Wt.spray(px, py, nx, ny, ball.wet);
    sfx('steel', power, pan(px));
    sparks(px, py, 7, [0.8, 0.9, 1], 380, nx, ny, 0.9);
  }

  function damageBrick(k, dmg, px, py, ivx, ivy, power, nx, ny, ball) {
    k.flash = 1;
    k.heal = 0;
    if (ball && ball.wet > 0) Wt.spray(px, py, nx, ny, ball.wet);
    if (k.kind === 'steel') {
      k.mass *= Math.exp(-power / STEEL_WEAR);
      k.gm = GCONST * k.mass;
      sfx('steel', power, pan(px));
      sparks(px, py, 7, [0.8, 0.9, 1], 380, nx, ny, 0.9);
      return;
    }
    k.hp -= k.boss === 'core' ? Math.min(dmg, CORE_HIT) : dmg;
    unlure(ball);
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
    unlure();
    const base = SCORE[k.kind] * (TOUGH[k.kind] ? k.maxHp : 1);
    G.score += Math.round((base * (1 + G.combo * 0.15)) / 10) * 10;
    spawnDebris(k, ivx, ivy);
    sparks(k.x, k.y, 10, k.color, 260);
    puff(k.x, k.y, k.color, k.rad * 2.2, 0.3);
    if (k.kind === 'glass') sparks(k.x, k.y, 16, [0.9, 0.97, 1], 340);
    if (k.kind === 'crystal') { sparks(k.x, k.y, 22, U.hsl(G.time * 0.3, 0.9, 0.7), 420); puff(k.x, k.y, [1, 1, 1], k.rad * 3, 0.35); }
    if (!quiet) {
      if (k.kind === 'glass') sfx('glass', power, pan(k.x));
      else sfx('brickBreak', note != null ? note : k.note, power, pan(k.x), k.maxHp > 1);
      if (k.kind === 'crystal') sfx('chime', pan(k.x));
    }
    if (k.kind === 'explosive') G.explQ.push({ x: k.x, y: k.y, t: 0.07 });
    maybeDrop(k);
  }

  // Живой кирпич зарастает трещиной
  function healBrick(k) {
    k.heal = 0; k.hp++; k.sap--;
    k.cracks.splice(0, 2);
    if (k.hp >= k.maxHp) k.cracks.length = 0;
    sparks(k.x, k.y, 8, [0.45, 1, 0.55], 150);
    puff(k.x, k.y, [0.35, 1, 0.5], k.rad * 2, 0.4);
    sfx('heal', pan(k.x));
  }
  // Призрак: видимость vis по циклу; ghost — мяч проходит сквозь него
  function phaseBrick(k) {
    let c = (G.levelTime + k.phOff) % PHASE_T;
    k.vis = c < PHASE_ON ? 1 : (c -= PHASE_ON) < PHASE_FADE ? 1 - c / PHASE_FADE : (c -= PHASE_FADE) < PHASE_OFF ? 0 : (c - PHASE_OFF) / PHASE_FADE;
    const solid = k.vis > 0.5;
    if (solid === !k.ghost) return;
    if (solid && G.balls.some(b => !b.stuck && (k.circle ? P.circleVsCircle(b.x, b.y, b.r + 2, k.x, k.y, k.circle) : P.circleVsPoly(b.x, b.y, b.r + 2, k.world, k.orient)))) return;
    k.ghost = !solid;
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
        vol: Math.min(Math.abs(P.signedArea(local)) * SHARD_VOL / 100, 4),
      });
    }
    if (G.debris.length > 260) G.debris.splice(0, G.debris.length - 260);
  }

  // ---------- Бонусы ----------
  const PU = [['expand', 3], ['multi', 3], ['slow', 2], ['laser', 2.2], ['fire', 1.4], ['life', 0.6], ['fish', 3]];
  G.PU_COLORS = {
    expand: [0.3, 0.6, 1], multi: [1, 0.85, 0.25], slow: [0.35, 1, 0.55],
    laser: [1, 0.3, 0.35], fire: [1, 0.55, 0.12], life: [1, 0.45, 0.85], fish: [0.2, 0.95, 0.85],
  };
  function maybeDrop(k) {
    const gem = k.kind === 'crystal';
    const chance = gem ? 1 : k.maxHp > 1 ? 0.22 : 0.12;
    if (Math.random() > chance || (G.powerups.length > 5 && !gem)) return;
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
      case 'fish': addFish(); break;
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
    if (Wt.on && Wt.level < H) { Wt.evaporate(x, WATER_BOIL); sfx('steam', pan(x)); }
    for (const k of G.bricks) {
      if (!k.alive || k.ghost || k.kind === 'steel') continue;
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
    p.stun = Math.max(0, p.stun - dt);
    p.stoneImm = Math.max(0, p.stoneImm - dt);
    p.stare = Math.max(0, p.stare - 2 * dt);
    if (p.stone > 0 && (p.stone -= dt) <= 0) thaw();
    const k = p.stun > 0 ? STUN_K : 2200, c = 2 * Math.sqrt(k);
    if (p.stone > 0) p.vx = 0;
    else p.vx += (k * (target - p.x) - c * p.vx) * dt;
    // Плавучесть: кромка под ракеткой — среднее по её длине, так что качается она вместе с волнами, но плавно
    if (Wt.on) {
      const sea = (Wt.shoreAt(p.x - p.hw) + Wt.shoreAt(p.x) + Wt.shoreAt(p.x + p.hw)) / 3 + PADDLE_DRAFT + (p.stone > 0 ? STONE_DRAFT : 0);
      const f = FLOAT_K * (sea - p.y);
      p.vy += (f - FLOAT_C * p.vy) * dt;
      p.y += p.vy * dt;
      if (p.y > PADDLE_Y + PADDLE_SINK) { p.y = PADDLE_Y + PADDLE_SINK; if (p.vy > 0) p.vy = 0; }
      if (p.y + p.r > Wt.shoreAt(p.x)) Wt.hull(p.x, p.y, p.hw, p.r, p.vx, f, dt);
      // выныривая, ракетка стряхивает с борта капли
      if (p.vy < -25 && Math.random() < -p.vy * dt * 0.2) Wt.drip(p.x + (Math.random() * 2 - 1) * (p.hw + p.r * 0.6), p.y + p.r * 0.3, p.vx, 0);
    } else { p.y = PADDLE_Y; p.vy = 0; }
    p.imm = Wt.immersion(p.x, p.y, p.r);
    p.x += p.vx * dt;
    if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }
    if (p.x > maxX) { p.x = maxX; if (p.vx > 0) p.vx = 0; }
    p.cool -= dt;
    p.flash = Math.max(0, p.flash - dt * 4);

    let fire = inp.fire;
    inp.fire = false;
    if (G.demo) { G.serveT += dt; fire = G.serveT > 0.9; }
    const stuck = G.balls.filter(b => b.stuck);
    if (fire && stuck.length) { stuck.forEach(launch); G.magLock = true; }
    else if ((fire || inp.held) && G.pw.laser > 0 && p.cool <= 0 && !G.demo && !(p.stone > 0)) {
      p.cool = 0.22;
      G.lasers.push({ x: p.x - p.hw, y: p.y - p.r - 4 }, { x: p.x + p.hw, y: p.y - p.r - 4 });
      sfx('laser', pan(p.x));
    }
    if (!inp.held) G.magLock = false;
    const mag = inp.held && !G.magLock && !G.demo && G.pw.laser <= 0 && G.state === 'play' && !stuck.length && !(p.stone > 0);
    G.magnet += ((mag ? 1 : 0) - G.magnet) * (1 - Math.exp(-dt * 10));
  }

  // Магнит поворачивает скорость мяча к ракетке за время h (см. MAG_W)
  function magnetTurn(b, h) {
    const p = G.paddle, top = p.y - p.r;
    if (b.y > top) return;
    const dx = clamp(b.x, p.x - p.hw, p.x + p.hw) - b.x, dy = top - b.y;
    let da = Math.atan2(dy, dx) - Math.atan2(b.vy, b.vx);
    da -= TAU * Math.round(da / TAU);
    const d = Math.hypot(dx, dy), near = Math.min(1, d / MAG_NEAR);
    const w = ((MAG_W * G.magnet * near * near) / (1 + d / MAG_R)) * h;
    const a = Math.abs(da) < w ? da : Math.sign(da || b.vx || 1) * w, c = Math.cos(a), s = Math.sin(a);
    const vx = b.vx;
    b.vx = vx * c - b.vy * s; b.vy = vx * s + b.vy * c;
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

    // ракетка: капсула с выпуклой верхней поверхностью. Мяч, выплюнутый рыбкой, проходит её снизу насквозь.
    const p = G.paddle;
    if (b.rise && b.y + b.r < p.y - p.r - 2) b.rise = false;
    if (!b.rise && b.y + b.r > p.y - p.r - 2 && b.y - b.r < p.y + p.r + 2) {
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
        let j = P.resolve(b, b.r, nx, ny, p.vx, p.vy, 1.0, 0.32, 0.4);
        if (!j) j = P.resolve(b, b.r, hnx, hny, p.vx, p.vy, 1.0, 0.32, 0.4);
        if (j > 0) {
          if (hny < -0.2) {
            const sp = Math.hypot(b.vx, b.vy), minVy = sp * 0.34;
            if (b.vy > -minVy) { b.vy = -minVy; b.vx = U.sign(b.vx) * Math.sqrt(Math.max(sp * sp - minVy * minVy, 0)); }
          }
          G.combo = 0;
          p.flash = 1;
          sfx('paddle', j, pan(b.x));
          sparks(hpx, hpy, 6, [0.5, 0.9, 1], 260, hnx, hny, 1.0);
          // ракетка на воде мокрая: мяч с неё уходит в брызгах и сам намокает
          if (p.imm > 0) { p.vy += j * PADDLE_KICK; b.wet = 1; Wt.splash(hpx, hpy, 0.3, 8, false); sfx('splash', 0.3, pan(b.x)); }
        }
      }
    }

    // кирпичи
    const fireOn = G.pw.fire > 0;
    for (const k of G.bricks) {
      if (!k.alive || k.ghost) continue;
      const rr = k.rad + b.r;
      if (Math.abs(b.x - k.x) > rr || Math.abs(b.y - k.y) > rr) continue;
      const h = k.circle ? P.circleVsCircle(b.x, b.y, b.r, k.x, k.y, k.circle) : P.circleVsPoly(b.x, b.y, b.r, k.world, k.orient);
      if (!h) continue;
      const nx = h.nx, ny = h.ny, px = h.px, py = h.py, pen = h.pen;
      const hard = armored(k, nx, ny);
      // огненный мяч прожигает всё, кроме брони; стекло мяч бьёт с налёта и летит дальше
      if (!hard && (fireOn || k.kind === 'glass')) {
        damageBrick(k, 99, px, py, b.vx, b.vy, fireOn ? 700 : Math.hypot(b.vx, b.vy), nx, ny, b);
        continue;
      }
      b.x += nx * pen; b.y += ny * pen;
      const cvx = k.vx - k.w * (py - k.y), cvy = k.vy + k.w * (px - k.x);
      let j = 0;
      if (hard) {
        // Грани стали неровные (заклёпки, сколы): нормаль удара слегка гуляет. Это перемешивает горизонтальное
        // и вертикальное движение — иначе в прямоугольном стальном кармане, куда мяч прижимает притяжение,
        // он мог бы вечно летать по одной линии.
        const a = rand(-STEEL_ROUGH, STEEL_ROUGH), c = Math.cos(a), s = Math.sin(a);
        j = P.resolve(b, b.r, nx * c - ny * s, nx * s + ny * c, cvx, cvy, 0.97, 0.22, 0.4);
      }
      if (!j) j = P.resolve(b, b.r, nx, ny, cvx, cvy, 0.97, 0.22, 0.4);
      if (j > 0) {
        if (hard && k.kind !== 'steel') armorHit(k, px, py, j, nx, ny, b);
        else damageBrick(k, 1, px, py, b.vx, b.vy, j, nx, ny, b);
      }
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
    const tgt = targetSpeed(), fall2 = pulled() ? fallSpeed2(b, tgt) : 0;
    for (let i = 0; i < n; i++) {
      let ax = -KM * b.w * b.vy, ay = KM * b.w * b.vx;
      if (fall2) {
        // поперёк пути — сила, отнесённая к скорости падения; вдоль — разгон, с которым скорость мяча
        // идёт за tgt·(1 + WELL_BOOST·(1 − tgt²/fall2)) из regulate
        G.field(b.x, b.y, ga, G.gravity);
        const v = Math.hypot(b.vx, b.vy) || 1, tx = b.vx / v, ty = b.vy / v;
        const ft = ga[0] * tx + ga[1] * ty, k = v * v / fall2;
        const at = b.fallRamp ? 2 * WELL_BOOST * tgt ** 3 * ft * v / (fall2 * fall2) : 0;
        ax += (ga[0] - ft * tx) * k + at * tx; ay += (ga[1] - ft * ty) * k + at * ty;
      }
      b.vx += ax * h; b.vy += ay * h;
      if (G.magnet > 0.01) magnetTurn(b, h);
      b.x += b.vx * h; b.y += b.vy * h;
      collideBall(b);
    }
    b.ang += b.w * dt;
    regulate(b, dt, fall2);
    b.trail.push(b.x, b.y);
    if (b.trail.length > 36) b.trail.splice(0, 2);
    ballWater(b, dt);
    // пламя огненного мяча — ровным потоком, а не случайными клочьями
    if (G.pw.fire > 0) {
      for (b.flame += dt * 70; b.flame >= 1; b.flame--) {
        const life = rand(0.26, 0.34);
        G.particles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-30, 30), life, max: life, size: rand(6, 8), col: [1, 0.5, 0.15], g: -200, drag: 1, type: 1 });
      }
    }
    if (b.y - b.r > H + 30) b.dead = true;
  }

  // Мяч и вода: всплеск, когда он в неё влетает или выскакивает, в воде — след; намокший мяч какое-то время
  // роняет капли и стряхивает их при ударах
  function ballWater(b, dt) {
    const inW = Wt.depth(b.x, b.y) > 0;
    if (inW !== !!b.inW) {
      b.inW = inW;
      Wt.splash(b.x, b.y, inW ? 0.55 : 0.35, 10);
      sfx('splash', inW ? 0.6 : 0.35, pan(b.x));
    }
    if (inW) { b.wet = 1; Wt.push(b.x, b.y, -0.7, 9, 0.05); }
    else if (b.wet > 0) {
      b.wet = Math.max(0, b.wet - dt / 4);
      if (Math.random() < b.wet * dt * 14) Wt.drip(b.x, b.y, b.vx, b.vy);
    }
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
    Wt.add(-WATER_CATCH - (d.inW ? d.vol : 0));
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
    const p = G.paddle, dr = Math.exp(-SHARD_DRAG * dt), drW = Math.exp(-SHARD_DRAG_WET * dt);
    for (const d of G.debris) {
      // в воде — пока не выше кромки на 6 px: кромка плещется, и осколок у самой кромки не должен то входить, то выходить
      const inW = Wt.depth(d.x, d.y) > (d.inW ? -6 : 0);
      if (inW !== !!d.inW) {
        if (inW) {
          const sp = Math.hypot(d.vx, d.vy);
          Wt.splash(d.x, d.y, clamp(sp / 900, 0.12, 0.6), 6 + d.r);
          sfx('splash', clamp(sp / 900, 0.1, 0.45), pan(d.x));
        }
        Wt.add(inW ? d.vol : -d.vol); // осколок вытесняет воду
      }
      d.inW = inW;
      if (inW) {
        d.vy += SHARD_G_WET * dt;
        d.vx *= drW; d.vy *= drW; d.w *= drW;
        if (Math.random() < dt * 3) Wt.push(d.x, d.y, -0.3, 6);
      } else {
        d.vy += SHARD_G * dt;
        d.vx *= dr; d.vy *= dr;
      }
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.a += d.w * dt;
      bodyVsWalls(d, 0.35, 0.5);
      if (d.y < ZONE_B + 60) {
        for (const k of G.bricks) {
          if (!k.alive || k.ghost) continue;
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
      if (inW && d.y > p.y + p.r + d.r) d.life -= dt; // утонул ниже ракетки — уже не поймать
      d.rest = !inW && Math.hypot(d.vx, d.vy) < 40 ? d.rest + dt : 0; // тонущий медленно — не улёгшийся
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
      const inW = Wt.depth(u.x, u.y) > 0;
      if (inW && !u.inW) { Wt.splash(u.x, u.y, 0.5, 16); sfx('splash', 0.4, pan(u.x)); }
      u.inW = inW;
      u.vy = Math.min(u.vy + 520 * dt, inW ? 70 : 210); // в воде капсула тонет медленно
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

  // ---------- Рыбка ----------
  // Рыбок две: вид сбоку — в fish.js, вид сверху — в fish-top.js; водоросли — в seabed.js; здесь — чем рыбки
  // действуют на игру
  const fishApi = { sfx, pan, sparks, targetSpeed };
  function spawnFish() { G.fishes = [AK.FishTop.spawn(G, fishApi), AK.Fish.spawn(G, fishApi)]; }
  // Бонус золотит одну рыбку, наугад; если одна уже золотая — добавляет время ей
  function addFish() {
    if (!G.fishes.length) spawnFish();
    const f = G.fishes.find(f => f.left > 0) || G.fishes[(Math.random() * G.fishes.length) | 0];
    f.add();
  }
  function updateFish(dt) {
    for (const f of G.fishes) f.update(dt);
    AK.Seabed.update(dt, G);
  }

  function updateLasers(dt) {
    for (const z of G.lasers) {
      for (let s = 0; s < 3 && !z.dead; s++) {
        z.y -= (1150 * dt) / 3;
        if (z.y < T) { z.dead = true; sparks(z.x, T, 5, [1, 0.4, 0.4], 200, 0, 1, 1); break; }
        for (const q of G.shots) {
          if (q.dead || Math.hypot(q.x - z.x, q.y - z.y) > q.r + 4) continue;
          popShot(q, true); z.dead = true;
          break;
        }
        if (z.dead) break;
        for (const k of G.bricks) {
          if (!k.alive || k.ghost || Math.abs(z.x - k.x) > k.rad + 3 || Math.abs(z.y - k.y) > k.rad + 3) continue;
          const h = k.circle ? P.circleVsCircle(z.x, z.y, 3, k.x, k.y, k.circle) : P.circleVsPoly(z.x, z.y, 3, k.world, k.orient);
          if (!h) continue;
          z.dead = true;
          if (k.armor && armored(k, h.nx, h.ny)) armorHit(k, h.px, h.py, 500, h.nx, h.ny);
          else damageBrick(k, 1, h.px, h.py, 0, -400, 500, h.nx, h.ny);
          sparks(z.x, z.y, 6, [1, 0.4, 0.4], 260, 0, 1, 1.2);
          break;
        }
      }
    }
    G.lasers = G.lasers.filter(z => !z.dead);
  }

  // ---------- Снаряды босса ----------
  function shoot(x, y, vx, vy, kind, col) {
    G.shots.push({ x, y, vx, vy, kind, col, r: SHOT_R[kind], t: 0, fl: 0, home: kind === 'spore' ? 0.8 : 0 });
  }
  function popShot(s, pts) {
    s.dead = true;
    if (pts) G.score += SHOT_PTS;
    sparks(s.x, s.y, 10, s.col, 280);
    puff(s.x, s.y, s.col, s.r * 5, 0.25);
    sfx('pop', pan(s.x));
  }
  function updateShots(dt) {
    const p = G.paddle;
    for (const s of G.shots) {
      s.t += dt;
      // спора доворачивает к ракетке, пока не подлетела близко: у самой ракетки от неё ещё можно уйти
      if (s.home && s.y < p.y - 140) {
        const sp = Math.hypot(s.vx, s.vy);
        let da = Math.atan2(p.y - s.y, p.x - s.x) - Math.atan2(s.vy, s.vx);
        da -= TAU * Math.round(da / TAU);
        const a = Math.atan2(s.vy, s.vx) + clamp(da, -s.home * dt, s.home * dt);
        s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.kind === 'fire') {
        for (s.fl += dt * 50; s.fl >= 1; s.fl--) {
          const life = rand(0.18, 0.3);
          G.particles.push({ x: s.x + rand(-3, 3), y: s.y + rand(-3, 3), vx: rand(-25, 25), vy: rand(-25, 25), life, max: life, size: rand(5, 8), col: [1, 0.45, 0.12], g: -120, drag: 1, type: 1 });
        }
      } else if (Math.random() < dt * 25) {
        const life = rand(0.25, 0.45);
        G.particles.push({ x: s.x, y: s.y, vx: rand(-20, 20), vy: rand(-20, 20), life, max: life, size: rand(2, 4), col: s.col, g: 0, drag: 2, type: 1 });
      }
      for (const b of G.balls) {
        if (!b.stuck && (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < (b.r + s.r) ** 2) { popShot(s, true); break; }
      }
      if (s.dead) continue;
      if (P.circleVsCapsule(s.x, s.y, s.r, p.x, p.y, p.hw, p.r)) { stunPaddle(s); continue; }
      if (Wt.on && Wt.depth(s.x, s.y) > 0) { douse(s); continue; }
      if (s.x < L - 30 || s.x > RX + 30 || s.y > H + 30 || s.y < T - 60) s.dead = true;
    }
    G.shots = G.shots.filter(s => !s.dead);
  }
  function stunPaddle(s) {
    const p = G.paddle;
    s.dead = true;
    p.stun = STUN; p.flash = 1;
    G.shake = Math.min(G.shake + 7, 18); G.aberr = Math.min(G.aberr + 0.6, 1.5);
    sparks(s.x, s.y, 18, [0.6, 0.85, 1], 420);
    puff(s.x, s.y, s.col, 60, 0.3);
    sfx('zap', pan(s.x));
  }
  // Каменная ракетка оттаяла: осыпается крошкой и пылью
  function thaw() {
    const p = G.paddle;
    p.stone = 0; p.stoneImm = STONE_IMM;
    for (let i = 0; i < 26; i++) {
      const life = rand(0.5, 0.9);
      G.particles.push({ x: p.x + rand(-p.hw - p.r, p.hw + p.r), y: p.y + rand(-p.r, p.r * 0.5), vx: rand(-90, 90), vy: rand(-220, -40), life, max: life, size: rand(1.2, 2.6), col: [0.55, 0.54, 0.5], g: 900, drag: 1, type: 3 });
    }
    for (let i = 0; i < 5; i++) puff(p.x + rand(-p.hw, p.hw), p.y, [0.6, 0.6, 0.56], rand(18, 30), rand(0.5, 0.9), 2);
    sfx('crumble', pan(p.x));
  }
  // Снаряд упал в воду: огонь шипит паром, остальное просто плюхается
  function douse(s) {
    s.dead = true;
    Wt.splash(s.x, s.y, 0.45, 10);
    if (s.kind === 'fire') {
      for (let i = 0; i < 4; i++) puff(s.x + rand(-12, 12), s.y - rand(0, 10), [0.75, 0.78, 0.82], rand(18, 30), rand(0.6, 1), 2);
      sfx('steam', pan(s.x));
    } else sfx('splash', 0.35, pan(s.x));
  }

  // Чем босс (boss.js) действует на игру
  const bossApi = {
    shoot,
    sfx: (name, ...args) => sfx(name, ...args),
    // кирпич босса рушится сам: в цепи гибели или оторванным куском щупальца
    destroy: (k, loud) => destroyBrick(k, rand(-250, 250), rand(-250, 50), 500, !loud),
    // вспышка: size 0 — кирпич встал на место при сборке, 1 — рухнул, 2 — разбито сердце
    burst(x, y, col, size) {
      const n = [6, 14, 48][size], sp = [160, 300, 600][size];
      sparks(x, y, n, col, sp);
      if (size) puff(x, y, col, size === 2 ? 130 : 60, size === 2 ? 0.5 : 0.3);
      if (size === 2) {
        G.waves.push({ x, y, t: 0, max: 0.8, r: 190 });
        for (let i = 0; i < 6; i++) puff(x + rand(-40, 40), y + rand(-40, 40), [0.12, 0.08, 0.12], rand(40, 70), rand(0.9, 1.4), 2);
      }
    },
    shake: v => { G.shake = Math.min(G.shake + v, 18); },
    flash: v => { G.flash = Math.min(G.flash + v, 0.45); G.aberr = Math.min(G.aberr + v * 3, 1.5); },
    // взгляд Горгоны держится на ракетке ещё dt с; набралось STARE — она каменеет (если не окаменела только
    // что); true — окаменела
    stare(dt) {
      const p = G.paddle;
      if (G.state !== 'play' || p.stone > 0 || p.stoneImm > 0) return false;
      p.stare += 3 * dt; // updatePaddle каждый шаг снимает 2·dt
      if (p.stare < STARE) return false;
      p.stare = 0; p.stone = p.stone0 = STONE; p.stun = 0; p.vx = 0;
      G.shake = Math.min(G.shake + 6, 18);
      for (let i = 0; i < 4; i++) puff(p.x + rand(-p.hw, p.hw), p.y, [0.55, 0.55, 0.52], rand(16, 26), rand(0.4, 0.7), 2);
      sparks(p.x, p.y - p.r, 12, [0.45, 1, 0.55], 260);
      sfx('petrify', pan(p.x));
      return true;
    },
    defeated(title) {
      const bonus = 4000 + 500 * G.level;
      for (const s of G.shots) if (!s.dead) popShot(s, false);
      sfx('bossDie');
      if (G.demo) return;
      G.score += bonus;
      AK.UI.banner(title, '+' + bonus, 2.4);
    },
  };

  function loseLife() {
    if (G.demo) { serve(); return; }
    G.lives--;
    G.shake = 14; G.aberr = 1.5; G.flash = 0.25;
    sfx('lose');
    resetPowers();
    G.powerups = []; G.lasers = []; G.shots = [];
    G.paddle.stone = G.paddle.stare = 0;
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
    if (G.boss) G.boss.update(dt, G);
    let rem = 0;
    for (const k of G.bricks) {
      if (!k.alive) continue;
      if (k.motion) pose(k, G.levelTime);
      k.flash = Math.max(0, k.flash - dt * 5);
      if (k.kind === 'phase') phaseBrick(k);
      else if (k.kind === 'regen' && k.sap > 0 && k.hp < k.maxHp && (k.heal += dt) >= REGEN_T) healBrick(k);
      if (k.kind !== 'steel') rem++;
    }
    // приманка растёт со временем без попаданий и быстро спадает после попадания
    if (G.state === 'play' && G.balls.some(b => !b.stuck)) G.dry += dt;
    const lx = Math.max(0, G.dry - LURE_T0) / LURE_RAMP;
    const lt = LURE_GM * Math.min(lx * lx, LURE_MAX);
    G.lure = lt >= G.lure ? lt : G.lure + (lt - G.lure) * (1 - Math.exp(-dt * 5));
    if (G.lure < 1) G.lure = 0;
    G.lureEach = rem ? G.lure / rem : 0;
    Wt.step(dt, G);
    updatePaddle(dt);
    G.phiRef = pulled() ? G.potential(W / 2, PADDLE_Y, G.gravity, true) : 0;
    for (const b of G.balls) updateBall(b, dt);
    ballBall();
    updateFish(dt);
    G.balls = G.balls.filter(b => !b.dead);
    if (!G.balls.length && G.state !== 'clear' && !G.fishes.some(f => f.hold)) loseLife();

    for (const e of G.explQ) { e.t -= dt; if (e.t <= 0) { e.done = true; explode(e.x, e.y); } }
    G.explQ = G.explQ.filter(e => !e.done);

    updateLasers(dt);
    updateShots(dt);
    updatePowerups(dt);
    updateDebris(dt);
    updateParticles(dt);

    if (G.state === 'clear') {
      G.clearT -= dt;
      if (G.lv.art) G.reveal = Math.min(1, G.reveal + dt / ART_LIGHTS);
      if (G.clearT <= 0) { G.level++; G.startLevel(); }
    } else if (rem === 0 && !G.explQ.length) {
      G.state = 'clear';
      const art = G.lv.art && AK.Art.get(G.lv.art.id);
      G.clearT = art ? ART_CLEAR : CLEAR_T;
      const bonus = 1000 + 250 * G.level;
      if (!G.demo) {
        G.score += bonus;
        if (art) AK.UI.banner(`«${art.title}»`, `${art.author}, ${art.year} · +${bonus}`, ART_CLEAR - 0.5, true);
        else if (!G.boss) AK.UI.banner('УРОВЕНЬ ПРОЙДЕН', '+' + bonus, 2.4); // у босса свой баннер
      }
      sfx('clear');
      if (Wt.on && Wt.level < H) sfx('drain');
      G.flash = 0.2;
    }
  }

  G.update = function (dt) {
    G.time += dt;
    if (G.paused) { if (G.magnet) { G.magnet = 0; sfx('magnet', 0, 0); } return; }
    G.acc = Math.min(G.acc + dt, STEP * 10);
    while (G.acc >= STEP) { step(STEP); G.acc -= STEP; }
    // гул магнита глушим и в демо: если проиграть с зажатой кнопкой, иначе он так и гудел бы
    A.magnet(G.demo ? 0 : G.magnet, pan(G.paddle.x));
    const f = Math.exp(-dt * 7);
    G.shake *= f; G.aberr *= f; G.flash *= Math.exp(-dt * 5);
    G.gview += ((G.gravity ? 1 : 0) - G.gview) * (1 - Math.exp(-dt * 4)); // сетка поля плавно распрямляется
  };

  AK.G = G;
})(window.AK);
