'use strict';
// Процедурная генерация уровней: несколько семейств раскладок (сетка, соты, треугольная мозаика,
// вращающиеся кольца, спиральная галактика, мозаика Пуассона, крепость), зеркальная симметрия,
// маски из шума, сложность растёт с номером уровня. Всё детерминировано сидом.
(function (AK) {
  const { U, P } = AK;
  const { clamp, TAU } = U;
  const B = { L: 32, R: 688, T: 112, B: 560 };
  const CX = 360;
  const SQ3 = Math.sqrt(3);

  function mirrorSpec(s) {
    const m = Object.assign({}, s);
    m.x = 2 * CX - s.x;
    m.local = P.mirrorX(s.local);
    m.ang = -(s.ang || 0);
    if (s.motion && s.motion.type === 'spin') m.motion = Object.assign({}, s.motion, { w: -s.motion.w });
    return m;
  }
  function pushSym(out, s) {
    out.push(s);
    if (Math.abs(s.x - CX) > 1) out.push(mirrorSpec(s));
  }

  // ---------- Сетка прямоугольников ----------
  function grid(rng, d, noise) {
    const out = [];
    const cols = rng.pick(d === 0 ? [10, 12] : [10, 12, 13, 14]);
    const gap = 4;
    const slide = d >= 3 && rng.chance(0.4);
    const zoneW = (B.R - B.L) * (slide ? 0.78 : 1);
    const bw = (zoneW - gap * (cols - 1)) / cols;
    const bh = rng.pick([20, 22, 24]);
    const maxRows = Math.floor((B.B - B.T) / (bh + gap));
    const rows = clamp(6 + Math.floor(d / 2) + rng.int(0, 2), 5, Math.min(13, maxRows));
    const pattern = d === 0 ? rng.pick(['full', 'stripes']) : rng.pick(['noise', 'full', 'stripes', 'checker', 'pyramid', 'invader', 'noise']);
    const sc = rng.range(1.8, 3.6), thr = rng.range(0.38, 0.5);
    const sfreq = rng.range(0.5, 0.9) + d * 0.02;
    for (let r = 0; r < rows; r++) {
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
        pushSym(out, { local: P.rect(bw, bh), x, y, ang: 0, key: [r, c], t: v, motion });
      }
    }
    return out;
  }

  // ---------- Соты ----------
  function honeycomb(rng, d, noise) {
    const out = [];
    const r = rng.pick([19, 21, 23]);
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
    const s = rng.pick([50, 54, 60]);
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
      const shape = rng.pick(['arc', 'arc', 'circle', 'diamond', 'hex']);
      const w = spin ? (k % 2 ? 1 : -1) * rng.range(0.16, 0.34) * (1 + d * 0.03) : 0;
      const n = Math.floor((TAU * R) / (shape === 'arc' ? 46 : 40));
      const off = rng.range(0, TAU);
      for (let j = 0; j < n; j++) {
        if (U.hash(k, j, 31) < 0.1) continue;
        const th = off + (j / n) * TAU;
        const x = CX + R * Math.cos(th), y = cy + R * Math.sin(th);
        const s = { x, y, key: [k, j], t: k / K, ang: 0, local: null, circle: 0 };
        if (shape === 'arc') { s.local = P.rect(((TAU * R) / n) * 0.84, 20); s.ang = th + Math.PI / 2; }
        else if (shape === 'circle') { s.circle = 15; s.local = P.ngon(24, 15); }
        else if (shape === 'diamond') { s.local = P.diamond(26, 30); s.ang = th; }
        else { s.local = P.ngon(6, 15); s.ang = th; }
        if (w) s.motion = { type: 'orbit', cx: CX, cy, r: R, a0: th, w };
        out.push(s);
      }
    }
    out.push({ x: CX, y: cy, circle: 26, local: P.ngon(28, 26), ang: 0, key: [0, 0], t: 0,
      kind: d >= 4 ? 'steel' : 'explosive', hp: 1 });
    return out;
  }

  // ---------- Спиральная галактика ----------
  function spiral(rng, d) {
    const out = [];
    const cy = B.T + 222;
    const arms = rng.int(2, 3);
    const b = (46 * arms) / TAU;
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
        const sz = 13 + (r / rMax) * 5;
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
        th += 36 / Math.sqrt(r * r + b * b);
        idx++;
      }
    }
    out.push({ x: CX, y: cy, circle: 22, local: P.ngon(26, 22), ang: 0, key: [9, 9], t: 0, kind: 'explosive', hp: 1,
      motion: w ? { type: 'spin', w } : null });
    // Пояс шестиугольников по верху
    for (let i = 0; i < 6; i++) {
      const x = B.L + 30 + i * 50, y = B.T + 4;
      if (x > CX - 40 || placed.some(p => Math.hypot(p[0] - x, p[1] - y) < p[2] + 22)) continue;
      if (w && Math.hypot(x - CX, y - cy) < rMax + 40) continue;
      pushSym(out, { x, y, local: P.ngon(6, 16, -Math.PI / 2), ang: 0, key: [20, i], t: 1 });
    }
    return out;
  }

  // ---------- Мозаика Пуассона из разных форм ----------
  function mosaic(rng, d, noise) {
    const out = [];
    const placed = [];
    const thr = rng.range(0.36, 0.46), sc = rng.range(0.006, 0.011);
    const spinP = d >= 3 ? 0.3 : 0;
    const kinds = [['hex', 3], ['oct', 2], ['pent', 2], ['tri', 2], ['diamond', 2], ['circle', 2], ['rect', 2], ['square', 1]];
    const fits = (x, y, r) => {
      for (const p of placed) if (Math.hypot(p[0] - x, p[1] - y) < p[2] + r + 6) return false;
      return true;
    };
    for (let tries = 0; tries < 2600 && out.length < 150; tries++) {
      const rad = rng.range(15, 28);
      let x = rng.range(B.L + rad, CX), y = rng.range(B.T + rad, B.B - rad);
      const onAxis = CX - x < rad + 4;
      if (onAxis) x = CX;
      if (noise(x * sc, y * sc) < thr) continue;
      if (!fits(x, y, rad) || (!onAxis && !fits(2 * CX - x, y, rad))) continue;
      const shape = rng.weighted(kinds);
      const rot = onAxis ? -Math.PI / 2 : rng.range(0, TAU);
      const s = { x, y, ang: 0, key: [Math.round(x), Math.round(y)], t: (y - B.T) / (B.B - B.T), circle: 0, local: null };
      switch (shape) {
        case 'hex': s.local = P.ngon(6, rad, rot); break;
        case 'oct': s.local = P.ngon(8, rad, rot); break;
        case 'pent': s.local = P.ngon(5, rad, rot); break;
        case 'tri': s.local = P.ngon(3, rad, rot); break;
        case 'diamond': s.local = P.diamond(rad * 1.3, rad * 2); s.ang = onAxis ? 0 : rot; break;
        case 'circle': s.circle = rad * 0.85; s.local = P.ngon(24, rad * 0.85); break;
        case 'rect': s.local = P.rect(rad * 1.8, rad * 0.85); s.ang = onAxis ? 0 : rot; break;
        case 'square': s.local = P.rect(rad * 1.4, rad * 1.4); s.ang = onAxis ? Math.PI / 4 : rot; break;
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
    const cols = 12, gap = 4, bh = 22;
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
          if (innerHole && c >= 4 && r >= 3 && r <= rows - 4) {
            if (c === 5 && r === Math.floor(rows / 2)) { s.kind = 'explosive'; s.hp = 1; }
            else continue;
          }
          s.boost = 1.7;
        }
        pushSym(out, s);
      }
    }
    return out;
  }

  const GENS = { grid, honeycomb, triangles, rings, spiral, mosaic, fortress };
  const NAMES_RU = {
    grid: 'Кладка', honeycomb: 'Соты', triangles: 'Призмы', rings: 'Кольца',
    spiral: 'Галактика', mosaic: 'Мозаика', fortress: 'Крепость',
  };

  function kindOf(h, h2, d, boost) {
    const pSteel = d < 3 ? 0 : Math.min(0.025 + 0.01 * d, 0.1);
    const pExpl = 0.03 + Math.min(0.005 * d, 0.03);
    const pStrong = Math.min((0.08 + 0.05 * d) * boost, 0.6);
    if (h < pSteel) return ['steel', 1];
    if (h < pSteel + pExpl) return ['explosive', 1];
    if (h < pSteel + pExpl + pStrong) return ['strong', d >= 5 && h2 < 0.4 ? 3 : 2];
    return ['normal', 1];
  }
  function colorFor(kind, hue) {
    if (kind === 'steel') return [0.56, 0.6, 0.68];
    if (kind === 'explosive') return [1.0, 0.33, 0.08];
    if (kind === 'strong') return U.hsl(hue, 0.62, 0.4);
    return U.hsl(hue, 0.8, 0.56);
  }

  function pickGen(level, rng, prev) {
    if (level === 1) return 'grid';
    if (level === 2) return rng.pick(['honeycomb', 'triangles']);
    const opts = [['grid', 0.8], ['honeycomb', 1.1], ['triangles', 1], ['rings', 1.2], ['spiral', 1.1], ['mosaic', 1.3],
      ['fortress', level >= 4 ? 0.9 : 0]].filter(o => o[0] !== prev && o[1] > 0);
    return rng.weighted(opts);
  }

  AK.LevelGen = {
    bounds: B,
    generate(level, baseSeed, prevGen) {
      const seedInt = U.seedFrom(baseSeed, level);
      const rng = U.rng(seedInt);
      const d = level - 1;
      const hue = rng();
      const spread = rng.range(0.15, 0.45) * (rng.chance(0.5) ? 1 : -1);
      let gen, bricks;
      for (let attempt = 0; attempt < 6; attempt++) {
        gen = attempt < 5 ? pickGen(level, rng, prevGen) : 'grid';
        const noise = U.noise(rng);
        const raw = GENS[gen](rng, d, noise);
        bricks = raw.map(s => {
          let kind = s.kind, hp = s.hp;
          if (!kind) [kind, hp] = kindOf(U.hash(seedInt, s.key[0] * 131 + 7, s.key[1] * 977 + 3),
            U.hash(seedInt + 1, s.key[0], s.key[1]), d, s.boost || 1);
          const bh = hue + s.t * spread;
          const note = clamp(Math.round((1 - (s.y - B.T) / (B.B - B.T)) * 9), 0, 9);
          return Object.assign({}, s, { kind, hp, color: colorFor(kind, bh), note });
        });
        if (bricks.filter(b => b.kind !== 'steel').length >= 18) break;
      }
      return {
        bricks, gen, seedInt,
        title: NAMES_RU[gen],
        name: U.levelName(rng),
        c1: U.hsl(hue, 0.7, 0.5),
        c2: U.hsl(hue + spread * 0.5 + 0.08, 0.75, 0.55),
        rng,
      };
    },
  };
})(window.AK);
