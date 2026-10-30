'use strict';
// Рыбка живёт в воде под ракеткой всегда (game.js заводит её с новой игрой) вместе со второй, видной сверху
// (fish-top.js). Обычно она серебристая и занята своим: плавает, щиплет водоросли (seabed.js), отдыхает у дна,
// следит за мячом, глотает воздух у поверхности, а от мяча или осколка, плюхнувшегося рядом, шарахается; тонущий
// осколок обплывает. Бонус «рыбка» золотит одну из двух, наугад (та, что сверху, мяч не ловит, а отбивает
// хвостом); золотая она на FISH_T
// секунд (ещё бонус — ещё столько же, но не больше FISH_MAX; время идёт, только пока мяч в игре), и тогда она
// ловит мяч, который ракетка упустила: заранее плывёт туда, где падающий мяч пересечёт её дорожку, втягивает
// его ртом, отплывает из-под ракетки, задирает нос к кирпичам и выплёвывает мяч вверх (b.rise: мяч проходит
// ракетку снизу насквозь), а сама от отдачи сдаёт назад. Пока мяч у неё во рту, его нет в G.balls.
// Время на исходе — вспыхивает, вышло — доплёвывает мяч и снова становится серебристой.
//
// Движение. Вода видна сбоку, и рыбка в ней — тоже. Нос ведёт рулёжка: в какую сторону смотреть (рысканье),
// насколько задрать или опустить нос (тангаж — не круче PUP и PDN, на спину рыбка не ложится) и скорость. Чтобы
// развернуться, рыбка поворачивается мордой к нам или от нас: тело на миг укорачивается, видно обе стороны головы.
// Чуть выше или ниже она подправляется плавниками, без наклона; цель чуть позади достаёт задним ходом. Позвоночник
// из N позвонков идёт за носом след в след в пространстве; сгиб в суставе ограничен и сам распрямляется (сгиб от
// разворота — быстро: рыбка поворачивается всем телом). Поверх — плавательная волна: бежит от головы к хвосту,
// растёт к хвосту, частота и размах — от скорости, разгона и поворота; тело извивается, раздвоенный хвост машет
// с запаздыванием. Плавники гнутся и трепещут по краю; грудные на ходу прижаты, на месте гребут попеременно,
// на торможении и поворотах раскрываются.
// Рот всё время дышит, жаберные крышки ходят, глаз следит за мячом.
//
// Рисунок — золотая рыбка сбоку: высокое тело с выгнутой спиной и круглым брюхом, тупое рыло с ртом на конце,
// большой глаз с золотой радужкой, жаберная крышка, крупная чешуя сеточкой, высокий спинной плавник, раздвоенный
// хвост, грудные, брюшные и анальный плавники с лучами. Тело объёмное: кольца вокруг позвоночника, освещённые
// сверху-слева-спереди, с бликом по спине; чешуя, глаз и жабры лежат на этой поверхности и поворачиваются вместе
// с ней. Окраска плавно перетекает из серебра (с перламутром) в золото.
(function (AK) {
  const { U } = AK;
  const { clamp, TAU, lerp } = U;
  const W = 720, H = 960, L = 16, RX = 704;
  const FISH_T = 25, FISH_MAX = 50;   // с
  const DEPTH = 34;                   // px: дорожка рыбки — ниже ракетки на столько
  const N = 13, SEG = 4.6;            // позвонков и px между ними
  const BL = SEG * (N - 1);           // px: тело от рыла до хвостового стебля
  const BEND = 0.42;                  // рад: предельный сгиб в суставе
  const STRAIGHT = 2.5;               // 1/с: как быстро тело само распрямляется
  const YAW_STRAIGHT = 9;             // 1/с: и ещё на столько — сгиб вбок, от разворота
  const V = 760, ACC = 4200, BRAKE = 7000; // px/s, px/s²: предел скорости, разгон, торможение
  const TURN = 16;                    // рад/с: предел угловой скорости (наклона)
  const YAW = 20;                     // рад/с: разворота
  const PUP = 1, PDN = -0.9;          // рад: нос вверх и вниз — не круче (длинная рыбка не уходит хвостом за край)
  const AIM_P = 0.8;                  // рад: целясь, задирает нос на столько и плюёт мячом вверх, куда метит
  const FIN = 45;                     // px/s: вверх-вниз плавниками, без наклона
  const ARRIVE = 8;                   // 1/с: на подходе к цели скорость — расстояние·ARRIVE
  const BACK = 90, BACK_REACH = 26;   // px/s, px: задним ходом — не быстрее и не дальше
  const CHEW = 0.3, HOLD = 1.4;       // с: мяч во рту — не меньше (и не дольше — тогда плюёт, куда смотрит)
  const AIM = 0.12, AIM_MAX = 0.45;   // с: целится носом хотя бы столько, но не дольше
  const MARGIN = 24;                  // px: на столько ниже кромки воды держится без дела (нос — до 4 px)
  const SPLASH_R = 150, SINK_R = 34;  // px: осколок, упавший в воду ближе, пугает; тонущий ещё ближе — обплывает
  // свет — сверху-слева (как в draw.js) и чуть спереди; блик — по полувектору между светом и взглядом
  const LN = Math.hypot(0.4, 0.8, 0.45), LX = -0.4 / LN, LY = -0.8 / LN, LZ = 0.45 / LN;
  const HN = Math.hypot(LX, LY, LZ + 1), HX = LX / HN, HY = LY / HN, HZ = (LZ + 1) / HN;
  // Профиль тела по доле длины u (от кончика рыла −0.05 до хвостового стебля 1): высота спины над осью,
  // глубина брюха под ней и полутолщина, px
  const KU = [-0.05, -0.035, -0.01, 0.03, 0.08, 0.15, 0.24, 0.34, 0.44, 0.54, 0.64, 0.74, 0.84, 0.92, 1];
  const KT = [0, 3.1, 5.1, 6.8, 8.5, 10.3, 11.7, 12.5, 12.6, 12, 10.6, 8.6, 6.3, 4.9, 4.3];
  const KB = [0, 2.9, 4.8, 6.5, 8.5, 10.7, 12.5, 13.6, 13.9, 13.1, 11.2, 8.8, 6.2, 4.7, 4.1];
  const KW = [0, 1.9, 3.1, 4.1, 5, 5.9, 6.6, 7, 7, 6.6, 5.7, 4.6, 3.4, 2.6, 2.1];
  // Окраска: золотая (с бонусом) и серебристая; в кадре — смесь по f.gold. back, flank, belly — спина, бок, брюхо;
  // rim — край чешуйки; плавники: от корня (…0) к краю (…1), с прозрачностью
  const GOLD = {
    back: [0.8, 0.24, 0.03], flank: [1, 0.48, 0.08], belly: [1, 0.76, 0.38], spec: [1, 0.93, 0.72],
    fin0: [1, 0.42, 0.06, 0.82], fin1: [1, 0.68, 0.36, 0.22], tail0: [1, 0.4, 0.05, 0.85], tail1: [1, 0.7, 0.42, 0.2],
    ray: [0.72, 0.22, 0.03], edgeHi: [1, 0.86, 0.6], gill: [0.5, 0.11, 0.02], gillHi: [1, 0.78, 0.48],
    socket: [0.3, 0.08, 0.02], iris: [1, 0.8, 0.3], irisRim: [0.62, 0.3, 0.05], lip: [1, 0.62, 0.36],
    throat: [0.24, 0.03, 0.02], nostril: [0.36, 0.08, 0.02],
  };
  const SILVER = {
    back: [0.34, 0.42, 0.53], flank: [0.7, 0.77, 0.86], belly: [0.9, 0.93, 0.97], spec: [0.88, 0.96, 1],
    fin0: [0.6, 0.7, 0.84, 0.6], fin1: [0.88, 0.94, 1, 0.14], tail0: [0.6, 0.7, 0.85, 0.62], tail1: [0.88, 0.94, 1, 0.14],
    ray: [0.3, 0.4, 0.54], edgeHi: [0.86, 0.93, 1], gill: [0.16, 0.2, 0.28], gillHi: [0.82, 0.9, 1],
    socket: [0.12, 0.15, 0.2], iris: [0.9, 0.76, 0.42], irisRim: [0.4, 0.34, 0.2], lip: [0.86, 0.74, 0.78],
    throat: [0.16, 0.05, 0.08], nostril: [0.14, 0.17, 0.23],
  };
  const PEARL = [1, 0.82, 0.95]; // перламутр: блики серебристой чешуи отливают розовым
  const PAL = {};
  for (const k in GOLD) PAL[k] = GOLD[k].slice();
  function palette(g) {
    for (const k in GOLD) for (let i = 0; i < GOLD[k].length; i++) PAL[k][i] = lerp(SILVER[k][i], GOLD[k][i], g);
  }
  const wrap = a => a - TAU * Math.round(a / TAU);
  const rand = (a, b) => a + Math.random() * (b - a);
  const lane = G => Math.min(G.paddle.y + DEPTH, H - 22);
  // Вода без дела: от кромки (ниже на MARGIN) до дна; когда воды нет (уровень пройден, вода ушла) — за нижний край
  const BOT = H - 20;
  const surf = (G, x) => (AK.Water.on ? AK.Water.shoreAt(x) : G.paddle.y - 10);
  const dry = (G, x) => surf(G, x) > BOT - 24;

  // Профиль на доле длины u: pt, pb, pw (сплайн по узлам)
  let pt = 0, pb = 0, pw = 0;
  const cr = (K, i, t) => {
    const a = K[Math.max(i - 1, 0)], b = K[i], c = K[i + 1], d = K[Math.min(i + 2, K.length - 1)];
    return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  };
  function shape(u) {
    u = clamp(u, KU[0], 1);
    let i = 0;
    while (i < KU.length - 2 && u > KU[i + 1]) i++;
    const t = (u - KU[i]) / (KU[i + 1] - KU[i]);
    pt = Math.max(0, cr(KT, i, t)); pb = Math.max(0, cr(KB, i, t)); pw = Math.max(0, cr(KW, i, t));
  }
  // полувысота тела у позвонков — по ней мяч задевает рыбку
  const HR = [];
  for (let i = 0; i < N; i++) { shape(i / (N - 1)); HR.push((pt + pb) / 2); }

  // Чешуя: ряды вдоль тела на высотах v (1 — спина, −1 — брюхо) с шагом SV, в ряду — через SU по длине; соседние
  // ряды сдвинуты на полчешуйки, и тёмные края складываются в сеточку. От хвоста к голове, чтобы передние
  // чешуйки ложились на задние.
  const SU = 0.06, SV = 0.2, SCALES = [];
  for (let c = 0; c < 22; c++) {
    const u = 0.92 - c * SU * 0.5;
    for (let r = -4; r <= 4; r++) if ((r + c) % 2 === 0 && u >= 0.27) SCALES.push({ u, v: r * SV });
  }

  const Fish = {};
  const proto = {};

  Fish.spawn = function (G, api) {
    const f = Object.create(proto);
    const x = rand(L + 80, RX - 80), y = (Math.min(surf(G, x) + MARGIN, BOT) + BOT) / 2, yaw = Math.random() < 0.5 ? 0 : Math.PI;
    Object.assign(f, {
      G, api, left: 0, gold: 0, flare: 0, x, y, z: 0, yaw, yg: yaw, pitch: 0, pg: 0, oy: 0, op: 0,
      dx: 1, dy: 0, dz: 0, ang: 0, sp: 0, acc: 0, vx: 0, vy: 0,
      t: 0, ph: 0, amp: 1, br: 0, hold: null, chew: 0, aim: null, aimT: 0, spitT: 0, suck: null, saves: 0,
      mouth: 0, gill: 0, full: 0, lean: 0, tg: 0, offT: 0, pecL: 0.3, pecR: 0.3, fold: 0, lookX: x, lookY: y, bub: [],
      jolt: 0, seen: new WeakSet(), // испуг (1 — только что вздрогнула) и осколки, которых уже пугалась
      mode: null, last: '', modeT: 0, goal: { x, y }, vmax: 0, scare: 0, peck: 0, peckPh: 0, nib: null,
      p: new Float32Array(N * 3),   // позвоночник в пространстве: x, y — на экране, z — к нам
      q3: new Float32Array(N * 3),  // он же с плавательной волной — так рыбка и рисуется
      fr: new Float32Array(N * 9),  // рамки вдоль q3: T — к рылу, U — к спине, S — вбок
      q: new Float32Array(N * 2),   // q3 на экране: по нему рыбку чувствуют водоросли
      // у каждой чешуйки свой наклон вдоль тела, тон, оттенок перелива и наклон поперёк
      jit: SCALES.map(() => [rand(-0.15, 0.15), rand(0.92, 1.08), rand(-0.12, 0.12), rand(-0.2, 0.2)]),
    });
    dir(f);
    for (let i = 0; i < N; i++) { f.p[i * 3] = x - f.dx * SEG * i; f.p[i * 3 + 1] = y; f.p[i * 3 + 2] = 0; }
    pose(f, 0);
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
  // Новый уровень: мяч во рту пропадает (подаётся новый)
  proto.reset = function () { this.hold = null; this.aim = null; this.suck = null; };

  // Куда плыть носом: туда, где раньше всех падающий мяч пересечёт дорожку (с отскоками от стен);
  // если никто не падает — держится под самым нижним мячом, лениво прохаживаясь
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

  // Мяч, падающий на голову или переднюю половину тела, рыбка втягивает ртом
  function catchBall(f) {
    const G = f.G, q = f.q, mx = f.x + f.dx * 3, my = f.y + f.dy * 3;
    for (let i = 0; i < G.balls.length; i++) {
      const b = G.balls[i];
      if (b.stuck || b.vy <= 0) continue;
      let hit = Math.hypot(b.x - mx, b.y - my) < 16 + b.r;
      for (let j = 1; !hit && j <= 7; j++) hit = Math.hypot(b.x - q[j * 2], b.y - q[j * 2 + 1]) < HR[j] * 0.85 + b.r + 3;
      if (!hit) continue;
      G.balls.splice(i, 1);
      f.hold = b; f.chew = 0; f.mouth = 1; f.gill = 1; f.aim = null; f.aimT = 0;
      f.suck = { x: b.x, y: b.y, t: 0, r: b.r };
      b.vx = b.vy = 0; b.trail.length = 0;
      f.api.sfx('gulp', f.api.pan(f.x));
      bubbles(f, 6, mx, my);
      return;
    }
  }

  // Куда целиться носом: вверх, с поправкой к середине поля и разбросом
  const aimAt = f => -Math.PI / 2 + clamp(((W / 2 - f.x) / (W / 2)) * 0.35 + rand(-0.2, 0.2), -0.5, 0.5);

  function spit(f) {
    const b = f.hold, a = f.aim !== null ? f.aim : clamp(wrap(f.ang + Math.PI / 2), -0.5, 0.5) - Math.PI / 2; // куда метит, вверх
    f.hold = null; f.aim = null; f.suck = null; f.spitT = 0.35; f.mouth = 1; f.gill = 1; f.saves++;
    f.sp = -110; // отдача
    const sp = f.api.targetSpeed(), mx = f.x + f.dx * 4, my = f.y + f.dy * 4;
    b.x = clamp(mx + Math.cos(a) * (b.r + 2), L + b.r, RX - b.r); b.y = my + Math.sin(a) * (b.r + 2);
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.w = 0; b.rise = true; b.trail.length = 0;
    f.G.balls.push(b);
    f.api.sfx('spit', f.api.pan(f.x));
    bubbles(f, 8, mx, my);
    f.api.sparks(b.x, b.y, 8, [1, 0.8, 0.35], 220, Math.cos(a), Math.sin(a), 0.8);
  }

  // Куда смотрит нос (единичный вектор; z — к нам) и куда это на экране
  function dir(f) {
    const cp = Math.cos(f.pitch);
    f.dx = cp * Math.cos(f.yaw); f.dy = -Math.sin(f.pitch); f.dz = cp * Math.sin(f.yaw);
    f.ang = Math.atan2(f.dy, f.dx);
  }
  // Повернуться мордой в сторону sg (1 — вправо, −1 — влево) кратчайшим путём — через «мордой к нам» или «от нас»;
  // передумала посреди разворота — докручивает обратно
  function turnTo(f, sg) {
    const base = sg > 0 ? 0 : Math.PI, a = base + Math.floor((f.yaw - base) / TAU) * TAU, b = a + TAU;
    const da = f.yaw - a, db = b - f.yaw;
    f.yg = Math.abs(da - db) < 1e-3 ? (Math.random() < 0.5 ? a : b) : da < db ? a : b;
  }

  // Рулёжка носа: желаемая скорость (dvx, dvy), а если задан курс head — поворот носом туда на месте; near —
  // цель рядом, и если она позади, рыбка сдаёт назад грудными плавниками, а не разворачивается
  function swim(f, dt, dvx, dvy, head, near) {
    let spd, wx = dvx, wy = dvy, fin = 0, back = false;
    if (head !== null) { wx = Math.cos(head); wy = Math.sin(head); spd = 50; }
    else {
      fin = clamp(dvy, -FIN, FIN); wy = dvy - fin;
      spd = Math.hypot(wx, wy);
      const fwd = wx * f.dx + wy * f.dy;
      if (fwd < 0 && near && Math.abs(f.dx) > 0.7) { spd = Math.max(fwd, -BACK); back = true; }
    }
    let pg = 0;
    if (!back && (head !== null || spd > 20)) {
      const h = Math.hypot(wx, wy) || 1;
      if ((wx / h) * Math.cos(f.yg) < (head !== null ? -0.05 : -0.2)) turnTo(f, wx);
      pg = clamp(Math.atan2(-wy, Math.abs(wx) + (head !== null ? 0 : 40)), PDN, f.hold ? AIM_P : PUP);
    }
    f.pg = pg;
    f.oy += (clamp((f.yg - f.yaw) * 18, -YAW, YAW) - f.oy) * (1 - Math.exp(-dt * 30));
    f.yaw += f.oy * dt;
    f.op += (clamp((pg - f.pitch) * 12, -TURN * 0.6, TURN * 0.6) - f.op) * (1 - Math.exp(-dt * 30));
    f.pitch = clamp(f.pitch + f.op * dt, PDN, PUP);
    if (Math.abs(f.yg) > 20) { const k = Math.round(f.yg / TAU) * TAU; f.yg -= k; f.yaw -= k; }
    dir(f);
    // пока нос не туда — притормаживает
    const c = f.dx * Math.cos(pg) * Math.cos(f.yg) - f.dy * Math.sin(pg) + f.dz * Math.cos(pg) * Math.sin(f.yg);
    const goal = back ? spd : spd * clamp(c, 0.08, 1);
    const sp0 = f.sp;
    if (f.spitT > 0.12) f.sp *= Math.exp(-dt * 6); // отдача после плевка — вода гасит её плавно
    else f.sp += clamp(goal - f.sp, -BRAKE * dt, ACC * dt);
    f.acc = (f.sp - sp0) / dt;
    f.vx = f.dx * f.sp; f.vy = f.dy * f.sp + fin;
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.dz * f.sp * dt;
  }

  // Позвоночник: череп жёсткий, дальше — след в след за носом; потом тело собирается заново от черепа, и каждый
  // сгиб сам распрямляется и не круче BEND (сгибы меряются до сборки — иначе распрямление одного сустава
  // перетекало бы в следующий, и тело, свернувшись на месте, так и стояло бы дугой)
  const DIR = new Float32Array(N * 3);
  function follow(f, dt) {
    const p = f.p, u0x = f.fr[3], u0y = f.fr[4], u0z = f.fr[5];
    p[0] = f.x; p[1] = f.y; p[2] = f.z;
    p[3] = f.x - f.dx * SEG; p[4] = f.y - f.dy * SEG; p[5] = f.z - f.dz * SEG;
    DIR[3] = -f.dx; DIR[4] = -f.dy; DIR[5] = -f.dz;
    for (let i = 2; i < N; i++) {
      const o = i * 3;
      let ex = p[o] - p[o - 3], ey = p[o + 1] - p[o - 2], ez = p[o + 2] - p[o - 1];
      const l = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
      ex /= l; ey /= l; ez /= l;
      DIR[o] = ex; DIR[o + 1] = ey; DIR[o + 2] = ez;
      p[o] = p[o - 3] + ex * SEG; p[o + 1] = p[o - 2] + ey * SEG; p[o + 2] = p[o - 1] + ez * SEG;
    }
    let ox = DIR[3], oy = DIR[4], oz = DIR[5], nx = ox, ny = oy, nz = oz;
    for (let i = 2; i < N; i++) {
      const o = i * 3, ex = DIR[o], ey = DIR[o + 1], ez = DIR[o + 2];
      let kx = oy * ez - oz * ey, ky = oz * ex - ox * ez, kz = ox * ey - oy * ex;
      const s = Math.sqrt(kx * kx + ky * ky + kz * kz);
      if (s > 1e-7) {
        // повернуть новое направление предыдущего позвонка вокруг оси сгиба на уменьшенный угол; сгиб вбок
        // (от разворота мордой к нам) распрямляется быстро — рыбка поворачивается всем телом, а не сворачивается
        kx /= s; ky /= s; kz /= s;
        const relax = Math.exp(-dt * (STRAIGHT + YAW_STRAIGHT * Math.abs(kx * u0x + ky * u0y + kz * u0z)));
        const a = Math.min(Math.atan2(s, ox * ex + oy * ey + oz * ez) * relax, BEND), ca = Math.cos(a), sa = Math.sin(a);
        const kv = (kx * nx + ky * ny + kz * nz) * (1 - ca);
        const rx = nx * ca + (ky * nz - kz * ny) * sa + kx * kv, ry = ny * ca + (kz * nx - kx * nz) * sa + ky * kv;
        const rz = nz * ca + (kx * ny - ky * nx) * sa + kz * kv, rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        nx = rx / rl; ny = ry / rl; nz = rz / rl;
      }
      p[o] = p[o - 3] + nx * SEG; p[o + 1] = p[o - 2] + ny * SEG; p[o + 2] = p[o - 1] + nz * SEG;
      ox = ex; oy = ey; oz = ez;
    }
  }

  // Рамки вдоль позвоночника P в Fr: T — к рылу, U — к спине, S = U×T — вбок. У головы — по курсу и крену,
  // дальше U переносится от позвонка к позвонку без закрутки
  function frames(f, P, Fr) {
    const cl = Math.cos(f.lean), sl = Math.sin(f.lean);
    let tx = f.dx, ty = f.dy, tz = f.dz;
    const s0x = -Math.sin(f.yaw), s0z = Math.cos(f.yaw);   // вбок — по горизонтали
    let ux = ty * s0z, uy = tz * s0x - tx * s0z, uz = -ty * s0x; // T × S
    let ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let sx = s0x * cl - ux * sl, sy = -uy * sl, sz = s0z * cl - uz * sl;
    ux = ux * cl + s0x * sl; uy = uy * cl; uz = uz * cl + s0z * sl;
    Fr[0] = tx; Fr[1] = ty; Fr[2] = tz; Fr[3] = ux; Fr[4] = uy; Fr[5] = uz; Fr[6] = sx; Fr[7] = sy; Fr[8] = sz;
    for (let i = 1; i < N; i++) {
      const a = (i - 1) * 3, b = Math.min(i + 1, N - 1) * 3;
      tx = P[a] - P[b]; ty = P[a + 1] - P[b + 1]; tz = P[a + 2] - P[b + 2];
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const d = ux * tx + uy * ty + uz * tz;
      ux -= tx * d; uy -= ty * d; uz -= tz * d;
      ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      sx = uy * tz - uz * ty; sy = uz * tx - ux * tz; sz = ux * ty - uy * tx;
      const o = i * 9;
      Fr[o] = tx; Fr[o + 1] = ty; Fr[o + 2] = tz; Fr[o + 3] = ux; Fr[o + 4] = uy; Fr[o + 5] = uz;
      Fr[o + 6] = sx; Fr[o + 7] = sy; Fr[o + 8] = sz;
    }
  }

  // Плавательная волна поверх позвоночника — в плоскости рыбки, её видно сбоку; хвост отстаёт от стебля —
  // поворачивается против того, куда стебель движется, и против наклона
  function pose(f, dt) {
    const p = f.p, q = f.q3, Fr = f.fr;
    frames(f, p, Fr);
    let last = 0;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), off = f.amp * (0.1 + 0.9 * s * s) * Math.sin(f.ph - 5.3 * s), o = i * 3, a = i * 9;
      q[o] = p[o] + Fr[a + 3] * off; q[o + 1] = p[o + 1] + Fr[a + 4] * off; q[o + 2] = p[o + 2] + Fr[a + 5] * off;
      last = off;
    }
    frames(f, q, Fr);
    for (let i = 0; i < N; i++) { f.q[i * 2] = q[i * 3]; f.q[i * 2 + 1] = q[i * 3 + 1]; }
    if (dt > 0) {
      const goal = clamp(-((last - f.offT) / dt) * 0.009 - f.op * 0.03, -0.75, 0.75);
      f.tg += (goal - f.tg) * (1 - Math.exp(-dt * 14));
    }
    f.offT = last;
  }

  // Шаг рыбки
  proto.update = function (dt) {
    const f = this, G = f.G, p = G.paddle, y0 = lane(G);
    f.t += dt;
    if (G.state === 'play') f.left = Math.max(0, f.left - dt);
    f.gold += ((f.left > 0 ? 1 : 0) - f.gold) * (1 - Math.exp(-dt * 3));
    f.flare = Math.max(0, f.flare - dt * 1.4);
    f.scare = Math.max(0, f.scare - dt);
    f.mouth = Math.max(0, f.mouth - dt * 3);
    f.gill = Math.max(0, f.gill - dt * 2.5);
    f.spitT = Math.max(0, f.spitT - dt);
    f.jolt = Math.max(0, f.jolt - dt * 3);
    // осколок плюхнулся рядом: занятая мячом рыбка только вздрагивает, остальное — в idle
    const hit = splash(f);
    if (hit && (f.hold || f.left > 0)) flinch(f, 3.5);
    f.full += ((f.hold ? 1 : 0) - f.full) * (1 - Math.exp(-dt * 12));
    if (f.suck && (f.suck.t += dt) > 0.1) f.suck = null;
    let tx = f.x, ty = y0 + Math.sin(f.t * 0.9) * 3, head = null;
    if (f.hold) {
      // отплывает из-под ракетки, чтобы мяч не вылетел сквозь неё, задирает нос вверх и плюёт
      f.chew += dt;
      const gap = p.hw + p.r + 30;
      let side = f.x >= p.x ? 1 : -1;
      if (p.x + side * (gap + 24) > RX - 30 || p.x + side * (gap + 24) < L + 30) side = -side;
      const under = Math.abs(f.x - p.x) < gap;
      if (f.aim === null) {
        if (under) tx = p.x + side * (gap + 24);
        if (f.chew >= HOLD || (f.chew >= CHEW && !under && Math.abs(f.sp) < 200)) { f.aim = aimAt(f); f.aimT = 0; }
      }
      if (f.aim !== null) {
        head = f.aim;
        f.aimT += dt;
        const ok = Math.abs(f.pitch - f.pg) < 0.08 && Math.cos(f.yaw - f.yg) > 0.99; // повернулась и задрала нос
        if ((f.aimT > AIM && ok) || f.aimT > AIM_MAX) spit(f);
      }
    } else if (f.left > 0) {
      if (f.spitT <= 0.12) tx = target(f, y0); // только что плюнула — миг стоит
      else head = f.ang;
      f.mode = null;
      catchBall(f);
    }
    if (f.hold || f.left > 0) swim(f, dt, clamp((tx - f.x) * ARRIVE, -V, V), clamp((ty - f.y) * 6, -240, 240), head, Math.abs(tx - f.x) < BACK_REACH);
    else if (f.spitT > 0.12) swim(f, dt, 0, 0, f.ang, false);
    else idle(f, dt, hit);
    keepIn(f);
    follow(f, dt);
    // волна: чаще и шире на ходу, на разгоне и на повороте; задним ходом хвост почти не работает
    const r = Math.min(Math.abs(f.sp) / V, 1);
    const thrust = f.sp < 0 ? 0.05 : clamp(r * 1.2 + Math.max(0, f.acc) / ACC * 0.6 + (Math.abs(f.oy) + Math.abs(f.op)) / TURN * 0.5 + f.jolt, 0, 1);
    f.amp += (0.7 + 4.2 * thrust - f.amp) * (1 - Math.exp(-dt * 6));
    f.ph += dt * TAU * (0.9 + 6.5 * (f.sp < 0 ? 0 : r));
    f.br += dt * TAU * 1.4;
    f.lean += (clamp(-f.oy * 0.03, -0.4, 0.4) - f.lean) * (1 - Math.exp(-dt * 8)); // кренится в поворот
    pose(f, dt);
    // грудные плавники: на ходу прижаты, на месте раскрыты и гребут попеременно, на торможении раскрыты;
    // с внутренней стороны поворота раскрываются шире
    const slow = 1 - U.smooth(clamp(r / 0.3, 0, 1));
    const brake = clamp(-f.acc / BRAKE, 0, 1), turn = clamp(f.oy / TURN, -1, 1);
    for (const sg of [1, -1]) {
      const scull = 0.3 * slow * Math.sin(f.t * TAU * 2.2 + (sg > 0 ? 0 : Math.PI));
      const goal = 0.25 + 0.9 * slow + 0.9 * brake + 0.7 * Math.max(0, turn * sg) + scull + (f.sp < 0 ? 0.3 : 0) + 1.1 * f.jolt;
      if (sg > 0) f.pecR += (goal - f.pecR) * (1 - Math.exp(-dt * 10));
      else f.pecL += (goal - f.pecL) * (1 - Math.exp(-dt * 10));
    }
    // отдыхая, складывает спинной плавник
    f.fold += ((f.mode === 'rest' ? 1 : 0) - f.fold) * (1 - Math.exp(-dt * 3));
    // глаз следит за самым нижним мячом, если тот близко или рыбка его ловит, иначе смотрит вперёд
    let lx = f.x + f.dx * 60, ly = f.y + f.dy * 60, low = null;
    for (const b of G.balls) if (!low || b.y > low.y) low = b;
    if (low && (f.left > 0 || f.mode === 'watch' || Math.hypot(low.x - f.x, low.y - f.y) < 220)) { lx = low.x; ly = low.y; }
    f.lookX += (lx - f.lookX) * (1 - Math.exp(-dt * 8)); f.lookY += (ly - f.lookY) * (1 - Math.exp(-dt * 8));
    if (f.hold) { f.hold.x = f.x; f.hold.y = f.y; }
    if (Math.random() < dt * (0.3 + 3 * r)) bubbles(f, 1, f.x - f.dx * 12, f.y - f.dy * 12 - 2);
    for (const b of f.bub) { b.t += dt; b.y -= b.vy * dt; b.x += Math.sin(b.t * 9 + b.ph) * 14 * dt; }
    f.bub = f.bub.filter(b => b.t < b.max && AK.Water.depth(b.x, b.y) > 0);
  };

  // Нос — в поле и под водой; воды нет — уходит за нижний край
  function keepIn(f) {
    const G = f.G;
    f.x = clamp(f.x, L + 10, RX - 10);
    if (dry(G, f.x)) { f.y = Math.min(f.y, H + 60); return; }
    f.y = clamp(f.y, Math.min(surf(G, f.x) + 4, BOT), H - 18);
  }

  // ---------- Без дела ----------
  // Занятия и их вес: плавает куда глаза глядят, отдыхает у дна, щиплет водоросли, следит за мячом,
  // делает рывок, глотает воздух у поверхности
  const MODES = [['cruise', 3], ['rest', 1.4], ['nibble', 2.4], ['watch', 1.4], ['dart', 1], ['gulp', 0.8]];
  const topAt = (G, x) => Math.min(surf(G, x) + MARGIN, BOT);
  // Случайная точка воды без дела: x в поле, y — от кромки до дна
  function spot(f, x = rand(L + 40, RX - 40)) { return { x, y: rand(topAt(f.G, x), BOT) }; }
  function pickMode(f) {
    const G = f.G, Wt = AK.Water, Sb = AK.Seabed;
    const ok = ([m]) => m !== f.last &&
      (m === 'nibble' ? Wt.on && Sb.fronds.length > 0 : m === 'gulp' ? Wt.on : true);
    const list = MODES.filter(ok);
    let x = Math.random() * list.reduce((a, m) => a + m[1], 0), m = list[0][0];
    for (const it of list) { x -= it[1]; if (x <= 0) { m = it[0]; break; } }
    f.mode = f.last = m;
    f.nib = null; f.peck = 0; f.peckPh = 0;
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
      case 'gulp': {
        let x = rand(L + 40, RX - 40);
        for (let i = 0; i < 4 && Math.abs(x - G.paddle.x) < G.paddle.hw + 50; i++) x = rand(L + 40, RX - 40);
        f.goal = { x, y: surf(G, x) + 4 }; f.vmax = 160; f.modeT = 5; break;
      }
    }
  }
  // Расстояние от точки до рыбки: до рыла, середины или хвостового стебля
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
    let sx = Math.abs(f.x - x) > 8 ? Math.sign(f.x - x) : f.dx >= 0 ? 1 : -1;
    if ((sx > 0 ? RX - 40 - f.x : f.x - L - 40) < 60) sx = -sx;
    const gx = clamp(f.x + sx * rand(150, 220), L + 40, RX - 40);
    f.mode = f.last = 'dart'; f.goal = { x: gx, y: clamp(f.y + clamp(f.y - y, -60, 60), topAt(f.G, gx), BOT) };
    f.vmax = v; f.modeT = 1.2; f.scare = 1.2; f.nib = null;
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
  // Кольца тела по доле длины (у рыла гуще) и точки на кольце: φ = 0 — спина, π — брюхо, π/2 — бок S
  const RU = [-0.05, -0.043, -0.032, -0.017, 0.003, 0.03, 0.062];
  for (let k = 0; k <= 20; k++) RU.push(0.1 + k * 0.045);
  const M = RU.length, J = 16, MJ = M * J;
  const CO = new Float32Array(J), SI = new Float32Array(J);
  for (let j = 0; j < J; j++) { CO[j] = Math.cos((j / J) * TAU); SI[j] = Math.sin((j / J) * TAU); }
  const VP = new Float32Array(MJ * 3), VS = new Float32Array(MJ * 2), VC = new Float32Array(MJ * 4);
  const RC = new Float32Array(M * 3), VIS = new Uint8Array(MJ);
  let gold = 0, full = 0, breath = 0, now = 0, Q = null, F = null;
  // Сечение на доле длины u: центр c, рамка t (к рылу), u (к спине), s (вбок) и профиль pt, pb, pw
  let cx = 0, cy = 0, cz = 0, tx = 1, ty = 0, tz = 0, ux = 0, uy = -1, uz = 0, sx = 0, sy = 0, sz = 1;
  function frameAt(u) {
    const w = clamp(u, 0, 1) * (N - 1), i = Math.min(w | 0, N - 2), k = w - i, a = i * 9, b = a + 9, o = i * 3;
    cx = lerp(Q[o], Q[o + 3], k); cy = lerp(Q[o + 1], Q[o + 4], k); cz = lerp(Q[o + 2], Q[o + 5], k);
    tx = lerp(F[a], F[b], k); ty = lerp(F[a + 1], F[b + 1], k); tz = lerp(F[a + 2], F[b + 2], k);
    ux = lerp(F[a + 3], F[b + 3], k); uy = lerp(F[a + 4], F[b + 4], k); uz = lerp(F[a + 5], F[b + 5], k);
    sx = lerp(F[a + 6], F[b + 6], k); sy = lerp(F[a + 7], F[b + 7], k); sz = lerp(F[a + 8], F[b + 8], k);
    let l = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
    tx *= l; ty *= l; tz *= l;
    l = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1);
    ux *= l; uy *= l; uz *= l;
    l = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    sx *= l; sy *= l; sz *= l;
    if (u < 0) { const d = -u * BL; cx += tx * d; cy += ty * d; cz += tz * d; }
    shape(u);
    // с мячом во рту брюхо раздуто, на вдохе жаберные крышки чуть расходятся
    const gb = Math.exp(-(((u - 0.38) / 0.16) ** 2)), gg = Math.exp(-(((u - 0.2) / 0.06) ** 2));
    pb *= 1 + 0.2 * full * gb; pw *= 1 + 0.22 * full * gb + 0.05 * breath * gg;
  }

  // Цвет поверхности (lr, lg, lb) на высоте v (1 — спина, −1 — брюхо) с нормалью n. Поверх — перелив: чешуя
  // отражает свет тонкими плёнками, и цвет отлива зависит от угла к свету — изгибаясь и поворачиваясь, рыбка
  // переливается радугой (серебристая — ярче)
  let lr = 0, lg = 0, lb = 0;
  const FILM = [0, 0, 0];
  function shade(v, nx, ny, nz) {
    const P = PAL, k = v > 0 ? Math.pow(v, 1.3) : Math.pow(-v, 1.1), c = v > 0 ? P.back : P.belly, m = P.flank;
    const d = Math.max(0, nx * LX + ny * LY + nz * LZ), h = Math.max(0, nx * HX + ny * HY + nz * HZ);
    const li = (0.4 + 0.75 * d) * (0.74 + 0.26 * clamp(nz, 0, 1)), s = Math.pow(h, 28) * lerp(0.36, 0.18, gold);
    const ir = Math.pow(h, 3) * lerp(0.4, 0.14, gold);
    U.film(2 * (1 - h) + 0.4 * v, FILM);
    lr = lerp(m[0], c[0], k) * li + P.spec[0] * s + FILM[0] * ir;
    lg = lerp(m[1], c[1], k) * li + P.spec[1] * s + FILM[1] * ir;
    lb = lerp(m[2], c[2], k) * li + P.spec[2] * s + FILM[2] * ir;
  }

  // Сетка тела: точки колец, нормали по соседям, цвет, и какие грани смотрят на нас
  function prep(f) {
    F = f.fr; Q = f.q3; full = f.full; breath = Math.sin(f.br);
    for (let k = 0; k < M; k++) {
      frameAt(RU[k]);
      RC[k * 3] = cx; RC[k * 3 + 1] = cy; RC[k * 3 + 2] = cz;
      for (let j = 0; j < J; j++) {
        const c = CO[j], a = (c >= 0 ? pt : pb) * c, b = pw * SI[j], i = k * J + j, o = i * 3;
        VP[o] = cx + ux * a + sx * b; VP[o + 1] = cy + uy * a + sy * b; VP[o + 2] = cz + uz * a + sz * b;
        VS[i * 2] = VP[o]; VS[i * 2 + 1] = VP[o + 1];
      }
    }
    for (let k = 0; k < M; k++) {
      const k0 = Math.max(k - 1, 0), k1 = Math.min(k + 1, M - 1);
      for (let j = 0; j < J; j++) {
        const i = k * J + j, o = i * 3;
        const a0 = (k * J + (j + J - 1) % J) * 3, a1 = (k * J + (j + 1) % J) * 3, b0 = (k0 * J + j) * 3, b1 = (k1 * J + j) * 3;
        const px = VP[a1] - VP[a0], py = VP[a1 + 1] - VP[a0 + 1], pz = VP[a1 + 2] - VP[a0 + 2];
        const qx = VP[b1] - VP[b0], qy = VP[b1 + 1] - VP[b0 + 1], qz = VP[b1 + 2] - VP[b0 + 2];
        let nx = py * qz - pz * qy, ny = pz * qx - px * qz, nz = px * qy - py * qx;
        let l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (l < 1e-6) { nx = F[0]; ny = F[1]; nz = F[2]; l = 1; } // кончик рыла смотрит вперёд
        nx /= l; ny /= l; nz /= l;
        if (nx * (VP[o] - RC[k * 3]) + ny * (VP[o + 1] - RC[k * 3 + 1]) + nz * (VP[o + 2] - RC[k * 3 + 2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        shade(CO[j], nx, ny, nz);
        VC[i * 4] = lr; VC[i * 4 + 1] = lg; VC[i * 4 + 2] = lb; VC[i * 4 + 3] = 1;
      }
    }
    for (let k = 0; k < M - 1; k++) {
      for (let j = 0; j < J; j++) {
        const j1 = (j + 1) % J, i00 = k * J + j, i01 = k * J + j1, i10 = (k + 1) * J + j, i11 = (k + 1) * J + j1;
        const ax = VS[i11 * 2] - VS[i00 * 2], ay = VS[i11 * 2 + 1] - VS[i00 * 2 + 1];
        const bx = VS[i10 * 2] - VS[i01 * 2], by = VS[i10 * 2 + 1] - VS[i01 * 2 + 1];
        VIS[i00] = ax * by - ay * bx > 0 ? 1 : 0;
      }
    }
  }
  // Грани тела, обращённые к нам; рыло к нам — сначала хвост, иначе сначала рыло. mesh — со светотенью,
  // иначе силуэт текущим цветом (для свечения и плёнки воды)
  function faces(mesh) {
    const back = F[2] > 0;
    for (let kk = 0; kk < M - 1; kk++) {
      const k = back ? M - 2 - kk : kk;
      for (let j = 0; j < J; j++) {
        const i00 = k * J + j;
        if (!VIS[i00]) continue;
        const j1 = (j + 1) % J, i01 = k * J + j1, i11 = (k + 1) * J + j1, i10 = (k + 1) * J + j;
        if (mesh) R.quadM(VS, VC, i00, i01, i11, i10);
        else R.quad(VS[i00 * 2], VS[i00 * 2 + 1], VS[i01 * 2], VS[i01 * 2 + 1], VS[i11 * 2], VS[i11 * 2 + 1], VS[i10 * 2], VS[i10 * 2 + 1]);
      }
    }
  }
  const bodyShape = () => faces(false);

  // Точка на боку sg (1 — по S, −1 — против) на доле длины u и высоте v: p; нормаль n (наклонена по сужению
  // тела: на голове — вперёд, к хвосту — назад); b — касательная вверх по боку; рамка сечения — в t, u, s
  let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, bx = 0, by = 0, bz = 0;
  function onSide(u, v, sg) {
    shape(u + 0.01); const t1 = pt, b1 = pb, w1 = pw;
    shape(u - 0.01); const t0 = pt, b0 = pb, w0 = pw;
    frameAt(u);
    const c = clamp(v, -1, 1), s = sg * Math.sqrt(1 - c * c), up = c >= 0, a = up ? pt : pb;
    const ia = 1 / Math.max(a, 0.5), iw = 1 / Math.max(pw, 0.5);
    const kt = ((up ? t1 - t0 : b1 - b0) * c * c * ia + (w1 - w0) * s * s * iw) / (0.02 * BL);
    px = cx + ux * a * c + sx * pw * s; py = cy + uy * a * c + sy * pw * s; pz = cz + uz * a * c + sz * pw * s;
    nx = ux * c * ia + sx * s * iw + tx * kt; ny = uy * c * ia + sy * s * iw + ty * kt; nz = uz * c * ia + sz * s * iw + tz * kt;
    let l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    nx *= l; ny *= l; nz *= l;
    const d = ux * nx + uy * ny + uz * nz;
    bx = ux - nx * d; by = uy - ny * d; bz = uz - nz * d;
    l = 1 / (Math.sqrt(bx * bx + by * by + bz * bz) || 1);
    bx *= l; by *= l; bz *= l;
  }
  // Насколько видна деталь на поверхности с нормалью, повернутой к нам на z
  const vis = z => U.smooth(clamp((z - 0.06) / 0.34, 0, 1));

  // Эллипс с центром (x, y) и полуосями-векторами (ax, ay), (qx, qy)
  const EN = 10, EC = new Float32Array(EN), ES = new Float32Array(EN), EV = new Float32Array(EN * 2);
  for (let i = 0; i < EN; i++) { EC[i] = Math.cos((i / EN) * TAU); ES[i] = Math.sin((i / EN) * TAU); }
  function ell(x, y, ax, ay, qx, qy) {
    for (let i = 0; i < EN; i++) { EV[i * 2] = x + ax * EC[i] + qx * ES[i]; EV[i * 2 + 1] = y + ay * EC[i] + qy * ES[i]; }
    R.poly(EV);
  }
  const col = (c, k = 1, a = c.length > 3 ? c[3] : 1, add = 0) => R.color(c[0] * k, c[1] * k, c[2] * k, a, add);

  // Чешуя сеточкой: тёмный задний край, светлое тело чешуйки ближе к голове, у каждой свой отлив. Чешуйки наклонены
  // каждая по-своему и вспыхивают радугой по очереди, когда тело изгибается; по боку бегут блики ряби с поверхности
  function scales(f, sg) {
    const rk = lerp(0.86, 0.72, gold);
    for (let n = 0; n < SCALES.length; n++) {
      const sc = SCALES[n], jt = f.jit[n];
      onSide(sc.u, sc.v, sg);
      const a = vis(nz);
      if (a < 0.02) continue;
      // по длине — на шаг ряда, по высоте — на шаг между рядами по дуге бока (у спины и брюха бок уходит от нас)
      const ru = SU * BL * 0.7, rv = clamp((SV * (sc.v >= 0 ? pt : pb) * 0.75) / Math.max(Math.sqrt(1 - sc.v * sc.v), 0.35), 0.6, 3.2);
      const Ax = tx * ru, Ay = ty * ru, Bx = bx * rv, By = by * rv;
      shade(sc.v, nx, ny, nz);
      R.color(lr * rk, lg * rk, lb * rk, a); ell(px, py, Ax, Ay, Bx, By);
      const k = jt[1];
      R.color(lr * k, lg * k, lb * k, a); ell(px + Ax * 0.3, py + Ay * 0.3, Ax * 0.78, Ay * 0.78, Bx * 0.78, By * 0.78);
      const mx = nx + tx * jt[0] + bx * jt[3], my = ny + ty * jt[0] + by * jt[3], mz = nz + tz * jt[0] + bz * jt[3];
      const hm = Math.max(0, (mx * HX + my * HY + mz * HZ) / Math.sqrt(mx * mx + my * my + mz * mz));
      const gl = Math.pow(hm, 4) * lerp(1.1, 0.5, gold) * (0.35 + 0.9 * U.caustic(px, py, now)) * a;
      if (gl > 0.02) {
        U.film(jt[2] + 2.4 * (1 - hm) + 0.5 * sc.v + 0.8 * sc.u, FILM);
        const S = PAL.spec, w = lerp(0.12, 0.5, gold); // радуга, разбавленная светом блика (у золотой — тёплым)
        R.color(lerp(FILM[0], S[0], w), lerp(FILM[1], S[1], w), lerp(FILM[2], S[2], w), Math.min(gl, 1), 1);
        ell(px + Ax * 0.25, py + Ay * 0.25, Ax * 0.7, Ay * 0.7, Bx * 0.7, By * 0.7);
      }
      const sp = Math.pow(hm, 30);
      if (sp > 0.02) {
        const S = PAL.spec, pk = (1 - gold) * 0.6; // у серебристой — перламутр
        R.color(lerp(S[0], PEARL[0], pk), lerp(S[1], PEARL[1], pk), lerp(S[2], PEARL[2], pk), Math.min(sp, 1) * 0.5 * a, 1);
        ell(px + Ax * 0.35, py + Ay * 0.35, Ax * 0.45, Ay * 0.45, Bx * 0.45, By * 0.45);
      }
    }
  }

  // Жаберная крышка — дуга выпуклостью к хвосту со светлой кромкой перед ней; на вдохе и при глотке отходит
  function gills(f, sg) {
    const fl = 0.012 * (0.5 + 0.5 * breath) + 0.025 * f.gill;
    let x0 = 0, y0 = 0;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, w = Math.sin(t * Math.PI);
      onSide(0.2 + (0.05 + fl) * w, lerp(0.74, -0.8, t), sg);
      const a = vis(nz);
      if (k && a > 0.02) {
        col(PAL.gill, 1, 0.5 * a); R.line(x0, y0, px, py, 1.1);
        col(PAL.gillHi, 1, 0.28 * a, 1); R.line(x0 + tx, y0 + ty, px + tx, py + ty, 0.8);
      }
      x0 = px; y0 = py;
    }
  }

  // Глаз навыкате (глазница, золотая радужка, зрачок смотрит, куда рыбке интересно, блик), ноздря, угол рта
  function face(f, sg) {
    onSide(0.075, 0.3, sg);
    let a = vis(nz + 0.1);
    if (a > 0.02) {
      const re = 3.5, ex = px + nx * 0.8, ey = py + ny * 0.8, Ax = tx * re, Ay = ty * re, Bx = bx * re, By = by * re;
      col(PAL.socket, 1, 0.85 * a); ell(ex, ey, Ax * 1.18, Ay * 1.18, Bx * 1.18, By * 1.18);
      col(PAL.irisRim, 1, a); ell(ex, ey, Ax, Ay, Bx, By);
      col(PAL.iris, 1, a); ell(ex, ey, Ax * 0.84, Ay * 0.84, Bx * 0.84, By * 0.84);
      const lx = f.lookX - ex, ly = f.lookY - ey, ll = Math.hypot(lx, ly) || 1, po = re * 0.18 * clamp(nz, 0, 1);
      R.color(0.02, 0.02, 0.04, a); ell(ex + (lx / ll) * po, ey + (ly / ll) * po, Ax * 0.55, Ay * 0.55, Bx * 0.55, By * 0.55);
      R.color(1, 1, 1, 0.9 * a); R.disc(ex - re * 0.3, ey - re * 0.36, re * 0.2);
      R.color(1, 1, 1, 0.14 * a, 1); R.soft(ex - re * 0.25, ey - re * 0.3, re * 0.9);
    }
    onSide(0.02, 0.48, sg);
    a = vis(nz);
    if (a > 0.02) { col(PAL.nostril, 1, 0.8 * a); ell(px, py, tx * 0.75, ty * 0.75, bx * 0.6, by * 0.6); }
    frameAt(-0.04);
    const mx = cx - ux * 0.5, my = cy - uy * 0.5;
    onSide(0.018, -0.22, sg);
    a = vis(nz);
    if (a > 0.02) { col(PAL.gill, 1, 0.45 * a); R.line(mx, my, px, py, 0.8); }
  }

  // Рот на кончике рыла всё время дышит; глотая и плюя, раскрывается трубочкой. Сбоку — щель, спереди — «о»
  function mouth(f) {
    const m = Math.max(f.mouth, 0.14 + 0.1 * breath);
    frameAt(-0.045);
    const ox = cx - ux * 0.5 + tx * 0.6 * m, oy = cy - uy * 0.5 + ty * 0.6 * m, av = 1.4 + 1.1 * m, ah = 1.1 + 0.9 * m;
    col(PAL.lip); ell(ox, oy, ux * av, uy * av, sx * ah + tx * 0.9, sy * ah + ty * 0.9);
    const o = 0.5 + 0.5 * m, hv = 0.3 + 1.2 * m, hh = 0.3 + 0.8 * m, hd = 0.2 + 0.35 * m;
    col(PAL.throat, 1, clamp(m * 1.6, 0, 1)); ell(ox + tx * o, oy + ty * o, ux * hv, uy * hv, sx * hh + tx * hd, sy * hh + ty * hd);
  }

  // ---------- Плавники ----------
  // Луч j: корень, середина и кончик (xyz) в FR; от корня к середине — по (ax…), дальше — по (qx…)
  const FR = new Float32Array(12 * 9), CM = [0, 0, 0, 0];
  function ray(j, rx, ry, rz, ax, ay, az, qx, qy, qz, len) {
    const o = j * 9, h = len * 0.5;
    FR[o] = rx; FR[o + 1] = ry; FR[o + 2] = rz;
    FR[o + 3] = rx + ax * h; FR[o + 4] = ry + ay * h; FR[o + 5] = rz + az * h;
    FR[o + 6] = FR[o + 3] + qx * h; FR[o + 7] = FR[o + 4] + qy * h; FR[o + 8] = FR[o + 5] + qz * h;
  }
  // Перепонка между n лучами — от c0 у корня к c1 на краю, светлее, когда повернута к свету плашмя; лучи
  // и тонкая светлая кромка
  function web(n, c0, c1) {
    for (let i = 0; i < 4; i++) CM[i] = (c0[i] + c1[i]) / 2;
    for (let j = 0; j < n - 1; j++) {
      const a = j * 9, b = a + 9;
      const ex = FR[b + 3] - FR[a + 3], ey = FR[b + 4] - FR[a + 4], ez = FR[b + 5] - FR[a + 5];
      const fx = FR[a + 6] - FR[a], fy = FR[a + 7] - FR[a + 1], fz = FR[a + 8] - FR[a + 2];
      const qx = ey * fz - ez * fy, qy = ez * fx - ex * fz, qz = ex * fy - ey * fx;
      const k = 0.8 + 0.4 * Math.abs((qx * LX + qy * LY + qz * LZ) / (Math.sqrt(qx * qx + qy * qy + qz * qz) || 1));
      R.color(c0[0] * k, c0[1] * k, c0[2] * k, c0[3]); R.color2(CM[0] * k, CM[1] * k, CM[2] * k, CM[3]);
      R.quadG(FR[a], FR[a + 1], FR[b], FR[b + 1], FR[b + 3], FR[b + 4], FR[a + 3], FR[a + 4]);
      R.color(CM[0] * k, CM[1] * k, CM[2] * k, CM[3]); R.color2(c1[0] * k, c1[1] * k, c1[2] * k, c1[3]);
      R.quadG(FR[a + 3], FR[a + 4], FR[b + 3], FR[b + 4], FR[b + 6], FR[b + 7], FR[a + 6], FR[a + 7]);
    }
    col(PAL.ray, 1, 0.42 * c0[3]);
    for (let j = 0; j < n; j++) {
      const o = j * 9;
      R.line(FR[o], FR[o + 1], FR[o + 3], FR[o + 4], 0.7);
      R.line(FR[o + 3], FR[o + 4], FR[o + 6], FR[o + 7], 0.5);
    }
    col(PAL.edgeHi, 1, 0.3);
    for (let j = 0; j < n - 1; j++) { const o = j * 9; R.line(FR[o + 6], FR[o + 7], FR[o + 15], FR[o + 16], 0.7); }
  }

  // Хвост раздвоенный: лучи веером от стебля, длинные — к кончикам лопастей, короткие — к выемке. Машет вслед
  // за стеблем с запаздыванием (f.tg), к концу лучей — сильнее, и трепещет по краю; на ходу лопасти сходятся
  function caudal(f, r) {
    const a = (N - 1) * 9, o = (N - 1) * 3, Fr = f.fr, q = f.q3;
    const Tx = Fr[a], Ty = Fr[a + 1], Tz = Fr[a + 2], Ux = Fr[a + 3], Uy = Fr[a + 4], Uz = Fr[a + 5], Sx = Fr[a + 6], Sy = Fr[a + 7], Sz = Fr[a + 8];
    const wv = Math.min(f.amp / 4, 1), g = f.tg, g2 = g * 1.5 + 0.1 * wv * Math.sin(f.ph * 0.9 - 1.2);
    const spread = lerp(1, 0.8, U.smooth(clamp(r / 0.5, 0, 1))) * (1 + 0.04 * Math.sin(f.t * 2));
    const K = 11;
    for (let j = 0; j < K; j++) {
      const t = 1 - (2 * j) / (K - 1), at = Math.abs(t), al = t * 0.5 * spread - 0.05; // лопасти чуть провисают
      const len = 8.5 + 17 * Math.pow(at, 1.4) * (1 - 0.12 * U.smooth(clamp((at - 0.7) / 0.3, 0, 1)));
      const a1 = al + g, a2 = al * 1.08 + g2, c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
      const fl = 0.08 * Math.sin(f.t * 8 + t * 2.5);
      ray(j, q[o] + Ux * t * 3.3 + Tx * 1.2, q[o + 1] + Uy * t * 3.3 + Ty * 1.2, q[o + 2] + Uz * t * 3.3 + Tz * 1.2,
        -Tx * c1 + Ux * s1, -Ty * c1 + Uy * s1, -Tz * c1 + Uz * s1,
        -Tx * c2 + Ux * s2 + Sx * fl, -Ty * c2 + Uy * s2 + Sy * fl, -Tz * c2 + Uz * s2 + Sz * fl, len);
    }
    web(K, PAL.tail0, PAL.tail1);
  }

  // Спинной плавник — высокий спереди и сходящий на нет к хвосту; на ходу и отдыхая прижимается, клонится
  // с волной и кренится на поворотах
  function dorsal(f, r) {
    const K = 9, wv = Math.min(f.amp / 4, 1);
    for (let j = 0; j < K; j++) {
      const t = j / (K - 1), u = lerp(0.36, 0.77, t);
      frameAt(u);
      const h = 14 * (t < 0.12 ? lerp(0.78, 1, t / 0.12) : lerp(1, 0.28, Math.pow((t - 0.12) / 0.88, 0.8))) * (1 - 0.3 * f.fold);
      const be = lerp(0.3, 0.95, t) + 0.35 * r + 0.3 * f.fold + 0.12 * wv * Math.sin(f.ph - 5.3 * u - 0.8);
      const b2 = be + 0.15 + 0.05 * Math.sin(f.t * 6 - t * 3);
      const sw = 0.6 * f.lean, cw = Math.cos(sw), sn = Math.sin(sw);
      const vx = ux * cw + sx * sn, vy = uy * cw + sy * sn, vz = uz * cw + sz * sn;
      const cb = Math.cos(be), sb = Math.sin(be), cb2 = Math.cos(b2), sb2 = Math.sin(b2), d = pt - 0.7;
      ray(j, cx + ux * d, cy + uy * d, cz + uz * d, vx * cb - tx * sb, vy * cb - ty * sb, vz * cb - tz * sb,
        vx * cb2 - tx * sb2, vy * cb2 - ty * sb2, vz * cb2 - tz * sb2, h);
    }
    web(K, PAL.fin0, PAL.fin1);
  }

  // Анальный плавник — маленький, под хвостовым стеблем
  function anal(f, r) {
    const K = 5;
    for (let j = 0; j < K; j++) {
      const t = j / (K - 1);
      frameAt(lerp(0.765, 0.86, t));
      const h = lerp(7.5, 4, t), be = lerp(0.6, 1, t) + 0.25 * r, b2 = be + 0.12, d = pb - 0.6;
      const cb = Math.cos(be), sb = Math.sin(be), cb2 = Math.cos(b2), sb2 = Math.sin(b2);
      ray(j, cx - ux * d, cy - uy * d, cz - uz * d, -ux * cb - tx * sb, -uy * cb - ty * sb, -uz * cb - tz * sb,
        -ux * cb2 - tx * sb2, -uy * cb2 - ty * sb2, -uz * cb2 - tz * sb2, h);
    }
    web(K, PAL.fin0, PAL.fin1);
  }

  // Парные плавники с бока sg: грудной за жаберной крышкой (раскрывается вбок и гребёт) и брюшной на брюхе
  function paired(f, sg, r) {
    const slow = 1 - U.smooth(clamp(r / 0.3, 0, 1));
    const o = clamp(0.12 + 0.5 * (sg > 0 ? f.pecR : f.pecL), 0.1, 1.35);
    onSide(0.265, -0.48, sg);
    let rx = px, ry = py, rz = pz, co = Math.cos(o), so = Math.sin(o) * sg;
    let ex = -ux * co + sx * so, ey = -uy * co + sy * so, ez = -uz * co + sz * so;
    for (let j = 0; j < 5; j++) {
      const t = j / 4, al = lerp(0.2, 1.05, t), a2 = al + 0.14 + 0.06 * Math.sin(f.t * 9 - t * 2.4);
      const c = Math.cos(al), s = Math.sin(al), c2 = Math.cos(a2), s2 = Math.sin(a2);
      ray(j, rx, ry, rz, -tx * c + ex * s, -ty * c + ey * s, -tz * c + ez * s, -tx * c2 + ex * s2, -ty * c2 + ey * s2, -tz * c2 + ez * s2, lerp(10.5, 7.6, t));
    }
    web(5, PAL.fin0, PAL.fin1);
    onSide(0.47, -0.9, sg);
    rx = px; ry = py; rz = pz;
    const o2 = 0.3 + 0.2 * slow;
    co = Math.cos(o2); so = Math.sin(o2) * sg;
    ex = -ux * co + sx * so; ey = -uy * co + sy * so; ez = -uz * co + sz * so;
    for (let j = 0; j < 4; j++) {
      const t = j / 3, al = lerp(0.5, 1.1, t), a2 = al + 0.1 + 0.05 * Math.sin(f.t * 7 - t * 2);
      const c = Math.cos(al), s = Math.sin(al), c2 = Math.cos(a2), s2 = Math.sin(a2);
      ray(j, rx, ry, rz, -tx * c + ex * s, -ty * c + ey * s, -tz * c + ez * s, -tx * c2 + ex * s2, -ty * c2 + ey * s2, -tz * c2 + ez * s2, lerp(9, 6, t));
    }
    web(4, PAL.fin0, PAL.fin1);
  }

  // Рисует рыбку; under — плёнка воды над предметом в толще (draw.js)
  proto.draw = function (under) {
    const f = this, Wt = AK.Water;
    gold = f.gold; now = f.t;
    palette(gold);
    prep(f);
    const r = Math.min(Math.abs(f.sp) / V, 1);
    // время на исходе — вспыхивает
    const blink = f.left > 0 && f.left < 3 && !f.hold ? Math.pow(0.5 + 0.5 * Math.cos(f.left * TAU * 2.5), 2) : 0;
    // ближний бок — тот, что повернут к нам; хвост за телом, пока рыло не отвернулось от нас
    const side = f.fr[8], near = side >= 0 ? 1 : -1, tailBack = f.fr[2] > -0.25;
    // тень на дне — под рыбкой, правее (свет сверху-слева), бледнеет с высотой
    R.lit(R.gi ? 1 : 0);
    if (Wt.on) {
      const k = 0.12 * Math.exp(-Math.max(0, H - 8 - f.y) / 80);
      for (let i = 0; i < N; i += 2) { R.color(0, 0.015, 0.025, k); R.soft(f.q[i * 2] + 6, H - 6, 10); }
    }
    // ореол — золотая рыбка светится сама, серебристую лишь чуть подсвечивает вода
    R.lit(0);
    frameAt(0.4);
    const hx = cx, hy = cy;
    R.color(lerp(0.5, 1, gold), lerp(0.7, 0.6, gold), lerp(1, 0.18, gold), lerp(0.05, 0.16 + 0.1 * f.full + 0.25 * blink, gold), 1); R.soft(hx, hy, 62);
    // превращение: золотое кольцо расходится, вспышка
    if (f.flare > 0) {
      const k = 1 - f.flare;
      R.color(1, 0.85, 0.4, 0.7 * f.flare, 1); R.ring(hx, hy, 18 + 70 * k, 0.12);
      R.color(1, 0.8, 0.35, 0.5 * f.flare, 1); R.soft(hx, hy, 32 + 30 * k);
    }
    R.lit(R.gi ? lerp(0.45, 0.2, gold) : 0);
    paired(f, -near, r);
    dorsal(f, r);
    anal(f, r);
    if (tailBack) caudal(f, r);
    faces(true);
    scales(f, near); gills(f, near); face(f, near);
    if (Math.abs(side) < 0.6) { scales(f, -near); gills(f, -near); face(f, -near); } // мордой к нам — видно оба бока
    mouth(f);
    if (!tailBack) caudal(f, r);
    paired(f, near, r);
    R.lit(0);
    // мяч во рту светится сквозь брюхо
    if (f.full > 0.05) { frameAt(0.36); R.color(0.6, 0.85, 1, 0.5 * f.full, 1); R.soft(cx, cy, 15); }
    if (Wt.on) under(f.x, f.y, 160, 0.6, bodyShape);
    if (blink > 0.01) { R.color(1, 0.9, 0.6, 0.45 * blink, 1); bodyShape(); }
    if (f.flare > 0) { R.color(1, 0.9, 0.55, 0.6 * f.flare * f.flare, 1); bodyShape(); }
    // мяч втягивается в рот
    if (f.suck) {
      const k = U.smooth(f.suck.t / 0.1), br = f.suck.r * (1 - 0.6 * k);
      frameAt(-0.05);
      R.color(0.9, 0.94, 1, 1 - k * 0.7); R.sphere(lerp(f.suck.x, cx, k), lerp(f.suck.y, cy, k), br);
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

  AK.Fish = Fish;
})(window.AK);
