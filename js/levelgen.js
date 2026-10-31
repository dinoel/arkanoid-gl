'use strict';
// Процедурная генерация уровней: семейства раскладок (сетка, соты, треугольная мозаика, вращающиеся кольца,
// спиральная галактика, мозаика Пуассона, крепость, волна, мишень, пиксель-арт, паркет, механизм с роторами,
// маятники, конвейер, картина и она же живая), зеркальная симметрия, маски из шума, особые кирпичи, сложность растёт с номером
// уровня. Всё детерминировано сидом.
(function (AK) {
  const { U, P } = AK;
  const { clamp, TAU } = U;
  // Зона раскладки. От боковых стенок (16 и 704) — по 24: мяч (диаметр 16) проходит за крайний столбец с
  // запасом. При щели ровно в диаметр мяч заклинивало между стенкой и сталью.
  const B = { L: 40, R: 680, T: 112, B: 560 };
  const CX = 360;
  const SQ3 = Math.sqrt(3);
  // Размер кирпичей: во сколько раз они крупнее исходных чисел ниже. Раскладки занимают ту же область поля,
  // крупных кирпичей в неё просто входит меньше.
  const SZ = 1.15;

  // Зеркальная копия движения: зеркальный кирпич движется зеркально — крутится в другую сторону, качается
  // навстречу. Сдвиг ряда (slide) и движение с rigid — общие для всей фигуры, копия движется так же.
  function mirrorMotion(m) {
    if (!m || m.rigid || m.type === 'slide') return m;
    const o = Object.assign({}, m);
    switch (m.type) {
      case 'spin': o.w = -m.w; break;
      case 'liss': o.ax = -m.ax; o.w = -(m.w || 0); break;
      case 'orbit': o.cx = 2 * CX - m.cx; o.a0 = Math.PI - m.a0; o.w = -m.w; break;
      case 'swing': o.px = 2 * CX - m.px; o.a = -m.a; break;
      case 'track': o.cx = 2 * CX - m.cx; o.rot = -(m.rot || 0); o.dir = -(m.dir || 1); break;
    }
    return o;
  }
  function mirrorSpec(s) {
    const m = Object.assign({}, s);
    m.x = 2 * CX - s.x;
    m.local = P.mirrorX(s.local);
    // угол кирпича на конвейере отсчитывается от хода петли, а у зеркальной петли ход обратный
    m.ang = -(s.ang || 0) - (s.motion && s.motion.type === 'track' ? Math.PI : 0);
    m.motion = mirrorMotion(s.motion);
    if (s.grp != null && m.motion !== s.motion) m.grp = s.grp + '~';
    return m;
  }
  function pushSym(out, s) {
    out.push(s);
    if (Math.abs(s.x - CX) > 1) out.push(mirrorSpec(s));
  }
  // Кирпич на орбите, маятнике или конвейере стоит там, куда его ставит движение; x, y — его место в начале
  const at0 = {};
  function place(s) { const p = P.pose(s.motion, s.x, s.y, s.ang || 0, 0, at0); s.x = p.x; s.y = p.y; return s; }

  // ---------- Сетка прямоугольников ----------
  function grid(rng, d, noise) {
    const out = [];
    const cols = Math.round(rng.pick(d === 0 ? [10, 12] : [10, 12, 13, 14]) / SZ);
    const gap = 4;
    const slide = d >= 3 && rng.chance(0.4);
    const zoneW = (B.R - B.L) * (slide ? 0.78 : 1);
    const bw = (zoneW - gap * (cols - 1)) / cols;
    const bh = rng.pick([20, 22, 24]) * SZ;
    const shape = d === 0 ? 'rect' : rng.weighted([['rect', 3], ['pill', 1], ['para', 1]]);
    const maxRows = Math.floor((B.B - B.T) / (bh + gap));
    const rows = clamp(6 + Math.floor(d / 2) + rng.int(0, 2), 5, Math.min(13, maxRows));
    const pattern = d === 0 ? rng.pick(['full', 'stripes']) : rng.pick(['noise', 'full', 'stripes', 'checker', 'pyramid', 'invader', 'noise']);
    const sc = rng.range(1.8, 3.6), thr = rng.range(0.38, 0.5);
    const sfreq = rng.range(0.5, 0.9) + d * 0.02;
    for (let r = 0; r < rows; r++) {
      // параллелограммы ряд через ряд наклонены в разные стороны — ёлочкой; ширина по крайним точкам — bw
      const sk = shape === 'para' ? bh * 0.28 * (r % 2 ? 1 : -1) : 0;
      const local = shape === 'pill' ? P.pill(bw, bh) : shape === 'para' ? P.para(bw - 2 * Math.abs(sk), bh, sk) : P.rect(bw, bh);
      for (let c = 0; c < Math.ceil(cols / 2); c++) {
        const au = Math.abs(((c + 0.5) / cols) * 2 - 1), v = r / Math.max(1, rows - 1);
        let keep = true;
        switch (pattern) {
          case 'noise': keep = noise(au * sc, v * sc * 1.3) > thr; break;
          case 'full': keep = U.hash(r, c, 99) > 0.05; break;
          case 'stripes': keep = r % 3 !== 2; break;
          case 'checker': keep = (r + c) % 2 === 0 || r % 4 === 0; break;
          case 'pyramid': keep = au < 0.15 + v * 0.9; break;
          case 'invader': keep = U.hash(r >> 1, c, rows) < 0.6; break;
        }
        if (!keep) continue;
        const x = CX - zoneW / 2 + bw / 2 + c * (bw + gap);
        const y = B.T + r * (bh + gap) + bh / 2;
        const motion = slide && r % 2 === 1
          ? { type: 'slide', amp: (B.R - B.L) * 0.105 * (r % 4 === 1 ? 1 : -1), f: sfreq, ph: 0 } : null;
        pushSym(out, { local, x, y, ang: 0, key: [r, c], t: v, motion });
      }
    }
    return out;
  }

  // ---------- Соты ----------
  function honeycomb(rng, d, noise) {
    const out = [];
    const r = rng.pick([19, 21, 23]) * SZ;
    const w = SQ3 * r, vstep = 1.5 * r;
    const cols = Math.floor((B.R - B.L) / w);
    const maxRows = Math.floor((B.B - B.T - 2 * r) / vstep) + 1;
    const rows = clamp(7 + Math.floor(d / 3) + rng.int(0, 2), 6, Math.min(12, maxRows));
    const pattern = rng.pick(['blob', 'rings', 'diamond', 'full', 'blob']);
    const sc = rng.range(2, 4), thr = rng.range(0.4, 0.5);
    const cy = B.T + r + ((rows - 1) * vstep) / 2;
    const local = P.ngon(6, r - 2.2, -Math.PI / 2);
    for (let row = 0; row < rows; row++) {
      const n = row % 2 === 0 ? cols : cols - 1;
      for (let i = 0; i < Math.ceil(n / 2); i++) {
        const x = CX + (i - (n - 1) / 2) * w;
        const y = B.T + r + row * vstep;
        const au = Math.abs(x - CX) / ((B.R - B.L) / 2), v = row / Math.max(1, rows - 1);
        const dist = Math.hypot((x - CX) / 300, (y - cy) / 220);
        let keep = true;
        switch (pattern) {
          case 'blob': keep = noise(au * sc, v * sc) - dist * 0.25 > thr - 0.18; break;
          case 'rings': keep = Math.floor(dist * 5) % 2 === 0; break;
          case 'diamond': keep = au + Math.abs(v - 0.5) * 1.2 < 0.95 && !(au + Math.abs(v - 0.5) < 0.3); break;
          case 'full': keep = U.hash(row, i, 7) > 0.08; break;
        }
        if (!keep) continue;
        pushSym(out, { local, x, y, ang: 0, key: [row, Math.abs(Math.round((x - CX) / w * 2))], t: v });
      }
    }
    return out;
  }

  // ---------- Треугольная мозаика ----------
  function triangles(rng, d, noise) {
    const out = [];
    const s = rng.pick([50, 54, 60]) * SZ;
    const h = (s * SQ3) / 2;
    let n = Math.floor((B.R - B.L) / (s / 2)) - 1;
    if (n % 2 === 0) n--;
    const rows = clamp(5 + Math.floor(d / 3) + rng.int(0, 1), 5, Math.min(9, Math.floor((B.B - B.T) / h)));
    const pattern = rng.pick(['hourglass', 'noise', 'diamond', 'bands']);
    const sc = rng.range(2, 4);
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i <= (n - 1) / 2; i++) {
        const up = (i + row) % 2 === 0;
        const x = CX + (i - (n - 1) / 2) * (s / 2);
        const y0 = B.T + row * h;
        const y = up ? y0 + (2 * h) / 3 : y0 + h / 3;
        const au = Math.abs(x - CX) / ((B.R - B.L) / 2), v = row / Math.max(1, rows - 1);
        let keep = true;
        switch (pattern) {
          case 'hourglass': keep = au < 0.25 + Math.abs(v - 0.5) * 1.5; break;
          case 'noise': keep = noise(au * sc, v * sc) > 0.42; break;
          case 'diamond': keep = au + Math.abs(v - 0.5) < 0.85; break;
          case 'bands': keep = Math.floor(au * 6 + v * 3) % 2 === 0; break;
        }
        if (!keep) continue;
        pushSym(out, { local: P.tri(s - 6, up), x, y, ang: 0, key: [row, i], t: v });
      }
    }
    return out;
  }

  // ---------- Вращающиеся кольца ----------
  function rings(rng, d) {
    const out = [];
    const cy = B.T + 222;
    const K = clamp(2 + Math.floor(d / 3) + rng.int(0, 1), 2, 4);
    const spin = d >= 2;
    for (let k = 1; k <= K; k++) {
      const R = 50 + k * 44;
      const shape = rng.pick(['arc', 'arc', 'pill', 'circle', 'diamond', 'hex']);
      const w = spin ? (k % 2 ? 1 : -1) * rng.range(0.16, 0.34) * (1 + d * 0.03) : 0;
      const n = Math.floor((TAU * R) / ((shape === 'arc' || shape === 'pill' ? 46 : 40) * SZ));
      const off = rng.range(0, TAU);
      for (let j = 0; j < n; j++) {
        if (U.hash(k, j, 31) < 0.1) continue;
        const th = off + (j / n) * TAU;
        const x = CX + R * Math.cos(th), y = cy + R * Math.sin(th);
        const s = { x, y, key: [k, j], t: k / K, ang: 0, local: null, circle: 0 };
        if (shape === 'arc') { s.local = P.rect(((TAU * R) / n) * 0.84, 20 * SZ); s.ang = th + Math.PI / 2; }
        else if (shape === 'pill') { s.local = P.pill(((TAU * R) / n) * 0.84, 20 * SZ); s.ang = th + Math.PI / 2; }
        else if (shape === 'circle') { s.circle = 15 * SZ; s.local = P.ngon(24, 15 * SZ); }
        else if (shape === 'diamond') { s.local = P.diamond(26 * SZ, 30 * SZ); s.ang = th; }
        else { s.local = P.ngon(6, 15 * SZ); s.ang = th; }
        if (w) s.motion = { type: 'orbit', cx: CX, cy, r: R, a0: th, w };
        out.push(s);
      }
    }
    out.push({ x: CX, y: cy, circle: 26 * SZ, local: P.ngon(28, 26 * SZ), ang: 0, key: [0, 0], t: 0,
      kind: d >= 4 ? 'steel' : 'explosive', hp: 1 });
    return out;
  }

  // ---------- Спиральная галактика ----------
  function spiral(rng, d) {
    const out = [];
    const cy = B.T + 222;
    const arms = rng.int(2, 3);
    const b = (46 * SZ * arms) / TAU;
    const r0 = 52, rMax = 218;
    const w = d >= 3 ? (rng.chance(0.5) ? 1 : -1) * rng.range(0.14, 0.28) : 0;
    const shapes = ['circle', 'diamond', 'hex', 'square'];
    const placed = [];
    for (let a = 0; a < arms; a++) {
      const base = (a / arms) * TAU + rng.range(-0.1, 0.1);
      const shape = shapes[(a + rng.int(0, 3)) % shapes.length];
      let th = 0, idx = 0;
      while (true) {
        const r = r0 + b * th;
        if (r > rMax) break;
        const ang = base + th;
        const x = CX + r * Math.cos(ang), y = cy + r * Math.sin(ang);
        const sz = (13 + (r / rMax) * 5) * SZ;
        if (!placed.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + sz + 3)) {
          placed.push([x, y, sz]);
          const s = { x, y, key: [a, idx], t: r / rMax, ang: 0, circle: 0, local: null };
          if (shape === 'circle') { s.circle = sz; s.local = P.ngon(22, sz); }
          else if (shape === 'diamond') { s.local = P.diamond(sz * 1.5, sz * 2); s.ang = ang; }
          else if (shape === 'hex') { s.local = P.ngon(6, sz); s.ang = ang; }
          else { s.local = P.rect(sz * 1.35, sz * 1.35); s.ang = ang; }
          if (w) s.motion = { type: 'orbit', cx: CX, cy, r, a0: ang, w };
          out.push(s);
        }
        th += (36 * SZ) / Math.sqrt(r * r + b * b);
        idx++;
      }
    }
    out.push({ x: CX, y: cy, circle: 22 * SZ, local: P.ngon(26, 22 * SZ), ang: 0, key: [9, 9], t: 0, kind: 'explosive', hp: 1,
      motion: w ? { type: 'spin', w } : null });
    // Пояс шестиугольников по верху
    for (let i = 0; i < 6; i++) {
      const x = B.L + 30 + i * 50 * SZ, y = B.T + 4;
      // спираль не симметрична — пояс проверяем с обеих сторон
      if (x > CX - 40 || placed.some(p => Math.min(Math.hypot(p[0] - x, p[1] - y), Math.hypot(p[0] - 2 * CX + x, p[1] - y)) < p[2] + 22 * SZ)) continue;
      if (w && Math.hypot(x - CX, y - cy) < rMax + 40) continue;
      pushSym(out, { x, y, local: P.ngon(6, 16 * SZ, -Math.PI / 2), ang: 0, key: [20, i], t: 1 });
    }
    return out;
  }

  // ---------- Мозаика Пуассона из разных форм ----------
  function mosaic(rng, d, noise) {
    const out = [];
    const placed = [];
    const thr = rng.range(0.36, 0.46), sc = rng.range(0.006, 0.011);
    const spinP = d >= 3 ? 0.3 : 0;
    const kinds = [['hex', 3], ['oct', 2], ['pent', 2], ['tri', 2], ['diamond', 2], ['circle', 2], ['rect', 2], ['square', 1],
      ['trap', 2], ['kite', 2], ['pill', 2], ['half', 1]];
    const fits = (x, y, r) => {
      for (const p of placed) if (Math.hypot(p[0] - x, p[1] - y) < p[2] + r + 6) return false;
      return true;
    };
    for (let tries = 0; tries < 2600 && out.length < 150; tries++) {
      const rad = rng.range(15, 28) * SZ;
      let x = rng.range(B.L + rad, CX), y = rng.range(B.T + rad, B.B - rad);
      const onAxis = CX - x < rad + 4;
      if (onAxis) x = CX;
      if (noise(x * sc, y * sc) < thr) continue;
      if (!fits(x, y, rad) || (!onAxis && !fits(2 * CX - x, y, rad))) continue;
      const shape = rng.weighted(kinds);
      const rot = onAxis ? -Math.PI / 2 : rng.range(0, TAU);
      const s = { x, y, ang: 0, key: [Math.round(x), Math.round(y)], t: (y - B.T) / (B.B - B.T), circle: 0, local: null };
      // все формы вписаны в круг радиуса rad — вращаясь на месте, кирпич не заденет соседей
      switch (shape) {
        case 'hex': s.local = P.ngon(6, rad, rot); break;
        case 'oct': s.local = P.ngon(8, rad, rot); break;
        case 'pent': s.local = P.ngon(5, rad, rot); break;
        case 'tri': s.local = P.ngon(3, rad, rot); break;
        case 'diamond': s.local = P.diamond(rad * 1.3, rad * 2); s.ang = onAxis ? 0 : rot; break;
        case 'circle': s.circle = rad * 0.85; s.local = P.ngon(24, rad * 0.85); break;
        case 'rect': s.local = P.rect(rad * 1.8, rad * 0.85); s.ang = onAxis ? 0 : rot; break;
        case 'square': s.local = P.rect(rad * 1.4, rad * 1.4); s.ang = onAxis ? Math.PI / 4 : rot; break;
        case 'trap': s.local = P.trap(rad * 1.6, rad * 0.8, rad * 0.95); s.ang = onAxis ? 0 : rot; break;
        case 'kite': s.local = P.kite(rad * 1.2, rad * 1.7, 0.3); s.ang = onAxis ? 0 : rot; break;
        case 'pill': s.local = P.pill(rad * 1.9, rad * 0.9); s.ang = onAxis ? 0 : rot; break;
        case 'half': s.local = P.half(rad * 0.9); s.ang = onAxis ? 0 : rot; break;
      }
      if (!onAxis && shape !== 'circle' && rng.chance(spinP)) s.motion = { type: 'spin', w: rng.range(0.6, 1.4) * (rng.chance(0.5) ? 1 : -1) };
      placed.push([x, y, rad]);
      if (!onAxis) placed.push([2 * CX - x, y, rad]);
      pushSym(out, s);
    }
    return out;
  }

  // ---------- Крепость ----------
  function fortress(rng, d, noise) {
    const out = [];
    const cols = 2 * Math.round(6 / SZ), gap = 4, bh = 22 * SZ, mid = cols / 2;
    const bw = (B.R - B.L - gap * (cols - 1)) / cols;
    const rows = clamp(9 + Math.floor(d / 4), 9, 14);
    const gapC = rng.int(2, 4), gapR = rng.int(3, rows - 3);
    const innerHole = rng.chance(0.5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols / 2; c++) {
        const x = B.L + bw / 2 + c * (bw + gap), y = B.T + r * (bh + gap) + bh / 2;
        const s = { local: P.rect(bw, bh), x, y, ang: 0, key: [r, c], t: r / rows };
        if (r === rows - 1) { if (c === gapC) continue; s.kind = 'steel'; s.hp = 1; }
        else if (c === 0 && r >= 2) { if (r === gapR || r === gapR + 1) continue; s.kind = 'steel'; s.hp = 1; }
        else {
          if (innerHole && c >= mid - 2 && r >= 3 && r <= rows - 4) {
            if (c === mid - 1 && r === Math.floor(rows / 2)) { s.kind = 'explosive'; s.hp = 1; }
            else continue;
          }
          s.boost = 1.7;
          s.noSteel = true; // стали хватает в стенах — случайная внутри складывается в пещеры, куда мяч не долетает
        }
        pushSym(out, s);
      }
    }
    return out;
  }

  // ---------- Неподвижный фон вокруг механизмов ----------
  // Решётка мелких кирпичей по всей раскладке; остаются те, для которых keep(x, y, r) не ноль (2 — кирпич
  // ядра: прочнее обычного). keep должна быть симметричной: кирпичи кладутся зеркальными парами.
  function backdrop(out, rng, d, noise, keep, style) {
    style = style || rng.pick(['hex', 'brick', 'diamond']);
    const sc = rng.range(0.008, 0.014), thr = rng.range(0.38, 0.5);
    const rowsOf = (step, pad, fn) => { for (let row = 0, y = B.T + pad; y <= B.B - pad; row++, y += step) fn(row, y); };
    const cell = (x, y, row, local, rad, ang = 0) => {
      if (x > CX + 1) return;
      const k = keep(x, y, rad);
      if (!k || noise(Math.abs(x - CX) * sc, y * sc) < thr) return;
      pushSym(out, { local, x, y, ang, key: [100 + row, Math.round(Math.abs(x - CX))], t: (y - B.T) / (B.B - B.T), boost: k === 2 ? 2.5 : 1 });
    };
    if (style === 'hex') {
      const r = 15 * SZ, w = SQ3 * r, local = P.ngon(6, r - 2, -Math.PI / 2);
      const n = Math.floor((B.R - B.L) / w);
      rowsOf(1.5 * r, r, (row, y) => {
        const m = row % 2 ? n - 1 : n;
        for (let i = 0; i < m; i++) cell(CX + (i - (m - 1) / 2) * w, y, row, local, r);
      });
    } else if (style === 'brick') {
      const bw = 38 * SZ, bh = 17 * SZ, gap = 4, local = P.rect(bw, bh), rad = Math.hypot(bw, bh) / 2;
      const n = Math.floor((B.R - B.L + gap) / (bw + gap));
      rowsOf(bh + gap, bh / 2, (row, y) => {
        const m = row % 2 ? n - 1 : n;
        for (let i = 0; i < m; i++) cell(CX + (i - (m - 1) / 2) * (bw + gap), y, row, local, rad);
      });
    } else {
      const dw = 30 * SZ, dh = 36 * SZ, gap = 4, local = P.diamond(dw, dh), sx = dw + gap * 1.6;
      const n = Math.floor((B.R - B.L) / sx);
      rowsOf(dh / 2 + gap * 0.8, dh / 2, (row, y) => {
        const m = row % 2 ? n - 1 : n;
        for (let i = 0; i < m; i++) cell(CX + (i - (m - 1) / 2) * sx, y, row, local, dh / 2);
      });
    }
  }
  // Расстояние от точки до отрезка
  function segDist(x, y, ax, ay, bx, by) {
    const ex = bx - ax, ey = by - ay, t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1), 0, 1);
    return Math.hypot(x - ax - ex * t, y - ay - ey * t);
  }

  // ---------- Механизм: роторы — мельницы со спицами и шестерни — на неподвижном фоне ----------
  function mechanism(rng, d, noise) {
    const out = [];
    const w0 = (0.32 + 0.035 * Math.min(d, 12)) * rng.range(0.85, 1.15) * (rng.chance(0.5) ? 1 : -1);
    const layout = rng.pick(['pair', 'pair', 'single', 'trio']);
    const rotors = []; // x, y — ось; R — докуда достают его кирпичи; sym — левый из зеркальной пары
    if (layout === 'single') rotors.push({ x: CX, y: B.T + 204, R: rng.range(165, 192), w: w0 * 0.8 });
    else if (layout === 'pair') {
      const R = rng.range(118, 148);
      rotors.push({ x: CX - R - rng.range(18, 34), y: rng.range(B.T + R + 8, B.T + 236), R, w: w0, sym: true });
    } else {
      const R1 = rng.range(95, 110), R2 = rng.range(100, 115);
      rotors.push({ x: CX, y: B.T + R1 + 8, R: R1, w: -w0 * 1.2 });
      rotors.push({ x: CX - 205, y: B.T + 290, R: R2, w: w0, sym: true });
    }
    const hubR = 20 * SZ;
    rotors.forEach((ro, k) => {
      const parts = [];
      const grp = 'rotor' + k;
      // часть ротора с центром (lx, ly) относительно оси; поворачивается вместе с ним
      const add = (lx, ly, local, ang, key, extra) => parts.push(Object.assign({
        x: ro.x + lx, y: ro.y + ly, local, ang, key: [40 + k, key], t: Math.hypot(lx, ly) / ro.R, grp, prio: 1,
        motion: { type: 'orbit', cx: ro.x, cy: ro.y, r: Math.hypot(lx, ly), a0: Math.atan2(ly, lx), w: ro.w },
      }, extra));
      const style = rng.pick(['arms', 'arms', 'gear']);
      if (style === 'arms') {
        const nArms = rng.int(2, 4), th = rng.pick([18, 20, 22]) * SZ, gap = 5;
        const shape = rng.pick(['rect', 'pill', 'bead']);
        const r0 = hubR + 8;
        // звенья подогнаны так, чтобы спица кончалась ровно на радиусе ротора
        const cnt = Math.max(2, Math.floor((ro.R - r0 + gap) / ((shape === 'bead' ? th * 1.5 : rng.pick([34, 40]) * SZ) + gap)));
        const lb = (ro.R - r0 + gap) / cnt - gap;
        const blade = shape !== 'bead' && rng.chance(0.6);
        const a0 = rng.range(0, TAU);
        for (let a = 0; a < nArms; a++) {
          const ang = a0 + (a * TAU) / nArms;
          for (let j = 0; j < cnt; j++) {
            const rr = r0 + (j + 0.5) * (lb + gap) - gap / 2;
            let local, extra;
            // лопасть на конце спицы — трапеция, широкая наружу
            if (blade && j === cnt - 1) local = P.rot(P.trap(th * 2.1, th, lb), -Math.PI / 2);
            else if (shape === 'pill') local = P.pill(lb, th);
            else if (shape === 'bead') { local = P.ngon(16, lb / 2); extra = { circle: lb / 2 }; }
            else local = P.rect(lb, th);
            add(Math.cos(ang) * rr, Math.sin(ang) * rr, local, ang, 1 + a * 10 + j, extra);
          }
        }
      } else {
        // шестерня: обод из секторов в один-два слоя и зубья — трапеции, широкие к оси
        const toothH = 20 * SZ, gapR = 7, gapA = 5;
        const rimOut = ro.R - toothH - gapR;
        const layers = clamp(Math.round((rimOut - hubR - 8) / (34 * SZ)), 1, 2);
        const th = (rimOut - hubR - 8 - gapR * (layers - 1)) / layers;
        let r0 = hubR + 8, idx = 1;
        for (let l = 0; l < layers; l++, r0 += th + gapR) {
          const r1 = r0 + th;
          let nS = Math.max(4, Math.round((TAU * (r0 + r1)) / 2 / (54 * SZ)));
          while (r0 * (1 - Math.cos(Math.PI / nS)) > gapR - 2.5) nS++;
          const off = rng.range(0, TAU), da = gapA / (2 * r0);
          for (let j = 0; j < nS; j++) {
            const poly = P.sector(r0, r1, off + (j * TAU) / nS + da, off + ((j + 1) * TAU) / nS - da);
            const [gx, gy] = P.centroid(poly);
            add(gx, gy, P.centered(poly), 0, idx++);
          }
        }
        const nt = Math.floor((TAU * ro.R) / (34 * SZ * 1.9)), rt = rimOut + gapR + toothH / 2, off = rng.range(0, TAU);
        for (let j = 0; j < nt; j++) {
          const ang = off + (j * TAU) / nt;
          add(Math.cos(ang) * rt, Math.sin(ang) * rt, P.rot(P.trap(30 * SZ, 16 * SZ, toothH), Math.PI / 2), ang, 100 + j);
        }
      }
      // ступица: шестигранник, крутится вместе с ротором
      parts.push({ x: ro.x, y: ro.y, local: P.ngon(6, hubR), ang: 0, key: [40 + k, 0], t: 0, grp, prio: 1,
        motion: { type: 'spin', w: ro.w }, kind: rng.pick(['explosive', 'crystal', 'steel', null]), hp: 1 });
      for (const s of parts) {
        if (s.kind === 'crystal') s.hp = 2;
        if (!s.kind) delete s.kind;
        if (s.motion.type === 'orbit') place(s);
        if (ro.sym) pushSym(out, s); else out.push(s);
      }
    });
    // фон — мимо роторов (у зеркальной пары проверяем и правый)
    const all = rotors.flatMap(ro => ro.sym ? [ro, { x: 2 * CX - ro.x, y: ro.y, R: ro.R }] : [ro]);
    const free = (x, y, r) => all.every(ro => Math.hypot(x - ro.x, y - ro.y) > ro.R + r + 12 && Math.hypot(2 * CX - x - ro.x, y - ro.y) > ro.R + r + 12);
    // ниже роторов — не дальше 60 px: мячу нужно место, чтобы до них добраться
    const yLim = Math.max(...all.map(ro => ro.y + ro.R)) + 60;
    backdrop(out, rng, d, noise, (x, y, r) => y < yLim && free(x, y, r) ? 1 : 0);
    return out;
  }

  // ---------- Маятники: гирлянды кирпичей на нитях под потолочной балкой ----------
  // Соседние маятники разной длины: грузы висят на разной высоте и разминутся при любом размахе. Маятники одной
  // длины — через один, и размах каждого не больше половины зазора между ними. Длинные качаются медленнее.
  function pendulums(rng, d, noise) {
    const out = [];
    const n = rng.pick([5, 7]);
    const pitch = rng.range(560, 610) / n;
    const py = B.T + 16;                      // точки подвеса
    const r = rng.pick([20, 22]) * SZ;        // радиус груза
    const link = 2 * r + 8;                   // шаг звеньев гирлянды
    const Ls = rng.range(125, 150), Ll = Ls + rng.range(115, 145);
    const shape = rng.pick(['circle', 'hex', 'diamond', 'kite', 'oct']);
    const bob = () => {
      switch (shape) {
        case 'circle': return { local: P.ngon(20, r), circle: r };
        case 'hex': return { local: P.ngon(6, r, -Math.PI / 2) };
        case 'diamond': return { local: P.diamond(r * 1.5, r * 2) };
        case 'kite': return { local: P.kite(r * 1.4, r * 1.76, 0.3) };
        default: return { local: P.ngon(8, r, Math.PI / 8) };
      }
    };
    const mid = (n - 1) / 2;
    for (let i = 0; i <= mid; i++) {
      const px = CX + (i - mid) * pitch;
      const L = (mid - i) % 2 === 0 ? Ll : Ls;
      const maxSw = Math.min((2 * pitch - 2 * r - 14) / 2, px - r - 46);
      const a = Math.min(Math.asin(clamp(maxSw / L, 0, 0.95)), 0.65) * rng.range(0.75, 1);
      const m = { type: 'swing', px, py, l: 0, a, f: rng.range(1.5, 2.0) * Math.sqrt(140 / L), ph: rng.range(0, TAU) };
      // гирлянда: груз на конце и звенья выше, пока не дойдут до грузов соседей
      const top = L === Ll ? Ls + 2 * r + 14 : 70;
      for (let j = 0, l = L; l >= top; j++, l -= link) {
        const s = Object.assign({ x: px, y: py + l, ang: 0, key: [60 + Math.round(mid - i), j], t: l / Ll,
          motion: Object.assign({}, m, { l }), grp: 'pend' + i, prio: 1 }, bob());
        // средний маятник на оси качается сам по себе, без зеркальной пары
        if (Math.abs(px - CX) < 1) out.push(place(s)); else pushSym(out, place(s));
      }
    }
    // балка над точками подвеса — между ними и по краям
    const bh = 18 * SZ, bw = pitch - 30;
    for (let i = -1; i < mid; i++) {
      const x = CX + (i - mid + 0.5) * pitch;
      if (x - bw / 2 < B.L) continue;
      pushSym(out, { local: P.para(bw - 2 * bh * 0.3, bh, -bh * 0.3), x, y: B.T + 2, ang: 0, key: [59, i + 1], t: 0 });
    }
    // пол под маятниками
    const y0 = py + Ll + r + 24;
    const fshape = rng.pick(['trap', 'para', 'rect', 'pill']);
    for (let row = 0, y = y0 + 12 * SZ; y + 12 * SZ <= B.B + 6; row++, y += 24 * SZ + 4) band(out, y, 22 * SZ, fshape, 80 + row, row);
    return out;
  }

  // Ряд кирпичей во всю ширину раскладки на высоте y, симметричный относительно оси
  function band(out, y, h, shape, kr, row) {
    const gap = 4;
    if (shape === 'trap') {
      // трапеции попеременно широким основанием вниз и вверх: косые стороны соседей параллельны
      // центр трапеции — центр масс, он ниже середины высоты у стоящей и выше у перевёрнутой: выравниваем по высоте
      const wb = h * 2.6, wt = h * 1.2, step = (wb + wt) / 2 + gap, dy = (h * (wb - wt)) / (6 * (wb + wt));
      for (let i = 0; CX - i * step - wb / 2 >= B.L - 2; i++) {
        const up = (i + row) % 2 === 0;
        pushSym(out, { local: up ? P.trap(wb, wt, h) : P.rot(P.trap(wb, wt, h), Math.PI), x: CX - i * step, y: y + (up ? dy : -dy), ang: 0, key: [kr, i], t: (y - B.T) / (B.B - B.T) });
      }
      return;
    }
    const w = h * 2.4, step = w + gap;
    for (let i = 0; CX - (i + 1) * step + gap / 2 >= B.L - 2; i++) {
      const x = CX - (i + 0.5) * step;
      const sk = h * 0.3 * (row % 2 ? 1 : -1);
      const local = shape === 'para' ? P.para(w - 2 * Math.abs(sk), h, sk) : shape === 'pill' ? P.pill(w, h) : P.rect(w, h);
      pushSym(out, { local, x, y, ang: 0, key: [kr, i], t: (y - B.T) / (B.B - B.T) });
    }
  }

  // ---------- Волна: столбцы кирпичей качаются вверх-вниз с запаздыванием — по раскладке бежит волна ----------
  // Весь столбец качается целиком, так что кирпичи в нём не сближаются, а соседние столбцы не перекрываются
  // по ширине — качаясь вверх-вниз, они не заденут друг друга.
  function wave(rng, d, noise) {
    const out = [];
    const shape = rng.pick(['rect', 'pill', 'hex', 'circle', 'diamond', 'para']);
    const cw = rng.pick([44, 48, 54]) * SZ, gx = 5, gy = 4;
    const ncol = Math.floor((B.R - B.L + gx) / (cw + gx));
    let bh, local, circle = 0;
    switch (shape) {
      case 'hex': local = P.ngon(6, cw / 2); bh = (SQ3 * cw) / 2; break;
      case 'circle': circle = cw * 0.45; local = P.ngon(20, circle); bh = circle * 2; break;
      case 'diamond': local = P.diamond(cw, cw * 1.15); bh = cw * 1.15; break;
      case 'para': bh = 20 * SZ; local = P.para(cw - bh * 0.6, bh, bh * 0.3); break;
      case 'pill': bh = 20 * SZ; local = P.pill(cw, bh); break;
      default: bh = rng.pick([20, 22]) * SZ; local = P.rect(cw, bh);
    }
    const A = d >= 1 ? rng.range(7, 12) + Math.min(d, 8) : 0;   // размах, px
    const om = rng.range(1.6, 2.5);                               // рад/с
    const k = rng.range(0.010, 0.019);                            // рад/px — длина волны 330…630 px
    const fromC = rng.chance(0.6), dir = rng.chance(0.5) ? 1 : -1;
    const Ys = rng.chance(0.7) ? rng.range(15, 40) : 0, ks = TAU / rng.range(420, 720), sph = rng.chance(0.5) ? 0 : Math.PI;
    const ph = bh + gy;
    const nr = clamp(6 + Math.floor(d / 2) + rng.int(0, 2), 5, Math.floor((B.B - B.T - 2 * A - 2 * Ys) / ph));
    const pattern = rng.pick(['full', 'noise', 'stripes', 'checker', 'vee']);
    const sc = rng.range(2, 3.5), thr = rng.range(0.38, 0.46);
    for (let c = 0; c < ncol; c++) {
      const x = CX + (c - (ncol - 1) / 2) * (cw + gx), ax = Math.abs(x - CX), au = ax / (CX - B.L);
      const y0 = B.T + A + Ys + bh / 2 + Ys * Math.cos(ks * ax + sph);
      const motion = A ? { type: 'liss', ax: 0, ay: A, fx: 0, fy: om, px: 0, py: fromC ? -k * ax : -dir * k * x } : null;
      for (let r = 0; r < nr; r++) {
        const v = r / Math.max(1, nr - 1);
        let keep = true;
        switch (pattern) {
          case 'full': keep = U.hash(r, Math.round(ax), 5) > 0.06; break;
          case 'noise': keep = noise(au * sc, v * sc) > thr; break;
          case 'stripes': keep = r % 3 !== 1; break;
          case 'checker': keep = (r + Math.round(ax / (cw + gx))) % 2 === 0 || r % 3 === 0; break;
          case 'vee': keep = Math.abs(v - au * 0.8) > 0.12; break;
        }
        if (!keep) continue;
        out.push({ local, circle, x, y: y0 + r * ph, ang: 0, key: [r, Math.round(ax / 10)], t: v, motion, grp: 'col' + c });
      }
    }
    return out;
  }

  // ---------- Конвейер: кирпичи едут по замкнутой петле, внутри — неподвижное ядро ----------
  function conveyor(rng, d, noise) {
    const out = [];
    const v = rng.range(55, 80) * (1 + Math.min(d, 10) * 0.03);
    const len = rng.pick([36, 40, 44]) * SZ, th = rng.pick([18, 20]) * SZ, gap = 6;
    const shape = rng.pick(['rect', 'pill', 'rect']);
    const loops = [];
    if (rng.chance(0.55)) loops.push({ cx: CX, cy: B.T + 205, hl: rng.range(125, 170), r: rng.range(85, 104), rot: 0, dir: rng.chance(0.5) ? 1 : -1 });
    else loops.push({ cx: CX - rng.range(150, 172), cy: B.T + 212, hl: rng.range(60, 82), r: rng.range(62, 72), rot: Math.PI / 2, dir: 1, sym: true });
    const gateN = rng.int(4, 7);
    loops.forEach((lp, k) => {
      const per = 4 * lp.hl + 2 * Math.PI * lp.r;
      // на изгибе внутренние углы кирпичей сходятся — шаг берём с запасом на это
      const ri = lp.r - th / 2, spMin = lp.r * (2 * Math.atan(len / 2 / ri) + gap / ri);
      const cnt = Math.floor(per / spMin), sp = per / cnt;
      for (let i = 0; i < cnt; i++) {
        if (i % gateN === gateN - 1) continue; // проёмы, через которые мяч попадает внутрь
        const s = { local: shape === 'pill' ? P.pill(len, th) : P.rect(len, th), x: 0, y: 0, ang: 0, key: [70 + k, i], t: i / cnt, prio: 1,
          motion: { type: 'track', cx: lp.cx, cy: lp.cy, hl: lp.hl, r: lp.r, rot: lp.rot, dir: lp.dir, v, s0: i * sp }, grp: 'loop' + k };
        if (lp.sym) pushSym(out, place(s)); else out.push(place(s));
      }
    });
    // фон: снаружи петель и ядро внутри них
    const all = loops.flatMap(lp => lp.sym ? [lp, Object.assign({}, lp, { cx: 2 * CX - lp.cx })] : [lp]);
    const ends = all.map(lp => {
      const c = Math.cos(lp.rot), s = Math.sin(lp.rot);
      return [lp.cx - lp.hl * c, lp.cy - lp.hl * s, lp.cx + lp.hl * c, lp.cy + lp.hl * s, lp.r];
    });
    const zone = (x, y, r) => {
      let res = 1;
      for (const e of ends) {
        const dd = segDist(x, y, e[0], e[1], e[2], e[3]);
        if (dd + r < e[4] - th / 2 - 12) return 2;
        if (dd - r < e[4] + th / 2 + 12) res = 0;
      }
      return res;
    };
    // снаружи — только выше нижнего края петель, ядро внутри — целиком
    const yLim = Math.max(...all.map(lp => lp.cy + Math.abs(Math.sin(lp.rot)) * lp.hl + lp.r));
    backdrop(out, rng, d, noise, (x, y, r) => { const z = Math.min(zone(x, y, r), zone(2 * CX - x, y, r)); return z === 1 && y > yLim ? 0 : z; });
    return out;
  }

  // ---------- Мишень: кольца из секторов, соседние кольца крутятся навстречу ----------
  function dartboard(rng, d, noise) {
    const out = [];
    const cy = B.T + 218, Rmax = 212;
    const R0 = rng.pick([24, 28]) * SZ;
    const th = rng.pick([32, 36, 40]) * SZ, gapR = 8, gapA = 6;
    const seg = rng.pick([58, 66, 74]) * SZ;
    const spd = d >= 2 ? rng.range(0.14, 0.3) * (1 + Math.min(d, 10) * 0.04) : 0;
    const mode = rng.pick(['alt', 'alt', 'all', 'outer']);
    const pattern = rng.pick(['full', 'full', 'spokes', 'holes']);
    let r0 = R0 + gapR, k = 0, rOut = R0;
    while (r0 + th <= Rmax) {
      const r1 = r0 + th;
      let nS = Math.max(4, Math.round((TAU * (r0 + r1)) / 2 / seg));
      while (r0 * (1 - Math.cos(Math.PI / nS)) > gapR - 2.5) nS++;
      const turns = spd && (mode === 'all' || (mode === 'alt' && k % 2 === 0) || (mode === 'outer' && r1 + th + gapR > Rmax));
      const w = turns ? spd * (k % 2 ? -1 : 1) * rng.range(0.8, 1.25) : 0;
      const off = rng.range(0, TAU), da = gapA / (2 * r0);
      for (let j = 0; j < nS; j++) {
        if (pattern === 'spokes' && k % 2 === 1 && j % 3 === 0) continue;
        if (pattern === 'holes' ? U.hash(k, j, 77) < 0.16 : U.hash(k, j, 77) < 0.05) continue;
        const poly = P.sector(r0, r1, off + (j * TAU) / nS + da, off + ((j + 1) * TAU) / nS - da);
        const [gx, gy] = P.centroid(poly);
        out.push({ x: CX + gx, y: cy + gy, local: P.centered(poly), ang: 0, key: [k + 1, j], t: k / 6,
          motion: w ? { type: 'orbit', cx: CX, cy, r: Math.hypot(gx, gy), a0: Math.atan2(gy, gx), w } : null });
      }
      rOut = r1; r0 = r1 + gapR; k++;
    }
    const eye = rng.pick(['crystal', 'explosive']);
    out.push({ x: CX, y: cy, circle: R0, local: P.ngon(24, R0), ang: 0, key: [0, 0], t: 0, kind: eye, hp: eye === 'crystal' ? 2 : 1 });
    backdrop(out, rng, d, noise, (x, y, r) => Math.hypot(x - CX, y - cy) - r > rOut + 14 ? 1 : 0, rng.pick(['hex', 'diamond']));
    return out;
  }

  // ---------- Пиксель-арт ----------
  // Картинки симметричны. Буквы: # — основной цвет, o и + — дополнительные, x — сталь, * — взрывчатка,
  // $ — кристалл. Цвет — RGB или сдвиг тона от тона уровня.
  const SPRITES = {
    invader: { pal: { '#': 0 }, rows: ['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'] },
    squid: { pal: { '#': 0.3 }, rows: ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'] },
    heart: { pal: { '#': [0.95, 0.2, 0.35], 'o': [1, 0.75, 0.82] }, rows: ['.###...###.', '#o###.###o#', '###########', '###########', '.#########.', '..#######..', '...#####...', '....###....', '.....#.....'] },
    skull: { pal: { '#': [0.92, 0.9, 0.84] }, rows: ['..#######..', '.#########.', '###########', '##xx###xx##', '##xx###xx##', '#####.#####', '.###.#.###.', '..#######..', '..#.#.#.#..'] },
    mushroom: { pal: { '#': [0.9, 0.16, 0.15], 'o': [0.97, 0.96, 0.92], '+': [0.96, 0.8, 0.6] }, rows: ['..########..', '.##oo##oo##.', '#oooo##oooo#', '#oo######oo#', '############', '...#+..+#...', '...#++++#...', '....####....'] },
    rocket: { pal: { '#': [0.84, 0.87, 0.93], 'o': [0.3, 0.62, 1], '+': [0.95, 0.25, 0.2] }, rows: ['....#....', '...###...', '...#o#...', '..##o##..', '..#ooo#..', '..##o##..', '..#####..', '.#+###+#.', '#++###++#', '#+.*.*.+#', '...*.*...'] },
    ghost: { pal: { '#': null, 'o': [0.96, 0.96, 1], 'x': [0.15, 0.25, 0.85] }, rows: ['....####....', '..########..', '.##########.', '.#oo####oo#.', '#oooo##oooo#', '#ooxx##xxoo#', '############', '############', '##.##..##.##', '#...#..#...#'] },
    crown: { pal: { '#': [1, 0.78, 0.18], 'o': [0.9, 0.15, 0.3] }, rows: ['o....$....o', '#...###...#', '##.#####.##', '###########', '#o#$#o#$#o#', '###########'] },
    ufo: { pal: { '#': [0.62, 0.68, 0.8], 'o': 0.5 }, rows: ['....#####....', '..#########..', '.##o##o##o##.', '#############', '..###...###..', '...#.....#...'] },
  };
  const GHOSTS = [[0.95, 0.2, 0.2], [1, 0.6, 0.85], [0.3, 0.9, 1], [1, 0.62, 0.2]];
  function pixel(rng, d) {
    const out = [];
    const sp = SPRITES[rng.pick(Object.keys(SPRITES))];
    const rows = sp.rows, h = rows.length, w = rows[0].length;
    const p = Math.min(Math.floor(620 / w), Math.floor(430 / h), 50), gap = 4;
    const W = w * p, H = h * p;
    const pal = Object.assign({}, sp.pal);
    if (pal['#'] === null) pal['#'] = rng.pick(GHOSTS);
    // спрайт поменьше марширует из стороны в сторону, как пришелец
    const amp = d >= 2 && rng.chance(0.6) ? Math.min(70, (B.R - B.L - W) / 2 - 6) : 0;
    const motion = amp > 10 ? { type: 'liss', ax: amp, ay: rng.chance(0.4) ? 8 : 0, fx: rng.range(0.45, 0.75), fy: rng.range(1.2, 1.8), px: 0, py: 0, rigid: true } : null;
    const y0 = B.T + 8 + Math.max(0, (B.B - B.T - H) * 0.3);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const ch = rows[r][c];
        const x = CX + (c - (w - 1) / 2) * p;
        if (ch === '.' || x > CX + 1) continue;
        const s = { local: P.rect(p - gap, p - gap), x, y: y0 + r * p + p / 2, ang: 0, key: [r, Math.round(Math.abs(x - CX))], t: r / h, motion, grp: motion ? 'sprite' : undefined };
        if (ch === 'x' && !pal.x) { s.kind = 'steel'; s.hp = 1; }
        else if (ch === '*') { s.kind = 'explosive'; s.hp = 1; }
        else if (ch === '$') { s.kind = 'crystal'; s.hp = 2; }
        else s.col = pal[ch];
        pushSym(out, s);
      }
    }
    return out;
  }

  // ---------- Паркет: дощечки ёлочкой или плетёнкой ----------
  // Ёлочка выкладывается от оси влево по правилу (i + j) mod 4: 0 — лежачая дощечка, 2 — стоячая; зеркальная
  // половина складывает её в шеврон.
  function parquet(rng, d, noise) {
    const out = [];
    const u = rng.pick([24, 26, 28]) * SZ, gap = 3;
    const style = rng.pick(['herring', 'herring', 'basket']);
    const cols = Math.floor((CX - B.L) / u);
    const rows = clamp(9 + Math.floor(d / 2) + rng.int(0, 2), 8, Math.floor((B.B - B.T) / u));
    const pattern = rng.pick(['full', 'noise', 'diamond', 'rings']);
    const sc = rng.range(2, 3.5), thr = rng.range(0.36, 0.44);
    // дощечка на клетках (ci, cj) размером wc × hc клеток; ci отсчитывается от оси влево
    const add = (ci, cj, wc, hc) => {
      const x = CX - (ci + wc / 2) * u, y = B.T + (cj + hc / 2) * u;
      const au = (CX - x) / (CX - B.L), v = (y - B.T) / (rows * u);
      let keep = true;
      switch (pattern) {
        case 'full': keep = U.hash(ci, cj, 13) > 0.05; break;
        case 'noise': keep = noise(au * sc, v * sc) > thr; break;
        case 'diamond': { const q = au + Math.abs(v - 0.5); keep = q < 0.95 && q > 0.25; break; }
        case 'rings': keep = Math.floor(Math.hypot(au, (v - 0.5) * 1.2) * 5) % 2 === 0; break;
      }
      if (keep) pushSym(out, { local: P.rect(wc * u - gap, hc * u - gap), x, y, ang: 0, key: [cj, ci], t: v });
    };
    if (style === 'herring') {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const m = (i + j) % 4;
        if (m === 0 && i + 1 < cols) add(i, j, 2, 1);
        else if (m === 2 && j + 1 < rows) add(i, j, 1, 2);
      }
    } else {
      for (let bj = 0; bj + 1 < rows; bj += 2) for (let bi = 0; bi + 1 < cols; bi += 2) {
        if ((bi + bj) / 2 % 2 === 0) { add(bi, bj, 2, 1); add(bi, bj + 1, 2, 1); }
        else { add(bi, bj, 1, 2); add(bi + 1, bj, 1, 2); }
      }
    }
    return out;
  }

  // ---------- Картина: стена-мозаика поверх полотна (art.js) ----------
  // Полотно портретное: высотой ART_H от верха раскладки, шириной — сколько выйдет при его пропорциях, по центру;
  // по бокам остаётся проход, которым мяч заходит за стену. Кирпичи почти квадратные, ART_COLS в ряд; каждый —
  // среднего цвета полотна под собой, только контрастнее по яркости (ART_CON, от средней яркости картины) и
  // насыщеннее (ART_SAT): средние цвета мелких кусков сливаются, и без этого букет на стене не узнать. Самый
  // светлый канал — не выше ART_MAX: почти белые кирпичи светились бы ореолом и сливались в одно пятно. Фаска
  // у них уже обычной (ART_BEVEL) — на маленьком кирпиче она съела бы половину цвета; у мелких кирпичей головок
  // живой картины (HEAD_BEVEL) ещё уже, иначе каждый — пирамидка, и пушистая головка выглядит колючей.
  // Из особых — только взрывные и кристаллы: сталь, броня и прочные кирпичи спрятали бы картину.
  //
  // Живая картина (artLive) — та же стена, но головки на ней живые (art.js → heads): каждая — свой подсолнух
  // из кирпичей (flower), который крутится или кивает на стебле целиком. Клетку стены, которую головка задела бы,
  // заменяют четвертинки — те из них, что не задевают; в щелях видно полотно, а оно под головкой поворачивается
  // вместе с ней (draw.js).
  const ART_H = 480, ART_COLS = 14, ART_CON = 1.7, ART_SAT = 1.35, ART_MAX = 0.88, ART_BEVEL = 3, HEAD_BEVEL = 1.5;
  const lum = c => 0.3 * c[0] + 0.5 * c[1] + 0.2 * c[2];
  // Цвет кирпича над прямоугольником полотна [u0, u1] × [v0, v1]; lm — средняя яркость картины
  function artColor(id, lm, u0, v0, u1, v1) {
    let col = AK.Art.avg(id, u0, v0, u1, v1);
    const l = lum(col), k = Math.max(0.03, lm + (l - lm) * ART_CON) / Math.max(l, 1e-3);
    col = col.map(v => v * k);
    const m = (col[0] + col[1] + col[2]) / 3;
    col = col.map(v => clamp(m + (v - m) * ART_SAT, 0, 1));
    const top = Math.max(...col, ART_MAX);
    return col.map(v => (v * ART_MAX) / top);
  }
  function artWall(rng, live) {
    const out = [];
    const id = AK.Art.ids[0], p = AK.Art.get(id);
    const w = ART_H * p.aspect, x0 = CX - w / 2, y0 = B.T;
    const rows = Math.round((ART_COLS * ART_H) / w), cw = w / ART_COLS, ch = ART_H / rows, gap = 3;
    const local = P.rect(cw - gap, ch - gap), lm = lum(AK.Art.avg(id, 0, 0, 1, 1));
    const heads = live ? p.heads.map((hd, i) => head(rng, hd, i, w / p.ref, x0, y0, out)) : null;
    // задела бы головка прямоугольник hw × hh с центром (x, y): расстояние от её центра до прямоугольника
    const hit = (x, y, hw, hh) => heads && heads.some(hd =>
      Math.hypot(Math.max(Math.abs(hd.cx - x) - hw, 0), Math.max(Math.abs(hd.cy - y) - hh, 0)) < hd.sweep + GAP);
    const quarter = P.rect(cw / 2 - gap, ch / 2 - gap);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < ART_COLS; c++) {
        const x = x0 + (c + 0.5) * cw, y = y0 + (r + 0.5) * ch;
        if (hit(x, y, (cw - gap) / 2, (ch - gap) / 2)) {
          for (let q = 0; q < 4; q++) {
            const qc = c + 0.25 + 0.5 * (q & 1), qr = r + 0.25 + 0.5 * (q >> 1);
            const qx = x0 + qc * cw, qy = y0 + qr * ch;
            if (hit(qx, qy, (cw / 2 - gap) / 2, (ch / 2 - gap) / 2)) continue;
            out.push({ local: quarter, x: qx, y: qy, ang: 0, key: [r, c * 4 + q + 100], t: r / rows, kind: 'normal', hp: 1, bevel: HEAD_BEVEL,
              col: artColor(id, lm, (qc - 0.25) / ART_COLS, (qr - 0.25) / rows, (qc + 0.25) / ART_COLS, (qr + 0.25) / rows) });
          }
          continue;
        }
        const s = { local, x, y, ang: 0, key: [r, c], t: r / rows,
          col: artColor(id, lm, c / ART_COLS, r / rows, (c + 1) / ART_COLS, (r + 1) / rows), kind: 'normal', hp: 1, bevel: ART_BEVEL };
        const h = rng();
        if (h < 0.03) { s.kind = 'explosive'; s.hp = 1; }
        else if (h < 0.05) { s.kind = 'crystal'; s.hp = 2; }
        out.push(s);
      }
    }
    out.art = { id, x: x0, y: y0, w, h: ART_H, heads };
    return out;
  }
  // генераторы зовутся с (rng, d, noise) — третий параметр у стены свой
  const art = rng => artWall(rng, false), artLive = rng => artWall(rng, true);

  // Головка hd живой картины (координаты снимка, sc — масштаб снимка к полю): кирпичи — в out, возвращает,
  // где она и как движется: центр cx, cy, радиус R, движение m (orbit без r и a0 — у кирпичей они свои), вид look
  // и sweep — радиус круга вокруг центра, который она заметает. Крутится — вокруг своего центра, в сторону
  // и со скоростью от сида; кивает — вокруг точки стебля, на 3,5–5,5° туда-обратно за 4–5 с. Цвета у головки свои
  // (flower), и наполовину (HEAD_GLOW) она светится сама: в ровном свете без собственного подсолнухи тусклые.
  const HEAD_GLOW = 0.45;
  function head(rng, hd, i, sc, x0, y0, out) {
    const cx = x0 + hd.x * sc, cy = y0 + hd.y * sc, R = hd.r * sc;
    const nod = hd.px != null, px = nod ? x0 + hd.px * sc : cx, py = nod ? y0 + hd.py * sc : cy;
    const m = nod ? { type: 'orbit', cx: px, cy: py, w: 0, amp: rng.range(0.06, 0.095), f: rng.range(1.25, 1.6), ph: rng.range(0, TAU) }
      : { type: 'orbit', cx, cy, w: hd.w * rng.range(0.85, 1.15) * (rng.chance(0.5) ? 1 : -1) };
    const look = flower(cx, cy, R, hd, rng, (x, y, local, ang, col, extra) => {
      out.push(place(Object.assign({
        x, y, local, ang, key: [60 + i, out.length], t: 0.5, grp: 'head' + i, prio: 1, kind: 'normal', hp: 1, bevel: HEAD_BEVEL,
        col, glow: HEAD_GLOW, motion: Object.assign({}, m, { r: Math.hypot(x - px, y - py), a0: Math.atan2(y - py, x - px) }),
      }, extra)));
    });
    return { cx, cy, R, m, look, sweep: R + 2 + (nod ? m.amp * Math.hypot(cx - px, cy - py) : 0) };
  }

  // Подсолнух радиуса R из кирпичей с центром (cx, cy). Они на живой картине разные (art.js → heads, look):
  //   seeds  — серединка из круглых семечек кольцами, по краю длинные острые лепестки;
  //   fluffy — махровый: кольца секторов вперебежку, от серединки к краю всё желтее, лепестков не видно;
  //   double — два ряда лепестков: внутренние короткие и широкие, наружные длинные и острые, между ними;
  //   star   — крупная серединка и один ряд широких лепестков;
  //   button — пуговка: серединка и кольцо секторов; такой выходит и любая головка меньше BUTTON_R.
  // Цвета свои, светлее и желтее полотна (там головки охристые, и в стене выходили почти чёрными): серединка —
  // CORE[core], лепестки — от лимонных до золотых (оттенок от сида), каждый кирпич чуть светлее или темнее
  // соседа. add(x, y, local, ang, col, extra) кладёт кирпич; возвращает вид, который вышел.
  const CORE = { orange: [1, 0.5, 0.1], amber: [0.95, 0.66, 0.14], green: [0.5, 0.74, 0.2], brown: [0.78, 0.4, 0.12] };
  const LEMON = [1, 0.9, 0.28], GOLD = [1, 0.7, 0.1], BUTTON_R = 24;
  const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function flower(cx, cy, R, hd, rng, add) {
    const gap = 3, off = rng.range(0, TAU), core = CORE[hd.core] || CORE.amber, petal = mix3(LEMON, GOLD, rng());
    const look = R < BUTTON_R ? 'button' : hd.look;
    const tint = c => { const f = rng.range(0.9, 1.08); return c.map(v => clamp(v * f, 0, 1)); };
    const at = (r, a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const hub = r => add(cx, cy, P.ngon(12, r), 0, tint(core), { circle: r });
    // кольца секторов от r0 до r1, по ~th толщиной; col(l, nr) — цвет кольца l из nr; соседние — вперебежку
    const rings = (r0, r1, th, col) => {
      const nr = Math.max(1, Math.round((r1 - r0 + gap) / (th + gap))), t = (r1 - r0 - gap * (nr - 1)) / nr;
      for (let l = 0, a0 = r0; l < nr; l++, a0 += t + gap) {
        const n = Math.max(5, Math.round((Math.PI * (2 * a0 + t)) / (t * 1.3))), da = gap / (2 * a0), a = off + (l * Math.PI) / n;
        for (let j = 0; j < n; j++) {
          const poly = P.sector(a0, a0 + t, a + (j * TAU) / n + da, a + ((j + 1) * TAU) / n - da);
          const [gx, gy] = P.centroid(poly);
          add(cx + gx, cy + gy, P.centered(poly), 0, tint(col(l, nr)));
        }
      }
    };
    // ряд лепестков от радиуса p0 длиной L, повёрнутый на a: у основания впритык (не уже 5 px), к концу сужаются
    // до доли taper
    const petals = (p0, L, a, taper, col) => {
      const n = Math.max(6, Math.min(Math.round((TAU * p0) / Math.max(L * 0.75, 8)), Math.floor((TAU * p0) / (5 + gap))));
      const wb = (TAU * p0) / n - gap;
      for (let j = 0; j < n; j++) {
        const b = a + ((j + 0.5) * TAU) / n, [x, y] = at(p0 + L / 2, b);
        add(x, y, P.rot(P.trap(wb, wb * taper, L), Math.PI / 2), b, tint(col));
      }
      return n;
    };
    switch (look) {
      case 'seeds': {
        // семечки — кружки радиуса rs кольцами, через одно кольцо светлее
        const rh = Math.max(4, R * 0.14), rs = Math.max(2.6, R * 0.08), sg = 1.5;
        hub(rh);
        let edge = rh;
        for (let k = 0, r = rh + gap; r + 2 * rs <= R * 0.6; r += 2 * rs + sg, k++) {
          const rc = r + rs, n = Math.floor((TAU * rc) / (2 * rs + sg)), a = off + k * 0.7;
          const col = k % 2 ? mix3(core, GOLD, 0.4) : core;
          for (let j = 0; j < n; j++) { const [x, y] = at(rc, a + (j * TAU) / n); add(x, y, P.ngon(8, rs), 0, tint(col), { circle: rs }); }
          edge = r + 2 * rs;
        }
        petals(edge + gap, R - edge - gap, off, 0.25, petal);
        break;
      }
      case 'fluffy': {
        const rh = Math.max(5, R * 0.2), inner = mix3(core, GOLD, 0.4);
        hub(rh);
        rings(rh + gap, R, 7.5, (l, nr) => mix3(inner, petal, nr > 1 ? l / (nr - 1) : 1));
        break;
      }
      case 'double': {
        const rh = Math.max(5, R * 0.3), p0 = rh + gap, L1 = (R - p0) * 0.4;
        hub(rh);
        const n = petals(p0, L1, off, 0.65, mix3(petal, GOLD, 0.6));
        petals(p0 + L1 + gap, R - p0 - L1 - gap, off + Math.PI / n, 0.3, petal);
        break;
      }
      case 'star': {
        const rh = R * 0.42;
        hub(rh);
        petals(rh + gap, R - rh - gap, off, 0.75, petal);
        break;
      }
      default: { // button
        const rh = Math.max(5, R * 0.32);
        hub(rh);
        rings(rh + gap, R, 10, () => petal);
      }
    }
    return look;
  }

  // ---------- Проверка подвижных кирпичей ----------
  // Подвижный кирпич не должен задевать соседей и выезжать за стены. Генераторы раскладывают их с запасом,
  // а здесь это проверяется: путь каждого прогоняется на SETTLE_T с вперёд, и из задевающей пары убирается
  // неподвижный (механизм важнее фона), из двух подвижных — тот, что позже. Кирпичи одной жёсткой группы
  // (спицы одного колеса, звенья одного маятника, ряд, едущий целиком) друг относительно друга не движутся.
  // Проверка быстрая: если один из пары вращается вокруг точки (орбита, вращение на месте), а другой стоит или
  // вращается вокруг той же точки, расстояния их точек до неё не меняются — хватает сравнить кольца, которые они
  // заметают. Кирпич конвейера не отходит от средней линии петли дальше своего радиуса. Если же оба
  // не поворачиваются, а только сдвигаются, проекции их форм на оси разделения считаются один раз.
  const SETTLE_T = 60, SETTLE_DT = 0.05;
  const FIELD = { L: 18, R: 702, T: 76, B: 620 };
  const GAP = 2;
  const turns = m => m && (m.type === 'orbit' || m.type === 'spin' || m.type === 'swing' || m.type === 'track' || (m.type === 'liss' && m.w));
  // Центр, вокруг которого кирпич вращается, не меняя расстояний до него
  const pivotOf = s => !s.motion ? null : s.motion.type === 'orbit' ? [s.motion.cx, s.motion.cy] : s.motion.type === 'spin' ? [s.x, s.y] : null;
  // Ближайшее и дальнейшее расстояние от точки c до кирпича в начальном положении
  function radial(it, c) {
    const s = it.s, p = s.motion ? P.pose(s.motion, s.x, s.y, s.ang || 0, 0, pz) : null;
    const x = p ? p.x : s.x, y = p ? p.y : s.y;
    if (s.circle) { const dd = Math.hypot(x - c[0], y - c[1]); return [Math.max(0, dd - s.circle), dd + s.circle]; }
    const v = P.transform(s.local, x, y, p ? p.ang : s.ang || 0, wa.subarray(0, s.local.length));
    const n = v.length / 2;
    let lo = Infinity, hi = 0, inside = true;
    const o = Math.sign(P.signedArea(v)) || 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      hi = Math.max(hi, Math.hypot(v[i * 2] - c[0], v[i * 2 + 1] - c[1]));
      lo = Math.min(lo, segDist(c[0], c[1], v[i * 2], v[i * 2 + 1], v[j * 2], v[j * 2 + 1]));
      if (o * ((v[j * 2] - v[i * 2]) * (c[1] - v[i * 2 + 1]) - (v[j * 2 + 1] - v[i * 2 + 1]) * (c[0] - v[i * 2])) < 0) inside = false;
    }
    return [inside ? 0 : lo, hi];
  }
  // Оси разделения и проекции на них для пары не поворачивающихся кирпичей (относительно их центров)
  function axesOf(a, b) {
    const va = P.transform(a.s.local, 0, 0, a.s.ang || 0, wa.subarray(0, a.s.local.length));
    const vb = P.transform(b.s.local, 0, 0, b.s.ang || 0, wb.subarray(0, b.s.local.length));
    const ax = [], dirs = [1, 0, 0, 1]; // ещё и оси поля: по ним расходятся ряды и столбцы
    for (const v of [va, vb]) {
      const n = v.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        dirs.push(v[j * 2 + 1] - v[i * 2 + 1], v[i * 2] - v[j * 2]);
      }
    }
    for (let i = 0; i < dirs.length; i += 2) {
      const l = Math.hypot(dirs[i], dirs[i + 1]) || 1, nx = dirs[i] / l, ny = dirs[i + 1] / l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let q = 0; q < va.length; q += 2) { const p = va[q] * nx + va[q + 1] * ny; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
      for (let q = 0; q < vb.length; q += 2) { const p = vb[q] * nx + vb[q + 1] * ny; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
      ax.push(nx, ny, a0, a1, b0, b1);
    }
    return ax;
  }
  function groupOf(s) {
    if (s.grp != null) return s.grp;
    const m = s.motion;
    if (!m) return 'static';
    switch (m.type) {
      case 'orbit': return `o${m.cx},${m.cy},${m.w}`;
      case 'slide': return `s${m.amp},${m.f},${m.ph}`;
      case 'swing': return `w${m.px},${m.py},${m.a},${m.f},${m.ph}`;
      case 'track': return `t${m.cx},${m.cy},${m.hl},${m.r},${m.v},${m.dir},${m.rot}`;
      case 'liss': if (!m.w) return `l${m.ax},${m.ay},${m.fx},${m.fy},${m.px},${m.py}`;
    }
    return `u${s.x},${s.y}`;
  }
  const wa = new Float32Array(128), wb = new Float32Array(128), pz = {};
  const NS = Math.round(SETTLE_T / SETTLE_DT);
  // Прямоугольник, который за всё время заметает центр кирпича
  function sweep(s) {
    const m = s.motion;
    switch (m.type) {
      case 'orbit': return [m.cx - m.r, m.cx + m.r, m.cy - m.r, m.cy + m.r];
      case 'slide': return [s.x - Math.abs(m.amp), s.x + Math.abs(m.amp), s.y, s.y];
      case 'liss': return [s.x - Math.abs(m.ax), s.x + Math.abs(m.ax), s.y - Math.abs(m.ay), s.y + Math.abs(m.ay)];
      case 'swing': {
        const a = Math.min(Math.abs(m.a), Math.PI / 2), sw = m.l * Math.sin(a);
        return [m.px - sw, m.px + sw, m.py + m.l * Math.cos(a), m.py + m.l];
      }
      case 'track': {
        const c = Math.abs(Math.cos(m.rot || 0)), sn = Math.abs(Math.sin(m.rot || 0)), hx = m.hl + m.r;
        const ex = hx * c + m.r * sn, ey = hx * sn + m.r * c;
        return [m.cx - ex, m.cx + ex, m.cy - ey, m.cy + ey];
      }
    }
    return [s.x, s.x, s.y, s.y];
  }
  // Путь кирпича — x, y, угол через SETTLE_DT; считается, только когда понадобился
  function pathOf(it) {
    if (it.path) return it.path;
    const s = it.s, path = it.path = new Float32Array(NS * 3);
    for (let q = 0; q < NS; q++) {
      const p = P.pose(s.motion, s.x, s.y, s.ang || 0, q * SETTLE_DT, pz);
      path[q * 3] = p.x; path[q * 3 + 1] = p.y; path[q * 3 + 2] = p.ang;
    }
    return path;
  }
  function settle(out) {
    const info = out.map(s => {
      const rad = Math.max(P.radius(s.local), s.circle || 0);
      const [x0, x1, y0, y1] = s.motion ? sweep(s) : [s.x, s.x, s.y, s.y];
      const it = { s, rad, grp: groupOf(s), mov: !!s.motion, drop: false, path: null, x0, x1, y0, y1 };
      if (it.mov && (x0 - rad < FIELD.L || x1 + rad > FIELD.R || y0 - rad < FIELD.T || y1 + rad > FIELD.B)) it.drop = true;
      return it;
    });
    const n = info.length;
    for (const it of info) it.pivot = pivotOf(it.s);
    const near = (p, c) => p && Math.abs(p[0] - c[0]) < 0.01 && Math.abs(p[1] - c[1]) < 0.01;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = info[i], b = info[j];
        if (a.drop || b.drop || (!a.mov && !b.mov) || a.grp === b.grp) continue;
        const rr = a.rad + b.rad + GAP;
        if (a.x0 - rr > b.x1 || b.x0 - rr > a.x1 || a.y0 - rr > b.y1 || b.y0 - rr > a.y1) continue;
        const c = a.pivot || b.pivot;
        if (c && (!a.mov || near(a.pivot, c)) && (!b.mov || near(b.pivot, c))) {
          const ra = radial(a, c), rb = radial(b, c);
          if (rb[0] - ra[1] >= GAP || ra[0] - rb[1] >= GAP) continue;
        }
        const tk = a.s.motion && a.s.motion.type === 'track' ? a : b.s.motion && b.s.motion.type === 'track' ? b : null;
        if (tk && !(tk === a ? b : a).mov) {
          const m = tk.s.motion, o = tk === a ? b : a, cs = Math.cos(m.rot || 0), sn = Math.sin(m.rot || 0);
          const dd = segDist(o.s.x, o.s.y, m.cx - m.hl * cs, m.cy - m.hl * sn, m.cx + m.hl * cs, m.cy + m.hl * sn);
          if (Math.abs(dd - m.r) - o.rad - tk.rad >= GAP) continue;
        }
        const ax = !turns(a.s.motion) && !turns(b.s.motion) ? axesOf(a, b) : null;
        // не поворачиваются: смещение b от a не выходит из прямоугольника, и если по какой-то оси пара разделена
        // при любом смещении из него (ряд, качающийся вбок, над неподвижным рядом), проверять нечего
        if (ax) {
          const dx0 = b.x0 - a.x1, dx1 = b.x1 - a.x0, dy0 = b.y0 - a.y1, dy1 = b.y1 - a.y0;
          let apart = false;
          for (let k = 0; k < ax.length && !apart; k += 6) {
            const nx = ax[k], ny = ax[k + 1];
            const o0 = Math.min(dx0 * nx, dx1 * nx) + Math.min(dy0 * ny, dy1 * ny), o1 = Math.max(dx0 * nx, dx1 * nx) + Math.max(dy0 * ny, dy1 * ny);
            apart = ax[k + 4] + o0 - ax[k + 3] >= GAP || ax[k + 2] - ax[k + 5] - o1 >= GAP;
          }
          if (apart) continue;
        }
        const la = a.s.local.length, lb = b.s.local.length;
        const pa = a.mov ? pathOf(a) : null, pb = b.mov ? pathOf(b) : null;
        for (let q = 0; q < NS; q++) {
          const px = pa ? pa[q * 3] : a.s.x, py = pa ? pa[q * 3 + 1] : a.s.y;
          const qx = pb ? pb[q * 3] : b.s.x, qy = pb ? pb[q * 3 + 1] : b.s.y;
          if ((px - qx) ** 2 + (py - qy) ** 2 >= rr * rr) continue;
          let hit;
          if (ax) {
            hit = true;
            for (let k = 0; k < ax.length; k += 6) {
              const off = (qx - px) * ax[k] + (qy - py) * ax[k + 1];
              if (ax[k + 4] + off - ax[k + 3] >= GAP || ax[k + 2] - ax[k + 5] - off >= GAP) { hit = false; break; }
            }
          } else {
            const va = P.transform(a.s.local, px, py, pa ? pa[q * 3 + 2] : a.s.ang || 0, wa.subarray(0, la));
            const vb = P.transform(b.s.local, qx, qy, pb ? pb[q * 3 + 2] : b.s.ang || 0, wb.subarray(0, lb));
            hit = P.overlap(va, vb, GAP);
          }
          if (!hit) continue;
          const ka = (a.s.prio || 0) + (a.mov ? 1 : 0), kb = (b.s.prio || 0) + (b.mov ? 1 : 0);
          (kb <= ka ? b : a).drop = true;
          break;
        }
      }
    }
    settle.dropped = info.filter(it => it.drop).length;
    return info.filter(it => !it.drop).map(it => it.s);
  }

  const GENS = { grid, honeycomb, triangles, rings, spiral, mosaic, fortress, wave, dartboard, pixel, parquet, mechanism, pendulums, conveyor, art, artLive };
  const NAMES_RU = {
    grid: 'Кладка', honeycomb: 'Соты', triangles: 'Призмы', rings: 'Кольца',
    spiral: 'Галактика', mosaic: 'Мозаика', fortress: 'Крепость', wave: 'Волна', dartboard: 'Мишень',
    pixel: 'Пиксели', parquet: 'Паркет', mechanism: 'Механизм', pendulums: 'Маятники', conveyor: 'Конвейер', art: 'Картина', artLive: 'Живая картина',
  };

  // Особые кирпичи появляются с ростом уровня (d — номер уровня от нуля):
  //   steel — неразрушимая сталь; explosive — взрывается и рушит соседей;
  //   crystal — в два удара, всегда роняет бонус; glass — бьётся с одного касания, и мяч пролетает насквозь;
  //   armor — одни рёбра в стальной броне (удар в них отскакивает), остальные бьются; regen — живой: не добитый
  //   за пару секунд, зарастает трещиной; phase — призрак: то есть, то нет, и тогда мяч проходит сквозь него.
  // Хэш для выбора особых кирпичей. Ключи бывают и расстояниями в пикселях с постоянным шагом, а на таких
  // U.hash даёт полосы (ряд из одних взрывных) — здесь перемешивание сильнее.
  const fmix = h => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return h ^ (h >>> 16); };
  const hash3 = (a, b, c) => (fmix(fmix(fmix(a | 0) + (b | 0)) + (c | 0)) >>> 0) / 4294967296;
  function kindOf(h, h2, d, boost) {
    const table = [
      ['steel', d < 3 ? 0 : Math.min(0.025 + 0.01 * d, 0.1), 1],
      ['explosive', 0.03 + Math.min(0.005 * d, 0.03), 1],
      ['crystal', d < 1 ? 0 : 0.025, 2],
      ['glass', d < 1 ? 0 : Math.min(0.03 + 0.01 * d, 0.09), 1],
      ['armor', Math.min(0.09 + 0.01 * d, 0.18), d >= 6 && h2 < 0.5 ? 2 : 1],
      ['regen', d < 4 ? 0 : Math.min(0.02 + 0.008 * d, 0.07), d >= 7 && h2 < 0.4 ? 3 : 2],
      ['phase', d < 5 ? 0 : Math.min(0.015 + 0.007 * d, 0.06), 1],
    ];
    let acc = 0;
    for (const [kind, p, hp] of table) { acc += p; if (h < acc) return [kind, hp]; }
    const pStrong = Math.min((0.08 + 0.05 * d) * boost, 0.6);
    if (h < acc + pStrong * (1 - acc)) return ['strong', d >= 5 && h2 < 0.4 ? 3 : 2];
    return ['normal', 1];
  }
  // Бронированные рёбра: те, чья внешняя нормаль смотрит вниз (к ракетке — бить сверху), вверх (бить снизу) или,
  // изредка, от оси поля; у поворачивающегося кирпича — половина рёбер подряд. На круге броню не различить — он
  // остаётся без неё.
  // Неподвижному кирпичу броня не достаётся, если к открытым рёбрам мячу не подлететь — их заслоняет сталь
  // (walls — неподвижные стальные многоугольники) или стенка: такой кирпич не разбить.
  function armorOf(s, h, walls) {
    if (s.circle) return null;
    const v = s.local, n = v.length / 2, o = Math.sign(P.signedArea(v)) || 1;
    const rule = turns(s.motion) ? 'half' : Math.abs(s.x - CX) < 2 ? (h < 0.5 ? 'down' : 'up') : h < 0.45 ? 'down' : h < 0.9 ? 'up' : 'out';
    const c = Math.cos(s.ang || 0), sn = Math.sin(s.ang || 0), side = Math.sign(s.x - CX);
    const a = [];
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ex = v[j * 2] - v[i * 2], ey = v[j * 2 + 1] - v[i * 2 + 1], l = Math.hypot(ex, ey) || 1;
      const lx = (o * ey) / l, ly = (-o * ex) / l, nx = lx * c - ly * sn, ny = lx * sn + ly * c;
      const on = rule === 'half' ? i < n / 2 : rule === 'down' ? ny > 0.5 : rule === 'up' ? ny < -0.5 : nx * side > 0.5;
      a.push(on);
      if (on) cnt++;
    }
    if (!cnt || cnt === n) return null;
    return s.motion || a.some((on, i) => !on && reachable(s, i, walls)) ? a : null;
  }
  // Может ли мяч коснуться ребра i неподвижного кирпича s хоть где-то: у трети, середины, двух третей ребра
  const BALL_R = 8;
  function reachable(s, i, walls) {
    const w = P.transform(s.local, s.x, s.y, s.ang || 0, new Float32Array(s.local.length)), n = w.length / 2;
    const o = Math.sign(P.signedArea(w)) || 1, j = (i + 1) % n;
    const ex = w[j * 2] - w[i * 2], ey = w[j * 2 + 1] - w[i * 2 + 1], l = Math.hypot(ex, ey) || 1;
    const nx = (o * ey) / l, ny = (-o * ex) / l;
    for (const f of [0.25, 0.5, 0.75]) {
      const x = w[i * 2] + ex * f + nx * (BALL_R + 1.5), y = w[i * 2 + 1] + ey * f + ny * (BALL_R + 1.5);
      if (x < FIELD.L + BALL_R || x > FIELD.R - BALL_R || y < FIELD.T + BALL_R) continue;
      if (!walls.some(v => P.circleVsPoly(x, y, BALL_R, v.w, v.o))) return true;
    }
    return false;
  }

  // ---------- Сталь не запирает бьющиеся кирпичи ----------
  // Заливаем от ракетки сетку центров мяча (шаг OPEN_CS); препятствия — стены и неподвижная сталь, раздутые на
  // радиус мяча с запасом OPEN_PAD: проход уже 2·(BALL_R + OPEN_PAD) мяч почти не находит, его считаем
  // закрытым. Пока есть неподвижные бьющиеся кирпичи, которых залитое не касается, сталь на краю залитого,
  // ближайшая к ним, становится прочным кирпичом — с зеркальной парой; сначала случайная сталь, потом
  // заложенная раскладкой. Взрывы сталь не берут, так что иначе запертое не разбить никогда.
  const OPEN_CS = 6, OPEN_GW = 720 / OPEN_CS, OPEN_GH = 960 / OPEN_CS, OPEN_PAD = 10;
  function openUp(raw, kinds) {
    const R = BALL_R + OPEN_PAD;
    const box = s => {
      const w = P.transform(s.local, s.x, s.y, s.ang || 0, new Float32Array(s.local.length));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < w.length; i += 2) { x0 = Math.min(x0, w[i]); x1 = Math.max(x1, w[i]); y0 = Math.min(y0, w[i + 1]); y1 = Math.max(y1, w[i + 1]); }
      return { w, o: Math.sign(P.signedArea(w)) || 1, x0, x1, y0, y1 };
    };
    // клетки, центры которых ближе r к кирпичу; fn(c) → true прерывает обход
    const cells = (b, r, fn) => {
      const gx0 = Math.max(0, Math.floor((b.x0 - r) / OPEN_CS)), gx1 = Math.min(OPEN_GW - 1, Math.ceil((b.x1 + r) / OPEN_CS));
      const gy0 = Math.max(0, Math.floor((b.y0 - r) / OPEN_CS)), gy1 = Math.min(OPEN_GH - 1, Math.ceil((b.y1 + r) / OPEN_CS));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++)
        if (P.circleVsPoly((gx + 0.5) * OPEN_CS, (gy + 0.5) * OPEN_CS, r, b.w, b.o) && fn(gy * OPEN_GW + gx)) return true;
      return false;
    };
    const boxes = raw.map(s => (s.motion ? null : box(s)));
    const blk = new Uint8Array(OPEN_GW * OPEN_GH), seen = new Uint8Array(OPEN_GW * OPEN_GH), q = new Int32Array(OPEN_GW * OPEN_GH);
    for (let it = 0; it < 24; it++) {
      blk.fill(0); seen.fill(0);
      for (let gy = 0; gy < OPEN_GH; gy++) for (let gx = 0; gx < OPEN_GW; gx++) {
        const x = (gx + 0.5) * OPEN_CS, y = (gy + 0.5) * OPEN_CS;
        if (x < FIELD.L - 2 + R || x > FIELD.R + 2 - R || y < FIELD.T - 4 + R) blk[gy * OPEN_GW + gx] = 1;
      }
      raw.forEach((s, i) => { if (boxes[i] && kinds[i][0] === 'steel') cells(boxes[i], R, c => { blk[c] = 1; }); });
      let h = 0, t = 0;
      q[t++] = Math.floor(850 / OPEN_CS) * OPEN_GW + Math.floor(CX / OPEN_CS); seen[q[0]] = 1;
      while (h < t) {
        const c = q[h++], cx = c % OPEN_GW;
        for (const n of [cx + 1 < OPEN_GW ? c + 1 : -1, cx > 0 ? c - 1 : -1, c + OPEN_GW, c - OPEN_GW])
          if (n >= 0 && n < seen.length && !seen[n] && !blk[n]) { seen[n] = 1; q[t++] = n; }
      }
      // кирпич открыт, если залитое подходит к нему на касание мяча (а не только краем раздутой стали)
      const shut = raw.filter((s, i) => boxes[i] && kinds[i][0] !== 'steel' && !cells(boxes[i], BALL_R + OPEN_CS, c => seen[c] === 1));
      if (!shut.length) return;
      let best = -1, bd = Infinity;
      raw.forEach((s, i) => {
        if (!boxes[i] || kinds[i][0] !== 'steel' || !cells(boxes[i], R + OPEN_CS, c => seen[c] === 1)) return;
        let dd = Infinity;
        for (const u of shut) dd = Math.min(dd, Math.hypot(u.x - s.x, u.y - s.y));
        if (s.kind === 'steel') dd += 200;
        if (dd < bd) { bd = dd; best = i; }
      });
      if (best < 0) return;
      const sb = raw[best];
      raw.forEach((s, i) => {
        if (i === best || (Math.abs(s.x - (2 * CX - sb.x)) < 1 && Math.abs(s.y - sb.y) < 1 && kinds[i][0] === 'steel' && boxes[i])) kinds[i] = ['strong', 2];
      });
    }
  }
  function colorFor(kind, hue) {
    switch (kind) {
      case 'steel': return [0.56, 0.6, 0.68];
      case 'explosive': return [1.0, 0.33, 0.08];
      case 'strong': return U.hsl(hue, 0.62, 0.4);
      case 'glass': return U.mix3(U.hsl(hue, 0.7, 0.75), [0.85, 0.95, 1], 0.55);
      case 'regen': return U.hsl(0.36 + 0.05 * Math.sin(hue * TAU), 0.7, 0.42);
      case 'crystal': return U.hsl(hue + 0.5, 0.85, 0.66);
      case 'phase': return U.mix3(U.hsl(hue, 0.5, 0.7), [0.78, 0.74, 1], 0.6);
      default: return U.hsl(hue, 0.8, 0.56); // обычные и бронированные
    }
  }
  // Цвет кирпича; у пиксель-арта свой (RGB или сдвиг тона), если кирпич не особый
  function brickColor(s, kind, hue, base) {
    if (s.col == null || !(kind === 'normal' || kind === 'strong' || kind === 'armor')) return colorFor(kind, hue);
    const c = typeof s.col === 'number' ? U.hsl(base + s.col, 0.8, 0.56) : s.col;
    return kind === 'strong' ? c.map(x => x * 0.72) : c;
  }

  function pickGen(level, rng, prev) {
    if (level === 1) return 'grid';
    // пока картина одна: на втором уровне — стена-мозаика над ней, на третьем она оживает (а четвёртый — босс)
    if (level === 2) return 'art';
    if (level === 3) return 'artLive';
    const opts = [['grid', 0.6], ['honeycomb', 0.8], ['triangles', 0.7], ['rings', 0.9], ['spiral', 0.8], ['mosaic', 1],
      ['fortress', level >= 4 ? 0.7 : 0], ['wave', 1], ['dartboard', 1], ['pixel', 0.9], ['parquet', 0.8],
      ['mechanism', 1.2], ['pendulums', 1.1], ['conveyor', level >= 5 ? 1.1 : 0]].filter(o => o[0] !== prev && o[1] > 0);
    return rng.weighted(opts);
  }

  AK.LevelGen = {
    bounds: B,
    generate(level, baseSeed, prevGen, forceGen) {
      const seedInt = U.seedFrom(baseSeed, level);
      const rng = U.rng(seedInt);
      if (AK.Boss && AK.Boss.isLevel(level) && !forceGen) {
        const boss = AK.Boss.create(level, rng);
        return { bricks: boss.specs, gen: 'boss', seedInt, title: 'Босс', name: boss.name, c1: boss.c1, c2: boss.c2, rng, boss };
      }
      const d = level - 1;
      const hue = rng();
      const spread = rng.range(0.15, 0.45) * (rng.chance(0.5) ? 1 : -1);
      let gen, bricks, art = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        gen = forceGen || (attempt < 5 ? pickGen(level, rng, prevGen) : 'grid');
        const noise = U.noise(rng);
        const specs = GENS[gen](rng, d, noise);
        art = specs.art || null; // полотно под стеной: какое и где
        const raw = settle(specs);
        const kinds = raw.map(s => {
          if (s.kind) return [s.kind, s.hp];
          const k = kindOf(hash3(seedInt, s.key[0], s.key[1]), hash3(seedInt + 1, s.key[0], s.key[1]), d, s.boost || 1);
          return k[0] === 'steel' && s.noSteel ? ['strong', 2] : k;
        });
        openUp(raw, kinds);
        const walls = raw.filter((s, i) => kinds[i][0] === 'steel' && !s.motion && !s.circle).map(s => {
          const w = P.transform(s.local, s.x, s.y, s.ang || 0, new Float32Array(s.local.length));
          return { w, o: Math.sign(P.signedArea(w)) || 1 };
        });
        bricks = raw.map((s, i) => {
          let [kind, hp] = kinds[i], armor = null;
          if (kind === 'armor' && !(armor = armorOf(s, hash3(seedInt + 2, s.key[0], s.key[1]), walls))) [kind, hp] = ['strong', 2];
          const bh = hue + s.t * spread;
          const note = clamp(Math.round((1 - (s.y - B.T) / (B.B - B.T)) * 9), 0, 9);
          // призраки гаснут волной от оси к краям
          const phOff = kind === 'phase' ? (Math.abs(s.x - CX) / 360) * 1.8 : 0;
          return Object.assign({}, s, { kind, hp, armor, color: brickColor(s, kind, bh, hue), note, phOff });
        });
        if (bricks.filter(b => b.kind !== 'steel').length >= 18) break;
      }
      // у картины цвета уровня (пол, кромка поля, ракетка) — золотистые, под раму; название — когда стена разбита
      const lh = art ? 0.1 : hue, ls = art ? 0.05 : spread;
      return {
        bricks, gen, seedInt, art,
        title: NAMES_RU[gen],
        name: gen === 'artLive' ? 'она оживает' : art ? 'что под стеной?' : U.levelName(rng),
        c1: U.hsl(lh, 0.7, 0.5),
        c2: U.hsl(lh + ls * 0.5 + 0.08, 0.75, 0.55),
        rng,
      };
    },
    gens: Object.keys(GENS),
    settle,
  };
})(window.AK);
