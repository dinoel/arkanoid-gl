'use strict';
// Вода. Поле затапливает снизу: осколок, упавший в воду, поднимает её на свой объём, а ракетка плавает на ней
// и поднимается вместе с ней (game.js). Пойманные осколки и взрывы (вода выкипает паром) уровень понижают, пройденный уровень вода покидает совсем.
// Поверхность — две модели. Кромка — одномерная волна: вода плещется вверх-вниз по наклонному полу.
// Рябь — двумерное волновое уравнение на сетке 4 px; её рисует шейдер пола (renderer.js): преломление,
// каустика, пена, блики прожекторов. Брызги — капли, летящие над полом (z — высота); упавшая на сухой пол
// капля оставляет мокрое пятно, упавшая в воду — круги.
(function (AK) {
  const { clamp, TAU } = AK.U;
  const H = 960, L = 16, RX = 704;
  const Y0 = 900;                // уровень в начале: на нём ракетка плавает там же, где стояла (y = 900)
  const YMAX = 740, YDEMO = 880; // выше вода не поднимается (в заставке — ниже, чтобы не топить её)
  const CELL = 4, GY0 = YMAX - 50;   // сетка ряби — от чуть выше предельного уровня до низа экрана
  const COLS = Math.round((RX - L) / CELL), ROWS = Math.ceil((H - GY0) / CELL) + 1;
  const NS = 64, SDX = (RX - L) / (NS - 1); // узлы кромки
  const DAMP = 0.98;             // затухание ряби за шаг сетки (60 Гц): за полсекунды — вдвое
  const GZ = 1500;               // ускорение падения капель, px/s²
  const HULL_MASS = 0.15;        // какую долю силы плавучести ракетки вода получает обратно
  const BOW = 0.5;               // вал по кромке у носа: сила BOW·v²/1000 px/s² на узел (v — до 1000 px/s)
  const WAKE_CREST = 2, WAKE_DIP = 1.5, WAKE_FOAM = 0.03; // на ходу: горб у носа, впадина у кормы, пена

  const Wt = {
    on: true, level: Y0, levelT: Y0, wet: Y0,
    cols: COLS, rows: ROWS, x0: L, y0: GY0, cell: CELL,
    shore: new Float32Array(NS),            // y кромки в узлах — для шейдера и физики
    tex: new Float32Array(COLS * ROWS * 2), // рябь и пена для текстуры
    drops: [], spots: [],
  };
  let h = new Float32Array(COLS * ROWS), hp = new Float32Array(COLS * ROWS);
  const foam = new Float32Array(COLS * ROWS);
  const s = new Float32Array(NS), sv = new Float32Array(NS); // смещение кромки от уровня и его скорость
  let time = 0, tick = 0;

  // Плеск в покое — сумма двух бегущих волн
  const lap = x => 2.2 * Math.sin(x * 0.021 + time * 1.3) + 1.4 * Math.sin(x * 0.053 - time * 2.1);

  Wt.shoreAt = x => {
    const f = clamp((x - L) / SDX, 0, NS - 1.001), i = f | 0, t = f - i;
    return Wt.shore[i] + (Wt.shore[i + 1] - Wt.shore[i]) * t;
  };
  // На сколько px точка ниже кромки (больше нуля — в воде)
  Wt.depth = (x, y) => (Wt.on ? y - Wt.shoreAt(x) : -1e9);
  // Насколько тело радиуса r в точке (x, y) погружено: 0 — едва касается воды, 1 — целиком под ней
  Wt.immersion = (x, y, r) => (Wt.on ? clamp((y + r - Wt.shoreAt(x)) / (2 * r + 70), 0, 1) : 0);

  // Возмущение ряби: amt — высота в центре, rad — радиус (px), fo — сколько пены
  function disturb(x, y, amt, rad, fo) {
    const R = Math.max(1, rad / CELL), cx = (x - L) / CELL - 0.5, cy = (y - GY0) / CELL - 0.5;
    const r0 = Math.max(1, Math.floor(cy - R)), r1 = Math.min(ROWS - 2, Math.ceil(cy + R));
    const c0 = Math.max(1, Math.floor(cx - R)), c1 = Math.min(COLS - 2, Math.ceil(cx + R));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d2 = ((c - cx) ** 2 + (r - cy) ** 2) / (R * R);
        if (d2 >= 1) continue;
        const k = (1 - d2) * (1 - d2), i = r * COLS + c;
        h[i] += amt * k;
        if (fo) foam[i] = Math.min(1.5, foam[i] + fo * k);
      }
    }
  }

  function drop(x, y, z, vx, vy, vz) {
    Wt.drops.push({ x, y, z, vx, vy, vz, r: 1 + Math.random() * 1.3 });
  }

  // Всплеск: круги, пена, капли во все стороны; у кромки (если shore) вода ещё и набегает на пол
  Wt.splash = (x, y, str, rad = 10, shore = true) => {
    if (!Wt.on) return;
    disturb(x, y, -4 * str, rad, 0.8 * str);
    const n = Math.round(3 + 16 * str);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (30 + Math.random() * 130) * (0.4 + str);
      drop(x + Math.cos(a) * rad * 0.5, y + Math.sin(a) * rad * 0.5, 2,
        Math.cos(a) * sp, Math.sin(a) * sp * 0.8, (140 + Math.random() * 260) * (0.5 + str));
    }
    const d = y - Wt.shoreAt(x);
    if (shore && d < 50) {
      const i = Math.round(clamp((x - L) / SDX, 0, NS - 1));
      for (let j = -2; j <= 2; j++) {
        const k = i + j;
        if (k >= 0 && k < NS) sv[k] -= 90 * str * (1 - Math.abs(j) / 3) * (1 - Math.max(d, 0) / 50);
      }
    }
  };
  // Ракетка на воде. f — сила (ускорение, px/s²), которая держит её на плаву: вода получает её обратно, и от
  // каждого покачивания по кромке в обе стороны бегут волны. На ходу нос гонит по кромке вал, за кормой остаётся
  // впадина. Сверху корпус продавливает рябь, тем глубже, чем сильнее давит; на ходу вода горбом встаёт у носа
  // и проседает у кормы, и за ракеткой расходится клин — качаясь, она пускает круги. У носа взбивается пена.
  // Узлы кромки под корпусом (hull0..hull1): рябь их не толкает — там кромку держит сам корпус, и плеск под ним
  // и рядом слабее. Задаётся на каждый шаг заново: ракетка, ушедшая из воды, кромку больше не держит.
  let hull0 = 0, hull1 = -1, hullX = 0, hullE = 0;
  Wt.hull = (x, y, hw, r, vx, f, dt) => {
    if (!Wt.on) return;
    hullX = x; hullE = hw + r;
    hull0 = Math.max(0, Math.ceil((x - hw - r - L) / SDX)); hull1 = Math.min(NS - 1, Math.floor((x + hw + r - L) / SDX));
    for (let i = hull0; i <= hull1; i++) sv[i] -= f * HULL_MASS * dt;
    const sp = Math.abs(vx), dir = vx < 0 ? -1 : 1;
    if (sp > 20) {
      const bow = Math.round((x + dir * (hw + r) - L) / SDX) + dir, stern = Math.round((x - dir * (hw + r) - L) / SDX) - dir;
      const v = Math.min(sp, 1000), a = (BOW * v * v) / 1000 * dt;
      for (let j = 0; j < 2; j++) {
        const fb = bow + dir * j, fs = stern - dir * j, k = j ? 0.5 : 1;
        if (fb >= 0 && fb < NS) sv[fb] -= a * k;
        if (fs >= 0 && fs < NS) sv[fs] += 0.6 * a * k;
      }
    }
    const M = 10, mv = Math.min(sp / 600, 1.6);
    const depth = 1.4 + WAKE_DIP * mv - clamp(f * 0.004, -1.2, 2.5), crest = WAKE_CREST * mv, fo = mv * WAKE_FOAM;
    const r0 = Math.max(1, Math.floor((y - r - M - GY0) / CELL)), r1 = Math.min(ROWS - 2, Math.ceil((y + r + M - GY0) / CELL));
    const c0 = Math.max(1, Math.floor((x - hw - r - M - L) / CELL)), c1 = Math.min(COLS - 2, Math.ceil((x + hw + r + M - L) / CELL));
    for (let row = r0; row <= r1; row++) {
      const py = GY0 + (row + 0.5) * CELL;
      for (let c = c0; c <= c1; c++) {
        const px = L + (c + 0.5) * CELL, dist = Math.hypot(Math.max(Math.abs(px - x) - hw, 0), py - y) - r;
        if (dist > M) continue;
        const i = row * COLS + c, w = dist < 0 ? 1 : 1 - dist / M, u = clamp(((px - x) * dir) / (hw + r), -1.3, 1.3);
        h[i] += ((crest * u - depth) * w - h[i]) * 0.3 * w;
        if (fo && dist > -4) foam[i] = Math.min(1.5, foam[i] + fo * (1 - Math.abs(dist) / M) * (u > 0.6 ? 1.5 : u < -0.6 ? 1 : 0.4));
      }
    }
  };
  // След: тело, движущееся в воде, вдавливает (amt < 0) или поднимает (amt > 0) поверхность
  Wt.push = (x, y, amt, rad, fo = 0) => { if (Wt.on) disturb(x, y, amt, rad, fo); };
  // Мокрый мяч, ударившись, стряхивает капли — по нормали удара (nx, ny), k — насколько он мокрый
  Wt.spray = (x, y, nx, ny, k) => {
    if (!Wt.on) return;
    const n = Math.round(3 + 9 * k), a0 = Math.atan2(ny, nx);
    for (let i = 0; i < n; i++) {
      const a = a0 + (Math.random() - 0.5) * 2.2, sp = 50 + Math.random() * 170;
      drop(x, y, 6 + Math.random() * 6, Math.cos(a) * sp, Math.sin(a) * sp, 60 + Math.random() * 220);
    }
  };
  Wt.drip = (x, y, vx, vy) => { if (Wt.on) drop(x, y, 4, vx * 0.3 + (Math.random() - 0.5) * 40, vy * 0.3, 30 + Math.random() * 60); };
  // Вода прибывает (dy > 0) или уходит (dy < 0) на dy px: выше YMAX (в заставке — YDEMO) не поднимается,
  // а ниже начальной полосы её не вычерпать — уходит она, только когда уровень пройден
  Wt.add = dy => {
    if (Wt.on) Wt.levelT = clamp(Wt.levelT - dy, AK.G && AK.G.demo ? YDEMO : YMAX, Y0);
  };
  // Взрыв: вода выкипает — уровень опускается, по кромке поднимается пар, вода у неё бурлит
  Wt.evaporate = (x, px) => {
    if (!Wt.on || Wt.level > H) return;
    Wt.add(-px);
    const G = AK.G;
    for (let i = 0; i < 10; i++) {
      const sx = clamp(x + (Math.random() - 0.5) * 460, L + 20, RX - 20), sy = Wt.shoreAt(sx) + 4 + Math.random() * 34;
      const life = 1.1 + Math.random() * 0.9;
      G.particles.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30, life, max: life,
        size: 22 + Math.random() * 22, col: [0.7, 0.76, 0.82], g: -15, drag: 0.6, type: 2 });
      disturb(sx, sy + 8, (Math.random() - 0.5) * 3, 12, 0.5);
    }
  };

  Wt.reset = () => {
    h.fill(0); hp.fill(0); foam.fill(0); s.fill(0); sv.fill(0); hull1 = -1;
    Wt.level = Wt.levelT = Wt.wet = Y0; // уровень начинается полным: ракетка плавает с первого кадра
    Wt.drops = []; Wt.spots = [];
    shoreNodes();
  };
  Wt.toggle = () => {
    Wt.on = !Wt.on;
    Wt.reset();
    return Wt.on;
  };

  function shoreNodes() {
    for (let i = 0; i < NS; i++) {
      const x = L + i * SDX, k = hull1 < 0 ? 1 : clamp((Math.abs(x - hullX) - hullE) / (2 * SDX), 0, 1);
      Wt.shore[i] = Wt.level + s[i] + lap(x) * (0.5 + 0.5 * k);
    }
  }

  // Кромка: волна вдоль неё, возврат к ровной линии и затухание. Рябь, докатившаяся до кромки, её толкает.
  function updateShore(dt) {
    const c2 = (110 / SDX) ** 2;
    for (let i = 0; i < NS; i++) {
      const l = s[i > 0 ? i - 1 : 1], r = s[i < NS - 1 ? i + 1 : NS - 2];
      const c = clamp(Math.round((i * SDX) / CELL - 0.5), 0, COLS - 1), row = Math.floor((Wt.shore[i] - GY0) / CELL) + 2;
      const hv = row > 0 && row < ROWS && (i < hull0 || i > hull1) ? h[row * COLS + c] : 0;
      sv[i] += (c2 * (l + r - 2 * s[i]) - 6 * s[i] - 1.8 * sv[i] - 40 * hv) * dt;
    }
    for (let i = 0; i < NS; i++) s[i] += sv[i] * dt;
    shoreNodes();
  }

  // Шаг ряби (классическая схема: h' = (сумма соседей)/2 − h_prev) и сухой пол выше кромки
  function updateRipple() {
    const C = COLS;
    let top = H; // выше самой высокой точки кромки воды нет — эти строки не считаем
    for (let i = 0; i < NS; i++) top = Math.min(top, Wt.shore[i]);
    for (let r = Math.max(1, Math.floor((top - GY0) / CELL) - 1); r < ROWS - 1; r++) {
      for (let c = 1, i = r * C + 1; c < C - 1; c++, i++) {
        hp[i] = ((h[i - 1] + h[i + 1] + h[i - C] + h[i + C]) * 0.5 - hp[i]) * DAMP;
      }
    }
    const t = h; h = hp; hp = t;
    // Сухое — выше кромки. Обнуляем полосу над ней: кромка за шаг смещается на px, а всплеск у самой кромки
    // задевает клетки не дальше своего радиуса; что выше, обнулено раньше.
    for (let c = 0; c < C; c++) {
      const dry = Math.min(ROWS, Math.floor((Wt.shoreAt(L + (c + 0.5) * CELL) - GY0) / CELL));
      for (let r = Math.max(0, dry - 8), i = r * C + c; r < dry; r++, i += C) { h[i] = 0; hp[i] = 0; foam[i] = 0; }
    }
    const fd = Math.exp(-0.9 / 60);
    for (let i = 0; i < foam.length; i++) foam[i] *= fd;
  }

  function updateDrops(dt) {
    for (const d of Wt.drops) {
      d.vz -= GZ * dt; d.vy += 250 * dt; // пол наклонён, как и для осколков
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.x < L) { d.x = L; d.vx = Math.abs(d.vx) * 0.3; }
      if (d.x > RX) { d.x = RX; d.vx = -Math.abs(d.vx) * 0.3; }
      if (d.z > 0) continue;
      d.dead = true;
      if (d.y > Wt.shoreAt(d.x)) disturb(d.x, d.y, -0.5 * d.r, 5, 0.08);
      else if (d.y < H) Wt.spots.push({ x: d.x, y: d.y, r: d.r * (2 + Math.random() * 2), t: 0 });
    }
    Wt.drops = Wt.drops.filter(d => !d.dead);
    if (Wt.drops.length > 500) Wt.drops.splice(0, Wt.drops.length - 500);
    for (const p of Wt.spots) p.t += dt;
    Wt.spots = Wt.spots.filter(p => p.t < 4 && p.y < Wt.shoreAt(p.x));
    if (Wt.spots.length > 160) Wt.spots.splice(0, Wt.spots.length - 160);
  }

  // Шаг физики (120 Гц). Уровень плавно идёт к заданному; пройденный уровень вода покидает.
  Wt.step = (dt, g) => {
    if (!Wt.on) return;
    time += dt;
    if (g.state === 'clear') Wt.levelT = H + 40;
    const vmax = g.state === 'clear' ? 160 : 40; // при сходе уровня вода уходит быстро
    Wt.level += clamp((Wt.levelT - Wt.level) * (1 - Math.exp(-dt * 2.5)), -vmax * dt, vmax * dt);
    Wt.wet = Math.min(Wt.level, Wt.wet + 4 * dt); // полоса, откуда вода ушла, сохнет
    updateShore(dt);
    hull1 = -1;
    if (++tick % 2 === 0) updateRipple();
    updateDrops(dt);
  };

  // Раз в кадр: данные для текстуры ряби (r — высота, g — пена)
  Wt.frame = () => {
    const tx = Wt.tex;
    for (let i = 0, j = 0; i < h.length; i++, j += 2) { tx[j] = h[i]; tx[j + 1] = foam[i]; }
    return Wt;
  };

  shoreNodes();
  AK.Water = Wt;
})(window.AK);
