'use strict';
// Вторая рыбка, прежняя: живёт в воде вместе с рыбкой из fish.js, но нарисована сверху и плывёт, изгибаясь
// в плоскости экрана. Бонус «рыбка» (game.js) золотит одну из двух, наугад.
//
// Рыбка живёт в воде под ракеткой всегда (game.js заводит её с новой игрой). Обычно она серебристая и занята
// своим: плавает, щиплет водоросли (seabed.js), отдыхает у дна, следит за мячом, крутит петли, глотает воздух
// у поверхности, а от мяча или осколка, плюхнувшегося рядом, шарахается; тонущий осколок обплывает. Бонус делает
// её золотой на FISH_T секунд (ещё бонус — ещё столько же, но не больше FISH_MAX; время идёт, только пока мяч
// в игре), и тогда она, как дельфин, отбивает хвостом мяч, который ракетка упустила (рыбка из fish.js ловит его
// ртом): заранее подставляет хвост туда, где падающий мяч пересечёт её дорожку, на подлёте замахивается, отводя
// хвост от мяча, и хлёстко бьёт навстречу. Мяч летит вверх, к кирпичам (b.rise: проходит ракетку снизу насквозь),
// а рыбку от удара бросает вперёд. Время на исходе — вспыхивает, вышло — снова становится серебристой.
//
// Движение. Рыбка — не точка, а позвоночник из N позвонков. Нос ведёт рулёжка: курс, скорость, поворот с пределом
// угловой скорости; на развороте рыбка притормаживает и описывает дугу вверх, от дна, а цель чуть позади
// достаёт задним ходом на грудных плавниках. Череп жёсткий, остальные позвонки идут за носом след в след; сгиб
// в каждом суставе ограничен и сам распрямляется. Поверх — плавательная волна: бежит от головы к хвосту и растёт
// к хвосту, как у карповых; частота и размах — от скорости, разгона и поворота. Хвост-вуаль и плавники гнутся
// с запаздыванием и трепещут по краю; грудные плавники на ходу прижаты, на месте гребут попеременно, на торможении
// и с внутренней стороны поворота раскрываются. Рот всё время дышит, жаберные крышки ходят.
//
// Рисунок — вид сверху: тень на дне, двойной хвост-вуаль и плавники с лучами, тело с градиентом от спины к бокам,
// чешуя рядами внахлёст (передняя чешуйка лежит на задней), и у каждой свой наклон — отлив бежит по боку,
// обращённому к свету, и переливается, когда тело изгибается (у серебристой — перламутром). Глаза навыкате,
// ноздри, жаберные крышки, спинной плавник кренится на поворотах. Окраска плавно перетекает из серебра в золото.
(function (AK) {
  const { U } = AK;
  const { clamp, TAU, lerp } = U;
  const W = 720, H = 960, L = 16, RX = 704;
  const FISH_T = 25, FISH_MAX = 50;   // с
  const DEPTH = 34;                   // px: дорожка рыбки — ниже ракетки на столько
  const N = 13, SEG = 4;              // позвонков и px между ними: тело 48 px от носа до хвостового стебля
  const BEND = 0.42;                  // рад: предельный сгиб в суставе
  const STRAIGHT = 2.5;               // 1/с: как быстро тело само распрямляется
  const V = 760, ACC = 4200, BRAKE = 7000; // px/s, px/s²: предел скорости, разгон, торможение
  const TURN = 16;                    // рад/с: предел угловой скорости
  const ARRIVE = 8;                   // 1/с: на подходе к цели скорость — расстояние·ARRIVE
  const BACK = 90, BACK_REACH = 26;   // px/s, px: задним ходом — не быстрее и не дальше
  const TAIL = 25;                    // px: длина хвоста-вуали
  const REACH = 60;                   // px: от носа до середины вуали — ею рыбка и бьёт
  const HIT_R = 22;                   // px: вуаль достаёт мяч на столько от своей середины (плюс радиус мяча)
  const WIND = 0.14;                  // с: мяч долетит до хвоста за столько — рыбка замахивается
  const SLAP = 0.4, FLICK = 16;       // с, px: удар с затуханием и его размах у хвостового стебля
  const MARGIN = 16;                  // px: на столько ниже кромки воды держится без дела (нос — до 4 px)
  const SPLASH_R = 150, SINK_R = 30;  // px: осколок, упавший в воду ближе, пугает; тонущий ещё ближе — обплывает
  const LX = -0.45, LY = -0.89;       // направление на свет (вверх-влево, как в draw.js)
  // блик чешуи: полувектор между светом (сверху-слева) и взглядом (сверху)
  const HX = -0.148, HY = -0.295, HZ = 0.944;
  // полуширина тела в позвонках, от носа к хвосту
  const WID = [3.6, 6.4, 8.2, 9.2, 9.6, 9.4, 8.8, 7.8, 6.6, 5.3, 4.0, 3.0, 2.4];
  // Окраска: золотая (с бонусом) и серебристая; в кадре — смесь по f.gold. back — спина, flank — отлив боков,
  // edge — край тела, spec — блик чешуи; плавники: от корня (…0) к краю (…1), с прозрачностью
  const GOLD = {
    back: [0.86, 0.3, 0.05], flank: [1, 0.62, 0.16], edge: [0.5, 0.15, 0.02], spec: [1, 0.93, 0.7],
    tail0: [1, 0.5, 0.12, 0.8], tail1: [1, 0.84, 0.58, 0.18], fin0: [1, 0.58, 0.2, 0.7], fin1: [1, 0.86, 0.6, 0.18],
    ray: [0.8, 0.32, 0.06], rim: [1, 0.88, 0.62], gill: [0.42, 0.1, 0.02], gillHi: [1, 0.75, 0.42], brow: [1, 0.82, 0.5],
    socket: [0.32, 0.09, 0.02], iris: [0.95, 0.74, 0.3], lip: [1, 0.7, 0.45], throat: [0.22, 0.03, 0.02],
    nostril: [0.3, 0.07, 0.02], dors0: [1, 0.5, 0.15, 0.5], dors1: [1, 0.82, 0.55, 0.22], dorsLine: [0.75, 0.25, 0.04],
  };
  const SILVER = {
    back: [0.42, 0.5, 0.6], flank: [0.76, 0.83, 0.91], edge: [0.28, 0.34, 0.43], spec: [0.85, 0.95, 1],
    tail0: [0.6, 0.7, 0.85, 0.6], tail1: [0.86, 0.93, 1, 0.12], fin0: [0.64, 0.74, 0.9, 0.55], fin1: [0.88, 0.94, 1, 0.12],
    ray: [0.28, 0.38, 0.52], rim: [0.85, 0.93, 1], gill: [0.1, 0.14, 0.22], gillHi: [0.75, 0.86, 1], brow: [0.75, 0.86, 1],
    socket: [0.1, 0.13, 0.19], iris: [0.86, 0.72, 0.42], lip: [0.86, 0.72, 0.76], throat: [0.16, 0.05, 0.08],
    nostril: [0.1, 0.12, 0.18], dors0: [0.55, 0.68, 0.85, 0.45], dors1: [0.86, 0.93, 1, 0.16], dorsLine: [0.24, 0.32, 0.45],
  };
  const PEARL = [1, 0.82, 0.95]; // перламутр: блики серебристой чешуи отливают розовым
  const PAL = {};
  for (const k in GOLD) PAL[k] = GOLD[k].slice();
  PAL.scMid = [0, 0, 0]; PAL.scSide = [0, 0, 0];
  function palette(g) {
    for (const k in GOLD) for (let i = 0; i < GOLD[k].length; i++) PAL[k][i] = lerp(SILVER[k][i], GOLD[k][i], g);
    for (let i = 0; i < 3; i++) { // чешуя: между спиной и боком, на боку
      PAL.scMid[i] = lerp(PAL.back[i], PAL.flank[i], 0.75); PAL.scSide[i] = lerp(PAL.flank[i], PAL.edge[i], 0.3);
    }
  }
  const wrap = a => a - TAU * Math.round(a / TAU);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lane = G => Math.min(G.paddle.y + DEPTH, H - 22);
  // Вода без дела: от кромки (ниже на MARGIN) до дна; когда воды нет (уровень пройден, вода ушла) — за нижний край
  const BOT = H - 16;
  const surf = (G, x) => (AK.Water.on ? AK.Water.shoreAt(x) : G.paddle.y - 10);
  const dry = (G, x) => surf(G, x) > BOT - 24;

  // Чешуя: ряды поперёк тела (v — доля полуширины, + — к боку n) и столбцы вдоль (s — доля длины);
  // соседние ряды сдвинуты на полшага. Рисуются от хвоста к голове, чтобы передние ложились сверху.
  const SCALES = [];
  for (let c = 0; ; c++) {
    const s0 = 0.95 - c * 0.069;
    if (s0 < 0.25) break;
    for (const v of [-0.62, -0.31, 0, 0.31, 0.62]) {
      const s = s0 - (Math.abs(v) > 0.4 || v === 0 ? 0 : 0.0345);
      if (s >= 0.25) SCALES.push({ s, v });
    }
  }

  const Fish = {};
  const proto = {};

  Fish.spawn = function (G, api) {
    const f = Object.create(proto);
    const x = rand(L + 80, RX - 80), y = (Math.min(surf(G, x) + MARGIN, BOT) + BOT) / 2, ang = Math.random() < 0.5 ? 0 : Math.PI;
    Object.assign(f, {
      G, api, left: 0, gold: 0, flare: 0, x, y, ang, sp: 0, om: 0, acc: 0, vx: 0, vy: 0,
      t: 0, ph: 0, amp: 1, br: 0, mouth: 0, gill: 0, lean: 0, tf: ang + Math.PI, pecL: 0.3, pecR: 0.3, bub: [],
      // замах (0…1), удар (1 → 0), в какую сторону бьёт, рывок после удара, где ударила, сколько раз спасла мяч
      wind: 0, slap: 0, side: 1, kickT: 0, hitAt: null, saves: 0,
      mode: null, last: '', modeT: 0, goal: { x, y }, vmax: 0, scare: 0, peck: 0, peckPh: 0, nib: null, loop: null,
      jolt: 0, seen: new WeakSet(), // испуг (1 — только что вздрогнула) и осколки, которых уже пугалась
      p: new Float32Array(N * 2),   // позвоночник
      q: new Float32Array(N * 2),   // он же с плавательной волной — так рыбка и рисуется
      tn: new Float32Array(N * 2),  // касательная волнистого позвоночника, к носу
      // у каждой чешуйки свой наклон, тон и оттенок перелива
      jit: SCALES.map(() => [rand(-0.15, 0.15), rand(-0.15, 0.15), rand(0.9, 1.08), rand(-0.12, 0.12)]),
    });
    for (let i = 0; i < N; i++) { f.p[i * 2] = x - Math.cos(ang) * SEG * i; f.p[i * 2 + 1] = y - Math.sin(ang) * SEG * i; }
    pose(f);
    return f;
  };

  // Бонус: рыбка золотеет (с вспышкой и искрами) и получает ещё время
  proto.add = function () {
    const f = this;
    if (f.left <= 0) {
      f.flare = 1; f.mode = null;
      f.api.sparks(f.x, f.y, 26, [1, 0.82, 0.35], 240);
      bubbles(f, 6);
    }
    f.left = Math.min(f.left + FISH_T, FISH_MAX);
  };
  // Новый уровень: замах и удар не доигрываются
  proto.reset = function () { this.wind = 0; this.slap = 0; this.hitAt = null; };

  // Куда подставить хвост: туда, где раньше всех падающий мяч пересечёт дорожку (с отскоками от стен);
  // если никто не падает — хвост под самым нижним мячом, рыбка лениво прохаживается
  function target(f, y0) {
    let best = null, bt = Infinity, low = null;
    for (const b of f.G.balls) {
      if (b.stuck) continue;
      if (!low || b.y > low.y) low = b;
      if (b.vy <= 0) continue;
      const t = (y0 - b.y) / b.vy;
      if (t > -0.05 && t < bt) { bt = t; best = b; }
    }
    if (!best) return clamp((low ? low.x : f.G.paddle.x) + Math.sin(f.t * 0.7) * 40, L + 30, RX - 30);
    const BALL_R = best.r, lo = L + BALL_R, span = RX - BALL_R - lo;
    let x = (best.x + best.vx * Math.max(bt, 0) - lo) % (2 * span);
    if (x < 0) x += 2 * span;
    if (x > span) x = 2 * span - x;
    return clamp(lo + x, L + 24, RX - 24);
  }

  function bubbles(f, n, x = f.x, y = f.y) {
    const Wt = AK.Water;
    if (!Wt.on || Wt.depth(x, y) <= 0) return;
    for (let i = 0; i < n; i++) {
      f.bub.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), r: rand(1.4, 3.4), vy: rand(40, 90), t: 0, max: rand(0.8, 1.6), ph: rand(0, TAU) });
    }
  }

  // С какой стороны от хвостового стебля точка: +1 — куда волна в pose() гнёт тело при сдвиге больше нуля
  function sideOf(f, x, y) {
    const p = f.p, i = (N - 1) * 2, dx = p[i - 2] - p[i], dy = p[i - 1] - p[i + 1];
    return (x - p[i]) * -dy + (y - p[i + 1]) * dx >= 0 ? 1 : -1;
  }
  // Удар хвостом. Мяч на подлёте к вуали — рыбка замахивается, отводя хвост от него; мяч у вуали (или задел
  // тело) — бьёт
  function tailBall(f, dt) {
    const G = f.G, q = f.q, i = (N - 1) * 2;
    const hx = q[i] + Math.cos(f.tf) * TAIL * 0.55, hy = q[i + 1] + Math.sin(f.tf) * TAIL * 0.55; // середина вуали
    let wind = 0;
    for (const b of G.balls) {
      if (b.stuck || b.vy <= 0) continue;
      let hit = Math.hypot(b.x - hx, b.y - hy) < HIT_R + b.r;
      for (let j = 0; !hit && j < N; j += 2) hit = Math.hypot(b.x - q[j * 2], b.y - q[j * 2 + 1]) < WID[j] + b.r + 2;
      if (hit) { slap(f, b, hx, hy); return; }
      const t = (hy - HIT_R - b.r - b.y) / b.vy;
      if (t < WIND && t > -0.05 && Math.abs(b.x + b.vx * Math.max(t, 0) - hx) < HIT_R + 20) { wind = 1; f.side = sideOf(f, b.x, b.y); }
    }
    f.wind += (wind - f.wind) * (1 - Math.exp(-dt * 16));
  }

  // Куда отбить: вверх, с поправкой к середине поля и разбросом
  const aimAt = x => -Math.PI / 2 + clamp(((W / 2 - x) / (W / 2)) * 0.35 + rand(-0.2, 0.2), -0.5, 0.5);

  // Хвост хлёстко бьёт навстречу мячу, и тот летит вверх; рыбку от удара бросает вперёд, а нос отдаёт в другую
  // сторону
  function slap(f, b, hx, hy) {
    f.side = sideOf(f, b.x, b.y); f.slap = 1; f.kickT = 0.35; f.hitAt = { x: b.x, y: b.y }; f.saves++;
    f.sp = Math.max(f.sp, 0) + 240; f.om -= f.side * 5; f.gill = 1;
    const a = aimAt(b.x), sp = f.api.targetSpeed();
    b.x = clamp(b.x, L + b.r, RX - b.r);
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.w = 0; b.rise = true; b.trail.length = 0;
    f.api.sfx('slap', f.api.pan(b.x));
    AK.Water.push(hx, hy, 0.6, 14);
    bubbles(f, 10, hx, hy);
    f.api.sparks(b.x, b.y, 10, [1, 0.8, 0.35], 260, Math.cos(a), Math.sin(a), 0.9);
  }
  // Сдвиг хвостового стебля от удара, px: замах — от мяча, удар — рывком к нему и затухающие колебания
  function flick(f) {
    const u = 1 - f.slap, hit = f.slap <= 0 ? 0 : u < 0.1 ? U.smooth(u / 0.1) : Math.exp(-(u - 0.1) * 6) * Math.cos((u - 0.1) * 14);
    return f.side * FLICK * (hit - 0.5 * f.wind);
  }

  // Рулёжка носа: желаемая скорость (dvx, dvy), а если задан курс head — разворот на месте; near — цель рядом,
  // и если она позади, рыбка сдаёт назад грудными плавниками, а не разворачивается
  function swim(f, dt, dvx, dvy, head, near) {
    const c = Math.cos(f.ang), s = Math.sin(f.ang);
    let want = f.ang, spd, back = false;
    if (head !== null) { want = head; spd = 50; }
    else {
      spd = Math.hypot(dvx, dvy);
      const fwd = dvx * c + dvy * s;
      if (fwd < 0 && near && Math.abs(c) > 0.7) { spd = Math.max(fwd, -BACK); back = true; }
      else if (spd > 20) want = Math.atan2(dvy, dvx);
    }
    let err = wrap(want - f.ang);
    if (Math.abs(err) > 2.7) err = Math.abs(err) * (c > 0 ? -1 : 1); // разворот — дугой вверх, от дна
    f.om += (clamp(err * 14, -TURN, TURN) - f.om) * (1 - Math.exp(-dt * 30));
    f.ang = wrap(f.ang + f.om * dt);
    const goal = back ? spd : spd * clamp(Math.cos(err), 0.08, 1); // на развороте притормаживает
    const sp0 = f.sp;
    if (f.kickT > 0.12) f.sp *= Math.exp(-dt * 3); // рывок после удара хвостом — вода гасит его плавно
    else f.sp += clamp(goal - f.sp, -BRAKE * dt, ACC * dt);
    f.acc = (f.sp - sp0) / dt;
    f.vx = Math.cos(f.ang) * f.sp; f.vy = Math.sin(f.ang) * f.sp;
    f.x += f.vx * dt; f.y += f.vy * dt;
  }

  // Позвоночник: череп жёсткий, дальше — след в след за носом, со сгибом не больше BEND и распрямлением
  function follow(f, dt) {
    const p = f.p, relax = Math.exp(-dt * STRAIGHT);
    p[0] = f.x; p[1] = f.y;
    p[2] = f.x - Math.cos(f.ang) * SEG; p[3] = f.y - Math.sin(f.ang) * SEG;
    let a0 = f.ang;
    for (let i = 2; i < N; i++) {
      const a = a0 + clamp(wrap(Math.atan2(p[i * 2 - 1] - p[i * 2 + 1], p[i * 2 - 2] - p[i * 2]) - a0) * relax, -BEND, BEND);
      p[i * 2] = p[i * 2 - 2] - Math.cos(a) * SEG; p[i * 2 + 1] = p[i * 2 - 1] - Math.sin(a) * SEG;
      a0 = a;
    }
  }

  // Плавательная волна поверх позвоночника, а с ударом — и хлёст задней половины тела; касательные — уже волнистого
  function pose(f) {
    const p = f.p, q = f.q, tn = f.tn, fl = flick(f);
    for (let i = 0; i < N; i++) {
      const j0 = Math.max(i - 1, 0), j1 = Math.min(i + 1, N - 1);
      let dx = p[j0 * 2] - p[j1 * 2], dy = p[j0 * 2 + 1] - p[j1 * 2 + 1];
      const l = Math.hypot(dx, dy) || 1, s = i / (N - 1);
      dx /= l; dy /= l;
      const off = f.amp * (0.1 + 0.9 * s * s) * Math.sin(f.ph - 5.3 * s) + fl * Math.max(0, (s - 0.3) / 0.7) ** 2;
      q[i * 2] = p[i * 2] - dy * off; q[i * 2 + 1] = p[i * 2 + 1] + dx * off;
    }
    for (let i = 0; i < N; i++) {
      const j0 = Math.max(i - 1, 0), j1 = Math.min(i + 1, N - 1);
      const dx = q[j0 * 2] - q[j1 * 2], dy = q[j0 * 2 + 1] - q[j1 * 2 + 1], l = Math.hypot(dx, dy) || 1;
      tn[i * 2] = dx / l; tn[i * 2 + 1] = dy / l;
    }
  }

  // Шаг рыбки
  proto.update = function (dt) {
    const f = this, G = f.G, y0 = lane(G);
    f.t += dt;
    if (G.state === 'play') f.left = Math.max(0, f.left - dt);
    f.gold += ((f.left > 0 ? 1 : 0) - f.gold) * (1 - Math.exp(-dt * 3));
    f.flare = Math.max(0, f.flare - dt * 1.4);
    f.scare = Math.max(0, f.scare - dt);
    f.mouth = Math.max(0, f.mouth - dt * 3);
    f.gill = Math.max(0, f.gill - dt * 2.5);
    f.kickT = Math.max(0, f.kickT - dt);
    f.slap = Math.max(0, f.slap - dt / SLAP);
    f.jolt = Math.max(0, f.jolt - dt * 3);
    // осколок плюхнулся рядом: золотая рыбка только вздрагивает, остальное — в idle
    const hit = splash(f);
    if (hit && f.left > 0) flinch(f, 3.5);
    let tx = f.x, ty = y0 + Math.sin(f.t * 0.9) * 3, head = null;
    if (f.left > 0) {
      // нос — на REACH впереди точки встречи, чтобы там оказался хвост. Носом к стенке хвост до неё не достанет —
      // тогда мяч встречает тело, и хвост бьёт всё равно
      if (f.kickT > 0.12) head = f.ang; // только что ударила — проносится вперёд
      else tx = clamp(target(f, y0) + (Math.cos(f.ang) >= 0 ? REACH : -REACH), L + 14, RX - 14);
      f.mode = null;
      tailBall(f, dt);
    } else f.wind = 0;
    if (f.left > 0) swim(f, dt, clamp((tx - f.x) * ARRIVE, -V, V), clamp((ty - f.y) * 6, -240, 240), head, Math.abs(tx - f.x) < BACK_REACH);
    else if (f.kickT > 0.12) swim(f, dt, 0, 0, f.ang, false);
    else idle(f, dt, hit);
    keepIn(f);
    follow(f, dt);
    // волна: чаще и шире на ходу, на разгоне и на повороте; задним ходом хвост почти не работает
    const r = Math.min(Math.abs(f.sp) / V, 1);
    const thrust = f.sp < 0 ? 0.05 : clamp(r * 1.2 + Math.max(0, f.acc) / ACC * 0.6 + Math.abs(f.om) / TURN * 0.5 + f.jolt, 0, 1);
    f.amp += (0.7 + 4.2 * thrust - f.amp) * (1 - Math.exp(-dt * 6));
    f.ph += dt * TAU * (0.9 + 6.5 * (f.sp < 0 ? 0 : r));
    f.br += dt * TAU * 1.4;
    pose(f);
    // хвост гнётся вслед за стеблем с запаздыванием
    const ped = Math.atan2(-f.tn[N * 2 - 1], -f.tn[N * 2 - 2]);
    f.tf = ped + wrap(f.tf - ped) * Math.exp(-dt * 14);
    f.lean += (clamp(f.om * 0.05, -0.5, 0.5) - f.lean) * (1 - Math.exp(-dt * 8)); // кренится внутрь поворота
    // грудные плавники: на ходу прижаты, на месте раскрыты и гребут попеременно, на торможении раскрыты;
    // с внутренней стороны поворота раскрываются шире, а вздрогнув — растопыриваются
    const slow = 1 - U.smooth(clamp(r / 0.3, 0, 1));
    const brake = clamp(-f.acc / BRAKE, 0, 1), turn = clamp(f.om / TURN, -1, 1);
    for (const sg of [1, -1]) {
      const scull = 0.3 * slow * Math.sin(f.t * TAU * 2.2 + (sg > 0 ? 0 : Math.PI));
      const goal = 0.25 + 0.9 * slow + 0.9 * brake + 0.7 * Math.max(0, turn * sg) + scull + (f.sp < 0 ? 0.3 : 0) + 1.1 * f.jolt;
      if (sg > 0) f.pecR += (goal - f.pecR) * (1 - Math.exp(-dt * 10));
      else f.pecL += (goal - f.pecL) * (1 - Math.exp(-dt * 10));
    }
    if (Math.random() < dt * (0.3 + 3 * r)) bubbles(f, 1, f.x - Math.cos(f.ang) * 10, f.y - Math.sin(f.ang) * 10);
    for (const b of f.bub) { b.t += dt; b.y -= b.vy * dt; b.x += Math.sin(b.t * 9 + b.ph) * 14 * dt; }
    f.bub = f.bub.filter(b => b.t < b.max && AK.Water.depth(b.x, b.y) > 0);
  };

  // Нос — в поле и под водой; воды нет — уходит за нижний край
  function keepIn(f) {
    const G = f.G;
    f.x = clamp(f.x, L + 10, RX - 10);
    if (dry(G, f.x)) { f.y = Math.min(f.y, H + 60); return; }
    f.y = clamp(f.y, Math.min(surf(G, f.x) + 4, BOT), H - 10);
  }

  // ---------- Без дела ----------
  // Занятия и их вес: плавает куда глаза глядят, отдыхает у дна, щиплет водоросли, следит за мячом,
  // делает рывок, крутит петлю, глотает воздух у поверхности
  const MODES = [['cruise', 3], ['rest', 1.4], ['nibble', 2.4], ['watch', 1.4], ['dart', 0.8], ['loop', 0.9], ['gulp', 0.7]];
  const topAt = (G, x) => Math.min(surf(G, x) + MARGIN, BOT);
  // Случайная точка воды без дела: x в поле, y — от кромки до дна
  function spot(f, x = rand(L + 40, RX - 40)) { return { x, y: rand(topAt(f.G, x), BOT) }; }
  function pickMode(f) {
    const G = f.G, Wt = AK.Water, Sb = AK.Seabed;
    const deep = BOT - topAt(G, f.x);
    const ok = ([m]) => m !== f.last &&
      (m === 'nibble' ? Wt.on && Sb.fronds.length > 0 : m === 'gulp' ? Wt.on : m === 'loop' ? deep > 70 : true);
    const list = MODES.filter(ok);
    let x = Math.random() * list.reduce((a, m) => a + m[1], 0), m = list[0][0];
    for (const it of list) { x -= it[1]; if (x <= 0) { m = it[0]; break; } }
    f.mode = f.last = m;
    f.nib = null; f.loop = null; f.peck = 0; f.peckPh = 0;
    switch (m) {
      case 'cruise': f.goal = spot(f); f.vmax = rand(110, 210); f.modeT = 6; break;
      case 'rest': f.goal = { x: f.x, y: lerp(f.y, BOT, 0.6) }; f.vmax = 30; f.modeT = rand(1.5, 3); break;
      case 'nibble':
        f.nib = Sb.pick(f.x, x => topAt(G, x), BOT); f.vmax = 150; f.modeT = 7;
        if (!f.nib) { f.mode = 'cruise'; f.goal = spot(f); f.vmax = 150; f.modeT = 6; }
        break;
      case 'watch': f.vmax = 280; f.modeT = rand(2.5, 4); f.goal = { x: f.x, y: f.y }; break;
      case 'dart': {
        let g = spot(f);
        for (let i = 0; i < 4 && Math.abs(g.x - f.x) < 200; i++) g = spot(f);
        f.goal = g; f.vmax = 560; f.modeT = 1.2; break;
      }
      case 'loop': {
        // круг радиуса r сбоку от курса; цель бежит по нему чуть впереди рыбки
        const sg = Math.random() < 0.5 ? 1 : -1, r = 26, nx = -Math.sin(f.ang) * sg, ny = Math.cos(f.ang) * sg;
        f.loop = { cx: f.x + nx * r, cy: f.y + ny * r, r, a: Math.atan2(-ny, -nx), sg };
        f.vmax = 220; f.modeT = (TAU * r) / 220 * 1.3 + 0.3; break;
      }
      case 'gulp': {
        let x = rand(L + 40, RX - 40);
        for (let i = 0; i < 4 && Math.abs(x - G.paddle.x) < G.paddle.hw + 50; i++) x = rand(L + 40, RX - 40);
        f.goal = { x, y: surf(G, x) + 4 }; f.vmax = 160; f.modeT = 5; break;
      }
    }
  }
  // Расстояние от точки до рыбки: до носа, середины или хвостового стебля
  function near(f, x, y) {
    const q = f.q;
    return Math.min(Math.hypot(x - q[0], y - q[1]), Math.hypot(x - q[12], y - q[13]), Math.hypot(x - q[24], y - q[25]));
  }
  // Осколок, только что упавший в воду ближе SPLASH_R (ближайший), или null; каждого рыбка пугается один раз
  function splash(f) {
    let best = null, bd = SPLASH_R;
    for (const d of f.G.debris) {
      if (!d.inW || f.seen.has(d)) continue;
      f.seen.add(d);
      const dd = near(f, d.x, d.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  // Вздрагивает: хвост бьёт, плавники растопыриваются, жабры раздуваются, вырываются пузыри
  function flinch(f, amp) {
    f.jolt = 1; f.amp = Math.max(f.amp, amp); f.gill = 1;
    bubbles(f, 3);
  }
  // Шарахается прочь от (x, y) со скоростью до v: вбок, подальше (у стенки — в другую сторону) и глубже, если
  // угроза сверху
  function flee(f, x, y, v) {
    let sx = Math.abs(f.x - x) > 8 ? Math.sign(f.x - x) : Math.cos(f.ang) >= 0 ? 1 : -1;
    if ((sx > 0 ? RX - 40 - f.x : f.x - L - 40) < 60) sx = -sx;
    const gx = clamp(f.x + sx * rand(150, 220), L + 40, RX - 40);
    f.mode = f.last = 'dart'; f.goal = { x: gx, y: clamp(f.y + clamp(f.y - y, -60, 60), topAt(f.G, gx), BOT) };
    f.vmax = v; f.modeT = 1.2; f.scare = 1.2; f.nib = null; f.loop = null;
    flinch(f, v > 400 ? 4.5 : 3);
  }
  // Пугается без дела: мяч или осколок (hit) плюхнулся в воду рядом — шарахается; осколок тонет вплотную к ней —
  // отплывает от него
  function startle(f, hit) {
    if (f.scare > 0) return;
    if (hit) { flee(f, hit.x, hit.y, 620); return; }
    for (const b of f.G.balls) {
      if (b.stuck || AK.Water.depth(b.x, b.y) < -6 || Math.hypot(b.vx, b.vy) < 150) continue;
      if (Math.hypot(f.x - b.x, f.y - b.y) < 100) { flee(f, b.x, b.y, 620); return; }
    }
    for (const d of f.G.debris) if (d.inW && near(f, d.x, d.y) < SINK_R + d.r) { flee(f, d.x, d.y, 300); return; }
  }
  function idle(f, dt, hit) {
    const G = f.G, Wt = AK.Water, Sb = AK.Seabed;
    if (dry(G, f.x)) { swim(f, dt, 0, (H + 50 - f.y) * 3, null, false); f.mode = null; return; }
    if (!f.mode || (f.modeT -= dt) <= 0) pickMode(f);
    startle(f, hit);
    let gx = f.goal.x, gy = f.goal.y, near = false;
    switch (f.mode) {
      case 'cruise': case 'dart':
        if (Math.hypot(gx - f.x, gy - f.y) < 16) f.modeT = Math.min(f.modeT, f.mode === 'dart' ? 0.01 : 0.4);
        break;
      case 'rest': near = true; gx += Math.sin(f.t * 0.8) * 4; break;
      case 'nibble': {
        // подплывает к листу и щиплет его: быстро тычется носом и медленно отступает, лист дёргается
        const q = Sb.node(f.nib);
        if (!q) { f.modeT = 0; break; }
        if (f.peck > 0 || Math.hypot(q[0] - f.x, q[1] - f.y) < 10) {
          if (f.peck <= 0) f.modeT = Math.min(f.modeT, rand(1.6, 3));
          f.peck += dt;
          const ph = (f.peck * 2.6) % 1, c = Math.cos(f.ang), s = Math.sin(f.ang);
          const k = ph < 0.25 ? ph / 0.25 : 1 - (ph - 0.25) / 0.75;
          gx = q[0] - c * (7 - 9 * k); gy = q[1] - s * (7 - 9 * k); near = true;
          if (ph < f.peckPh) { f.mouth = 1; Sb.poke(f.nib, c * 90, s * 90); if (Math.random() < 0.5) bubbles(f, 1); }
          f.peckPh = ph;
        } else { gx = q[0]; gy = q[1]; }
        break;
      }
      case 'watch': {
        // следит за мячом снизу, как кошка за мухой
        let low = null;
        for (const b of G.balls) if (!low || b.y > low.y) low = b;
        const x = clamp(low ? low.x : G.paddle.x, L + 30, RX - 30);
        f.goal.x += (x - f.goal.x) * (1 - Math.exp(-dt * 2));
        f.goal.y = Math.min(topAt(G, f.goal.x) + 4, BOT);
        gx = f.goal.x; gy = f.goal.y; near = Math.abs(gx - f.x) < 20;
        break;
      }
      case 'loop': {
        const o = f.loop;
        o.a += o.sg * (f.vmax / o.r) * dt * 0.9;
        gx = o.cx + Math.cos(o.a + o.sg * 0.7) * o.r; gy = o.cy + Math.sin(o.a + o.sg * 0.7) * o.r;
        break;
      }
      case 'gulp': {
        // нос у самой поверхности — хватает воздух: круги по воде и пузырёк
        gy = surf(G, gx) + 4;
        if (Math.hypot(gx - f.x, gy - f.y) < 6) {
          f.mouth = 1; f.gill = 1;
          if (Wt.on) Wt.push(f.x, surf(G, f.x) + 2, -0.5, 8);
          bubbles(f, 2);
          f.mode = 'rest'; f.goal = { x: f.x, y: lerp(f.y, BOT, 0.7) }; f.vmax = 60; f.modeT = rand(0.8, 1.5);
        }
        break;
      }
    }
    const dx = gx - f.x, dy = gy - f.y, d = Math.hypot(dx, dy), sp = Math.min(f.vmax, d * 3.2);
    swim(f, dt, d > 0.5 ? (dx / d) * sp : 0, d > 0.5 ? (dy / d) * sp : 0, null, near && d < 14);
  }

  // ---------- Рисунок ----------
  const { R } = AK;
  const qx = new Float32Array(N), qy = new Float32Array(N), nx = new Float32Array(N), ny = new Float32Array(N);
  const hw = new Float32Array(N), lit = new Float32Array(N * 2);
  let fx = 0, fy = 0, fnx = 0, fny = 0, ftx = 0, fty = 0, fw = 0;
  // Точка тела на доле длины s и доле полуширины v (+ — к боку n): fx, fy; там же касательная и нормаль
  function at(s, v) {
    const u = clamp(s, 0, 1) * (N - 1), i = Math.min(u | 0, N - 2), k = u - i;
    ftx = lerp(ny[i], ny[i + 1], k); fty = lerp(-nx[i], -nx[i + 1], k);
    const l = Math.hypot(ftx, fty) || 1;
    ftx /= l; fty /= l; fnx = -fty; fny = ftx;
    fw = lerp(hw[i], hw[i + 1], k);
    fx = lerp(qx[i], qx[i + 1], k) + fnx * fw * v; fy = lerp(qy[i], qy[i + 1], k) + fny * fw * v;
  }
  function prep(f) {
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      qx[i] = f.q[i * 2]; qy[i] = f.q[i * 2 + 1];
      nx[i] = -f.tn[i * 2 + 1]; ny[i] = f.tn[i * 2];
      // на вдохе жабры чуть расходятся
      hw[i] = WID[i] * (1 + 0.04 * Math.sin(f.br) * Math.exp(-(((s - 0.22) / 0.08) ** 2)));
      for (const sg of [1, -1]) lit[i * 2 + (sg > 0 ? 0 : 1)] = 0.85 + 0.3 * Math.max(0, sg * (nx[i] * LX + ny[i] * LY));
    }
  }
  const col = (c, k = 1, a = c.length > 3 ? c[3] : 1, add = 0) => R.color(c[0] * k, c[1] * k, c[2] * k, a, add);
  const col2 = (c, k = 1, a = c.length > 3 ? c[3] : 1) => R.color2(c[0] * k, c[1] * k, c[2] * k, a);

  // Силуэт тела текущим цветом (для свечения и плёнки воды)
  function bodyShape() {
    for (let i = 0; i < N - 1; i++) {
      R.quad(qx[i] + nx[i] * hw[i], qy[i] + ny[i] * hw[i], qx[i + 1] + nx[i + 1] * hw[i + 1], qy[i + 1] + ny[i + 1] * hw[i + 1],
        qx[i + 1] - nx[i + 1] * hw[i + 1], qy[i + 1] - ny[i + 1] * hw[i + 1], qx[i] - nx[i] * hw[i], qy[i] - ny[i] * hw[i]);
    }
    const tx = ny[0], ty = -nx[0];
    let px = qx[0] + nx[0] * hw[0], py = qy[0] + ny[0] * hw[0];
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * Math.PI, c = Math.cos(a), s = Math.sin(a);
      const ex = qx[0] + (nx[0] * c + tx * s) * hw[0], ey = qy[0] + (ny[0] * c + ty * s) * hw[0];
      R.tri(qx[0], qy[0], px, py, ex, ey);
      px = ex; py = ey;
    }
  }

  // Плавник-веер: из корня (x, y) лучи под углами a0…a1 (рад, на поле) длиной len…len·k1; каждый луч гнётся
  // на lag к концу и трепещет; перепонка — от col0 у корня к col1 на краю
  const RAY = new Float32Array(16 * 4);
  function fan(x, y, a0, a1, n, len, k1, lag, fl, ph, col0, col1) {
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1), a = lerp(a0, a1, u), l = len * lerp(1, k1, u);
      const w = fl * Math.sin(ph - u * 2.2);
      const am = a + lag * 0.45 + w * 0.3, at = a + lag + w;
      RAY[j * 4] = x + Math.cos(am) * l * 0.5; RAY[j * 4 + 1] = y + Math.sin(am) * l * 0.5;
      RAY[j * 4 + 2] = RAY[j * 4] + Math.cos(at) * l * 0.5; RAY[j * 4 + 3] = RAY[j * 4 + 1] + Math.sin(at) * l * 0.5;
    }
    const cm = [lerp(col0[0], col1[0], 0.5), lerp(col0[1], col1[1], 0.5), lerp(col0[2], col1[2], 0.5), lerp(col0[3], col1[3], 0.5)];
    for (let j = 0; j < n - 1; j++) {
      const m0 = j * 4, m1 = m0 + 4;
      R.color(col0[0], col0[1], col0[2], col0[3]); R.color2(cm[0], cm[1], cm[2], cm[3]);
      R.quadG(x, y, x, y, RAY[m1], RAY[m1 + 1], RAY[m0], RAY[m0 + 1]);
      R.color(cm[0], cm[1], cm[2], cm[3]); R.color2(col1[0], col1[1], col1[2], col1[3]);
      R.quadG(RAY[m0], RAY[m0 + 1], RAY[m1], RAY[m1 + 1], RAY[m1 + 2], RAY[m1 + 3], RAY[m0 + 2], RAY[m0 + 3]);
    }
    // лучи и тонкая светлая кромка
    col(PAL.ray, 1, 0.35 * col0[3]);
    for (let j = 0; j < n; j++) {
      R.line(x, y, RAY[j * 4], RAY[j * 4 + 1], 0.7);
      R.line(RAY[j * 4], RAY[j * 4 + 1], RAY[j * 4 + 2], RAY[j * 4 + 3], 0.5);
    }
    col(PAL.rim, 1, 0.3);
    for (let j = 0; j < n - 1; j++) R.line(RAY[j * 4 + 2], RAY[j * 4 + 3], RAY[j * 4 + 6], RAY[j * 4 + 7], 0.7);
  }

  function tail(f, r) {
    const i = N - 1, x = qx[i], y = qy[i], b = Math.atan2(-f.tn[i * 2 + 1], -f.tn[i * 2]);
    const lag = wrap(f.tf - b), spread = lerp(1, 0.55, U.smooth(clamp(r / 0.5, 0, 1))) * (1 + 0.05 * Math.sin(f.t * 2));
    const fl = 0.07 + 0.1 * Math.min(f.amp / 4, 1);
    for (const sg of [1, -1]) {
      // лопасть — веер от середины (короткие лучи у выемки) к краю
      fan(x, y, b, b + sg * spread, 6, TAIL * 0.72, 1.35, lag, fl * sg, f.ph * 0.9 - 1, PAL.tail0, PAL.tail1);
    }
  }

  function fins(f, r) {
    // грудные — за жаберными крышками, брюшные — посередине; корень прячется под телом
    for (const sg of [1, -1]) {
      at(0.25, sg * 0.8);
      const b = Math.atan2(-fty, -ftx), o = sg > 0 ? f.pecR : f.pecL, lag = -f.om * 0.02;
      fan(fx, fy, b - sg * o * 0.75, b - sg * (o * 0.75 + 0.55), 4, 10.5, 0.85, lag, 0.06 * sg, f.t * 9, PAL.fin0, PAL.fin1);
      at(0.53, sg * 0.75);
      const o2 = 0.3 + 0.25 * (1 - Math.min(r / 0.3, 1));
      fan(fx, fy, b - sg * o2, b - sg * (o2 + 0.35), 3, 7, 0.8, lag, 0.05 * sg, f.t * 7, PAL.fin0, PAL.fin1);
    }
  }

  function body(f) {
    for (let i = 0; i < N - 1; i++) {
      const t = i / (N - 2), tone = lerp(1.05, 0.92, t); // к хвосту чуть краснее и темнее
      for (const sg of [1, -1]) {
        const k = lit[i * 2 + (sg > 0 ? 0 : 1)] * tone;
        const m0x = qx[i] + nx[i] * hw[i] * 0.55 * sg, m0y = qy[i] + ny[i] * hw[i] * 0.55 * sg;
        const m1x = qx[i + 1] + nx[i + 1] * hw[i + 1] * 0.55 * sg, m1y = qy[i + 1] + ny[i + 1] * hw[i + 1] * 0.55 * sg;
        col(PAL.back, k); col2(PAL.flank, k);
        R.quadG(qx[i], qy[i], qx[i + 1], qy[i + 1], m1x, m1y, m0x, m0y);
        col(PAL.flank, k); col2(PAL.edge, k);
        R.quadG(m0x, m0y, m1x, m1y, qx[i + 1] + nx[i + 1] * hw[i + 1] * sg, qy[i + 1] + ny[i + 1] * hw[i + 1] * sg,
          qx[i] + nx[i] * hw[i] * sg, qy[i] + ny[i] * hw[i] * sg);
      }
    }
    // нос — полукруг
    const tx = ny[0], ty = -nx[0], k0 = lit[0] * 1.05;
    let px = qx[0] + nx[0] * hw[0], py = qy[0] + ny[0] * hw[0];
    col(PAL.back, k0); col2(PAL.edge, k0 * 1.1);
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * Math.PI, c = Math.cos(a), s = Math.sin(a);
      const ex = qx[0] + (nx[0] * c + tx * s) * hw[0], ey = qy[0] + (ny[0] * c + ty * s) * hw[0];
      R.quadG(qx[0], qy[0], qx[0], qy[0], ex, ey, px, py);
      px = ex; py = ey;
    }
  }

  // Чешуя; каждая чешуйка наклонена по-своему и вспыхивает радугой — чешуя отражает свет тонкими плёнками, и цвет
  // отлива зависит от угла к свету, — когда тело изгибается; по спине бегут блики ряби с поверхности
  const FILM = [0, 0, 0];
  function scales(f) {
    for (let n = 0; n < SCALES.length; n++) {
      const sc = SCALES[n], j = f.jit[n];
      at(sc.s, sc.v);
      const r = Math.max(1.4, fw * 0.36), av = Math.abs(sc.v);
      const side = lit[Math.round(sc.s * (N - 1)) * 2 + (sc.v >= 0 ? 0 : 1)];
      const k = side * j[2] * lerp(1.04, 0.9, sc.s);
      const c = av < 0.15 ? PAL.back : av < 0.45 ? PAL.scMid : PAL.scSide;
      // чешуйка выпуклая: нормаль наклонена к боку, плюс свой случайный наклон
      const tilt = sc.v * 0.85;
      let Nx = fnx * tilt + ftx * j[0] + fnx * j[1], Ny = fny * tilt + fty * j[0] + fny * j[1];
      const Nz = Math.sqrt(Math.max(0.05, 1 - Nx * Nx - Ny * Ny));
      const hm = Math.max(0, Nx * HX + Ny * HY + Nz * HZ), spec = Math.pow(hm, 28);
      // тёмный задний край, светлое тело чешуйки чуть ближе к голове, металлический отлив
      col(c, k * lerp(0.82, 0.68, f.gold)); R.disc(fx, fy, r); // у серебристой край чешуйки мягче
      col(c, k); R.disc(fx + ftx * r * 0.24, fy + fty * r * 0.24, r * 0.82);
      const gl = Math.pow(hm, 8) * lerp(1.1, 0.5, f.gold) * (0.35 + 0.9 * U.caustic(fx, fy, f.t));
      if (gl > 0.02) {
        U.film(j[3] + 3 * (1 - hm) + 0.5 * sc.v + 0.8 * sc.s, FILM);
        const sp = PAL.spec, w = lerp(0.12, 0.5, f.gold); // радуга, разбавленная светом блика (у золотой — тёплым)
        R.color(lerp(FILM[0], sp[0], w), lerp(FILM[1], sp[1], w), lerp(FILM[2], sp[2], w), Math.min(gl, 1), 1);
        R.disc(fx + ftx * r * 0.2, fy + fty * r * 0.2, r * 0.68);
      }
      if (spec > 0.02) {
        const sp = PAL.spec, pk = (1 - f.gold) * (j[1] + 0.15) * 3; // у серебристой — перламутр
        R.color(lerp(sp[0], PEARL[0], pk), lerp(sp[1], PEARL[1], pk), lerp(sp[2], PEARL[2], pk), Math.min(spec, 1) * 0.6, 1);
        R.disc(fx + ftx * r * 0.3, fy + fty * r * 0.3, r * 0.55);
      }
    }
  }

  function head(f) {
    // лоб ловит свет сверху
    at(0.1, 0);
    col(PAL.brow, 1, 0.22, 1); R.soft(fx + LX * 2, fy + LY * 2, 8);
    // жаберные крышки: дуга выпуклостью к хвосту, светлая кромка за ней; на вдохе и при глотке расходятся
    const fl = 0.04 * (0.5 + 0.5 * Math.sin(f.br)) + 0.06 * f.gill;
    for (const sg of [1, -1]) {
      let px = 0, py = 0;
      for (let k = 0; k <= 4; k++) {
        const u = k / 4, s = 0.205 + 0.06 * Math.sin(u * Math.PI) + fl * u, v = sg * lerp(0.3, 1, u);
        at(s, v);
        if (k) {
          col(PAL.gill, 1, 0.55); R.line(px, py, fx, fy, 0.9);
          col(PAL.gillHi, 1, 0.25, 1); R.line(px - ftx * 0.9, py - fty * 0.9, fx - ftx * 0.9, fy - fty * 0.9, 0.7);
        }
        px = fx; py = fy;
      }
    }
    // ноздри
    col(PAL.nostril, 1, 0.8);
    for (const sg of [1, -1]) { at(0.055, sg * 0.42); R.disc(fx, fy, 0.75); }
    // глаза навыкате: глазница, золотая радужка, зрачок, блик
    for (const sg of [1, -1]) {
      at(0.14, sg * 0.84);
      col(PAL.socket); R.disc(fx, fy, 2.9);
      col(PAL.iris); R.disc(fx, fy, 2.3);
      R.color(0.03, 0.03, 0.05, 1); R.disc(fx + ftx * 0.35 + fnx * sg * 0.25, fy + fty * 0.35 + fny * sg * 0.25, 1.55);
      R.color(1, 1, 1, 0.95); R.disc(fx + LX * 0.95, fy + LY * 0.95, 0.6);
      R.color(1, 1, 1, 0.22, 1); R.ring(fx, fy, 2.9, 0.18);
    }
    // рот на кончике носа всё время дышит; глотая и плюя, раскрывается
    const m = Math.max(f.mouth, 0.18 + 0.14 * Math.sin(f.br));
    const tx = ny[0], ty = -nx[0], mx = qx[0] + tx * hw[0] * 0.8, my = qy[0] + ty * hw[0] * 0.8;
    col(PAL.lip); R.disc(mx, my, 1.7 + 1.5 * m);
    col(PAL.throat); R.disc(mx + tx * 0.4, my + ty * 0.4, 0.5 + 2.2 * m);
  }

  // Спинной плавник сверху виден ребром — тонкой перепонкой вдоль спины; на поворотах и с волной кренится
  function dorsal(f) {
    let bx0 = 0, by0 = 0, tx0 = 0, ty0 = 0;
    for (let k = 0; k <= 6; k++) {
      const u = k / 6, s = lerp(0.32, 0.66, u);
      at(s, 0);
      const h = 7 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7) + 0.5;
      const ln = clamp(f.lean + 0.3 * Math.sin(f.ph - 5.3 * s - 0.6) * Math.min(f.amp / 4, 1), -0.7, 0.7);
      const tx = fx + fnx * h * Math.sin(ln) - ftx * h * 0.35, ty = fy + fny * h * Math.sin(ln) - fty * h * 0.35;
      if (k) {
        col(PAL.dors0); col2(PAL.dors1);
        R.quadG(bx0, by0, fx, fy, tx, ty, tx0, ty0);
        col(PAL.dorsLine, 1, 0.5); R.line(bx0, by0, fx, fy, 0.9);
      }
      bx0 = fx; by0 = fy; tx0 = tx; ty0 = ty;
    }
  }

  // Рисует рыбку; under — плёнка воды над предметом в толще (draw.js)
  proto.draw = function (under) {
    const f = this, Wt = AK.Water, g = f.gold;
    prep(f);
    palette(g);
    const r = Math.min(Math.abs(f.sp) / V, 1);
    // время на исходе — вспыхивает
    const blink = f.left > 0 && f.left < 3 ? Math.pow(0.5 + 0.5 * Math.cos(f.left * TAU * 2.5), 2) : 0;
    // тень на дне — ниже и правее (свет сверху-слева), мягкая
    R.lit(R.gi ? 1 : 0);
    for (let i = 0; i < N; i += 2) { R.color(0, 0.015, 0.025, 0.12); R.soft(qx[i] + 5, qy[i] + 12, hw[i] * 1.8); }
    const tb = Math.atan2(-f.tn[N * 2 - 1], -f.tn[N * 2 - 2]);
    for (const d of [8, 16]) { R.color(0, 0.015, 0.025, 0.06); R.soft(qx[N - 1] + Math.cos(tb) * d + 5, qy[N - 1] + Math.sin(tb) * d + 12, 10); }
    // ореол — золотая рыбка светится сама, серебристую лишь чуть подсвечивает вода
    R.lit(0);
    at(0.35, 0);
    R.color(lerp(0.5, 1, g), lerp(0.7, 0.6, g), lerp(1, 0.18, g), lerp(0.05, 0.16 + 0.25 * blink, g), 1); R.soft(fx, fy, 58);
    // превращение: золотое кольцо расходится, вспышка
    if (f.flare > 0) {
      const k = 1 - f.flare;
      R.color(1, 0.85, 0.4, 0.7 * f.flare, 1); R.ring(fx, fy, 16 + 70 * k, 0.12);
      R.color(1, 0.8, 0.35, 0.5 * f.flare, 1); R.soft(fx, fy, 30 + 30 * k);
    }
    R.lit(R.gi ? lerp(0.45, 0.2, g) : 0);
    fins(f, r);
    tail(f, r);
    body(f);
    scales(f);
    head(f);
    dorsal(f);
    R.lit(0);
    if (Wt.on) under(f.x, f.y, 160, 0.6, bodyShape);
    if (blink > 0.01) { R.color(1, 0.9, 0.6, 0.45 * blink, 1); bodyShape(); }
    if (f.flare > 0) { R.color(1, 0.9, 0.55, 0.6 * f.flare * f.flare, 1); bodyShape(); }
    // там, где хвост ударил по мячу, расходится кольцо волны и вспыхивает
    if (f.slap > 0 && f.hitAt) {
      const k = 1 - f.slap, h = f.hitAt;
      R.color(0.85, 0.95, 1, 0.5 * f.slap, 1); R.ring(h.x, h.y, 8 + 34 * U.smooth(k), 0.1);
      R.color(1, 0.85, 0.45, 0.45 * f.slap * f.slap, 1); R.soft(h.x, h.y, 22);
    }
    for (const b of f.bub) {
      const a = 1 - b.t / b.max;
      R.color(0.75, 0.92, 1, 0.45 * a, 1); R.ring(b.x, b.y, b.r, 0.3);
      R.color(1, 1, 1, 0.55 * a, 1); R.disc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.3);
    }
  };

  // Свечение для глобального освещения: силуэт золотой рыбки (серебристая не светит)
  proto.gi = function () {
    if (this.gold < 0.05) return;
    prep(this); R.color(0.9, 0.45, 0.08, this.gold); bodyShape();
  };

  AK.FishTop = Fish;
})(window.AK);
