'use strict';
// Подводный мир (вода — water.js): водоросли со дна, камешки у их корней, пузырьки от листьев и взвесь в толще.
// Живёт, только пока включена вода; каждый уровень сажает свой сад. Водоросль — верёвка из узлов (интегрирование
// Верле, длины держатся от корня к кончику): её держит корень, поднимает плавучесть (кончики легче), качает
// медленное течение, а рыбки, мячи, осколки и бонусы, проплывая, расталкивают её. Длина растёт с глубиной: вода
// прибывает — водоросли тянутся за ней, а самые длинные ложатся под поверхностью. Виды: лента (валлиснерия —
// узкая, скручивается, показываясь то плашмя, то ребром), широкий волнистый лист на черешке (эхинодорус)
// и стебель с парами листочков (кабомба — зелёная или красная, как людвигия). Рыбки (fish.js, fish-top.js) щиплют листья:
// pick выбирает узел, node — где он сейчас, poke — дёргает его.
(function (AK) {
  const { U } = AK;
  const { clamp, TAU, lerp } = U;
  const H = 960, L = 16, RX = 704;
  const LX = -0.45, LY = -0.89;      // направление на свет (вверх-влево, как в draw.js)
  const FILM = [0.03, 0.13, 0.16];   // цвет толщи воды (как в draw.js): глубже — гуще
  const BUOY = 300;                  // px/s²: плавучесть кончика (у корня — треть)
  const CUR = 130;                   // px/s²: течение у кончика
  const KEEP = 0.985;                // доля скорости узла, что остаётся за шаг: вода вязкая
  const STEP = 1 / 120;
  const MOTES = 28;                  // пылинок взвеси
  const rand = (a, b) => a + Math.random() * (b - a);
  // n — узлов, len — предельная длина, frac — доля глубины, до которой тянется, w — ширина, stiff — жёсткость
  // на изгиб (0 — гнётся свободно), buoy — плавучесть
  const KINDS = {
    ribbon: { n: 12, len: [70, 170], frac: [0.7, 1.15], w: [2.6, 3.6], stiff: 0.15, buoy: 1 },
    leaf: { n: 7, len: [40, 85], frac: [0.4, 0.7], w: [5.5, 8], stiff: 0.35, buoy: 0.8 },
    stem: { n: 12, len: [55, 135], frac: [0.55, 0.95], w: [1.2, 1.5], stiff: 0.25, buoy: 1.1 },
  };

  const Sb = { fronds: [], stones: [], bub: [], motes: [] };
  let time = 0, gen = 0;
  const shore = x => AK.Water.shoreAt(x);
  const reach = fr => clamp(Math.min(fr.max, (fr.y0 - shore(fr.x0)) * fr.frac), 6, fr.max);

  function addFrond(kind, x, red = false, scale = 1) {
    const K = KINDS[kind], n = K.n;
    const fr = {
      kind, n, gen, x0: clamp(x, L + 6, RX - 6), y0: H - rand(2, 9), max: rand(K.len[0], K.len[1]) * scale,
      frac: rand(K.frac[0], K.frac[1]), w: rand(K.w[0], K.w[1]), stiff: K.stiff, buoy: K.buoy,
      ph: rand(0, TAU), tw: rand(0, TAU), tone: rand(0.85, 1.12), red, front: Math.random() < 0.22, len: 0,
      p: new Float32Array(n * 2), o: new Float32Array(n * 2),
    };
    fr.len = reach(fr);
    const seg = fr.len / (n - 1), lean = rand(-0.35, 0.35);
    for (let j = 0; j < n; j++) {
      fr.p[j * 2] = fr.o[j * 2] = fr.x0 + Math.sin(lean) * seg * j;
      fr.p[j * 2 + 1] = fr.o[j * 2 + 1] = fr.y0 - Math.cos(lean) * seg * j;
    }
    Sb.fronds.push(fr);
  }

  // Новый сад: кусты по ширине поля, у корней — камешки, между ними — одиночные травинки
  Sb.reset = function () {
    gen++;
    Sb.fronds = []; Sb.stones = []; Sb.bub = []; Sb.motes = [];
    const clumps = 7 + ((Math.random() * 4) | 0);
    for (let c = 0; c < clumps; c++) {
      const cx = lerp(L + 30, RX - 30, (c + rand(0.15, 0.85)) / clumps), k = Math.random() * 6.6;
      const kind = k < 3 ? 'ribbon' : k < 4.6 ? 'leaf' : 'stem';
      const cnt = kind === 'ribbon' ? 3 + ((Math.random() * 4) | 0) : kind === 'leaf' ? 2 + ((Math.random() * 2) | 0) : 1 + ((Math.random() * 3) | 0);
      const red = kind === 'stem' && Math.random() < 0.4;
      for (let i = 0; i < cnt; i++) addFrond(kind, cx + rand(-14, 14), red);
      for (let i = 0, m = 1 + ((Math.random() * 3) | 0); i < m; i++) {
        const r = rand(3, 7), sh = [];
        for (let a = 0; a < 10; a++) sh.push(rand(0.85, 1.12));
        Sb.stones.push({ x: cx + rand(-24, 24), y: H - rand(0, 7), rx: r * rand(1.2, 1.6), ry: r * 0.8, sh,
          c: [[0.3, 0.3, 0.29], [0.24, 0.26, 0.29], [0.34, 0.32, 0.28]][(Math.random() * 3) | 0] });
      }
    }
    for (let i = 0, m = 4 + ((Math.random() * 4) | 0); i < m; i++) addFrond('ribbon', rand(L + 20, RX - 20), false, 0.6);
    Sb.stones.sort((a, b) => a.y - b.y);
    for (let i = 0; i < MOTES; i++) Sb.motes.push(mote({}));
  };

  // Пылинка взвеси в случайном месте толщи
  function mote(m) {
    const x = rand(L + 4, RX - 4), top = Math.min(shore(x) + 6, H - 4);
    m.x = x; m.y = rand(top, H - 2); m.s = rand(0.5, 1.2); m.a = rand(0.08, 0.22); m.ph = rand(0, TAU);
    return m;
  }

  // Кто расталкивает водоросли: x, y, радиус, скорость
  const PUSH = [];
  function pushers(G) {
    PUSH.length = 0;
    const Wt = AK.Water, add = (x, y, r, vx, vy) => PUSH.push(x, y, r, vx, vy);
    for (const f of G.fishes) {
      for (const [i, r] of [[0, 6], [3, 11], [6, 11], [9, 7], [12, 5]]) add(f.q[i * 2], f.q[i * 2 + 1], r, f.vx, f.vy);
    }
    for (const b of G.balls) if (Wt.depth(b.x, b.y) > -2) add(b.x, b.y, b.r + 3, b.vx, b.vy);
    for (const u of G.powerups) if (u.inW) add(u.x, u.y, 10, u.vx, u.vy);
    let n = 0;
    for (const d of G.debris) if (d.inW && n++ < 16) add(d.x, d.y, 6, d.vx, d.vy);
  }

  Sb.update = function (dt, G) {
    const Wt = AK.Water;
    if (!Wt.on) return;
    time += dt;
    pushers(G);
    for (const fr of Sb.fronds) {
      const n = fr.n, p = fr.p, o = fr.o;
      fr.len += (reach(fr) - fr.len) * (1 - Math.exp(-dt * 0.7));
      const seg = fr.len / (n - 1);
      for (let j = 1; j < n; j++) {
        const u = j / (n - 1), i = j * 2;
        const ax = CUR * (Math.sin(time * 0.5 + fr.x0 * 0.011 + fr.ph) + 0.4 * Math.sin(time * 1.3 + u * 2.5 + fr.ph * 2)) * u;
        const ay = -BUOY * fr.buoy * (0.3 + 0.7 * u);
        const vx = (p[i] - o[i]) * KEEP, vy = (p[i + 1] - o[i + 1]) * KEEP;
        o[i] = p[i]; o[i + 1] = p[i + 1];
        p[i] += vx + ax * dt * dt; p[i + 1] += vy + ay * dt * dt;
      }
      // расталкивают: узел выходит из круга и подхватывает часть скорости
      for (let k = 0; k < PUSH.length; k += 5) {
        const px = PUSH[k], py = PUSH[k + 1], r = PUSH[k + 2];
        if (Math.abs(px - fr.x0) > fr.len + r || py < fr.y0 - fr.len - r) continue;
        for (let j = 1; j < n; j++) {
          const i = j * 2, dx = p[i] - px, dy = p[i + 1] - py, d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          // сдвиг узла почти не становится скоростью (иначе кончик хлещет), а толчок передаёт долю скорости
          const d = Math.sqrt(d2) || 1, ex = px + (dx / d) * r - p[i], ey = py + (dy / d) * r - p[i + 1];
          p[i] += ex; p[i + 1] += ey;
          o[i] += ex * 0.9 - PUSH[k + 3] * dt * 0.3; o[i + 1] += ey * 0.9 - PUSH[k + 4] * dt * 0.3;
        }
      }
      // длины — от корня к кончику; жёсткие стебли тянутся вдоль предыдущего звена. Поправка длины сдвигает
      // и прошлое положение узла — как в DFTL, иначе каждая поправка добавляла бы скорости и кончик раскачивался
      p[0] = fr.x0; p[1] = fr.y0;
      let tx = 0, ty = -1;
      for (let j = 1; j < n; j++) {
        const i = j * 2;
        let dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1];
        let l = Math.hypot(dx, dy) || 1;
        dx = lerp(dx / l, tx, fr.stiff); dy = lerp(dy / l, ty, fr.stiff);
        l = Math.hypot(dx, dy) || 1;
        tx = dx / l; ty = dy / l;
        const nx = p[i - 2] + tx * seg, ny = p[i - 1] + ty * seg;
        o[i] += (nx - p[i]) * 0.9; o[i + 1] += (ny - p[i + 1]) * 0.9;
        p[i] = nx; p[i + 1] = ny;
        // под поверхностью и в поле
        const top = shore(p[i]) + 3;
        if (p[i + 1] < top) { p[i + 1] = top; o[i + 1] = top; }
        p[i] = clamp(p[i], L + 2, RX - 2);
      }
      // от листьев и стеблей изредка отрываются пузырьки
      if (fr.kind !== 'ribbon' && Math.random() < dt * 0.06) {
        const j = ((n / 2) | 0) + ((Math.random() * (n / 2)) | 0);
        Sb.bub.push({ x: p[j * 2], y: p[j * 2 + 1], r: rand(0.8, 1.6), vy: rand(22, 40), t: 0, ph: rand(0, TAU) });
      }
    }
    for (const b of Sb.bub) { b.t += dt; b.y -= b.vy * dt; b.x += Math.sin(b.t * 7 + b.ph) * 8 * dt; }
    Sb.bub = Sb.bub.filter(b => Wt.depth(b.x, b.y) > 1);
    for (const m of Sb.motes) {
      m.x += (Math.sin(time * 0.5 + m.ph) * 4 + 2) * dt; m.y += Math.sin(time * 0.7 + m.ph * 2) * 3 * dt;
      if (m.x > RX - 2 || Wt.depth(m.x, m.y) < 4) mote(m);
    }
  };

  // Узел листа для рыбки: где-нибудь в половине поля вокруг x, в полосе от top(x) до bot
  Sb.pick = function (x, top, bot) {
    const list = [];
    for (const fr of Sb.fronds) {
      if (Math.abs(fr.x0 - x) > 260) continue;
      for (let j = 2; j < fr.n; j++) {
        const px = fr.p[j * 2], py = fr.p[j * 2 + 1];
        if (py >= top(px) && py <= bot) list.push({ fr, j, gen });
      }
    }
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  };
  const NODE = [0, 0];
  Sb.node = function (nib) {
    if (!nib || nib.gen !== gen) return null;
    NODE[0] = nib.fr.p[nib.j * 2]; NODE[1] = nib.fr.p[nib.j * 2 + 1];
    return NODE;
  };
  Sb.poke = function (nib, vx, vy) {
    if (!nib || nib.gen !== gen) return;
    const o = nib.fr.o, n = nib.fr.n;
    for (let j = Math.max(1, nib.j - 1); j < Math.min(n, nib.j + 2); j++) { o[j * 2] -= vx * STEP; o[j * 2 + 1] -= vy * STEP; }
  };

  // ---------- Рисунок ----------
  const { R } = AK;
  const TMP = [0, 0, 0];
  // Цвет c с яркостью k, затянутый толщей воды на глубине y-кромка
  function tint(c, k, x, y) {
    const f = clamp((y - shore(x)) / 160, 0, 0.7) * 0.6;
    TMP[0] = lerp(c[0] * k, FILM[0], f); TMP[1] = lerp(c[1] * k, FILM[1], f); TMP[2] = lerp(c[2] * k, FILM[2], f);
    return TMP;
  }
  const C1 = [0, 0, 0], C2 = [0, 0, 0];
  function setG(a, b, al) { R.color(a[0], a[1], a[2], al); R.color2(b[0], b[1], b[2], al); }
  const mix3 = (out, a, b, t) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; };
  const M1 = [0, 0, 0], M2 = [0, 0, 0];
  // нормаль звена j…j+1 (влево от направления к кончику)
  let snx = 0, sny = 0;
  function segN(p, j, n) {
    const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1);
    let dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1];
    const l = Math.hypot(dx, dy) || 1;
    snx = -dy / l; sny = dx / l;
  }

  const RIB = { base: [0.06, 0.2, 0.09], mid: [0.17, 0.46, 0.17], tip: [0.42, 0.68, 0.24] };
  const LEAF = { stalk: [0.14, 0.3, 0.1], base: [0.12, 0.38, 0.14], tip: [0.32, 0.62, 0.22], vein: [0.55, 0.8, 0.4] };
  const STEM_G = { stem: [0.14, 0.36, 0.12], leaf0: [0.16, 0.45, 0.16], leaf1: [0.45, 0.75, 0.3] };
  const STEM_R = { stem: [0.45, 0.16, 0.12], leaf0: [0.3, 0.42, 0.14], leaf1: [0.85, 0.3, 0.32] };

  // Цвет ленты на доле длины u: от тёмного корня к светлому кончику
  function ribCol(out, u) { return u < 0.5 ? mix3(out, RIB.base, RIB.mid, u * 2) : mix3(out, RIB.mid, RIB.tip, (u - 0.5) * 2); }

  // Лента скручивается: плашмя — широкая и светлая, ребром — узкая и тёмная
  function ribbon(fr) {
    const p = fr.p, n = fr.n;
    let lx0 = 0, ly0 = 0, rx0 = 0, ry0 = 0, c0 = null;
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1), tw = Math.abs(Math.cos(fr.tw + u * 3 + time * 0.6));
      const w = fr.w * (1 - 0.7 * u) * (0.3 + 0.7 * tw) * (j === n - 1 ? 0.3 : 1);
      segN(p, j, n);
      const x = p[j * 2], y = p[j * 2 + 1];
      const lx = x + snx * w, ly = y + sny * w, rx = x - snx * w, ry = y - sny * w;
      const c = tint(ribCol(M1, u), fr.tone * (0.7 + 0.4 * tw), x, y);
      if (j) {
        R.color(c0[0], c0[1], c0[2], 0.92); R.color2(c[0], c[1], c[2], 0.92);
        R.quadG(lx0, ly0, rx0, ry0, rx, ry, lx, ly);
      }
      lx0 = lx; ly0 = ly; rx0 = rx; ry0 = ry; c0 = mix3(C1, c, c, 0);
    }
    R.color(0.5, 0.78, 0.36, 0.18);
    for (let j = 1; j < n - 1; j++) R.line(p[j * 2 - 2], p[j * 2 - 1], p[j * 2], p[j * 2 + 1], 0.6);
  }

  const LW = new Float32Array(16);
  // Широкий лист: черешок, потом пластинка с волнистым краем; бок к свету светлее, жилки к краям
  function leaf(fr) {
    const p = fr.p, n = fr.n, W = LW;
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1);
      W[j] = u < 0.25 ? 1.1 : fr.w * Math.pow(Math.sin((Math.PI * (u - 0.25)) / 0.75), 0.75) * (1 + 0.1 * Math.sin(u * 16 + time * 1.6 + fr.ph));
    }
    for (const sg of [1, -1]) {
      for (let j = 0; j < n - 1; j++) {
        const u0 = j / (n - 1), u1 = (j + 1) / (n - 1);
        segN(p, j, n);
        const n0x = snx * sg, n0y = sny * sg, k0 = 0.85 + 0.3 * Math.max(0, n0x * LX + n0y * LY);
        segN(p, j + 1, n);
        const n1x = snx * sg, n1y = sny * sg;
        const x0 = p[j * 2], y0 = p[j * 2 + 1], x1 = p[j * 2 + 2], y1 = p[j * 2 + 3];
        const a = tint(u0 < 0.25 ? LEAF.stalk : mix3(M1, LEAF.base, LEAF.tip, u0), fr.tone * k0, x0, y0);
        mix3(C1, a, a, 0);
        const b = tint(u1 < 0.25 ? LEAF.stalk : mix3(M2, LEAF.base, LEAF.tip, u1), fr.tone * k0, x1, y1);
        R.color(C1[0], C1[1], C1[2], 0.94); R.color2(b[0], b[1], b[2], 0.94);
        R.quadG(x0, y0, x0 + n0x * W[j], y0 + n0y * W[j], x1 + n1x * W[j + 1], y1 + n1y * W[j + 1], x1, y1);
        // жилка — от средней жилки наискосок к краю
        if (u0 >= 0.25 && j < n - 2) {
          R.color(LEAF.vein[0], LEAF.vein[1], LEAF.vein[2], 0.2);
          R.line(x0, y0, x1 + n1x * W[j + 1] * 0.8, y1 + n1y * W[j + 1] * 0.8, 0.5);
        }
      }
    }
    R.color(LEAF.vein[0], LEAF.vein[1], LEAF.vein[2], 0.35);
    for (let j = 1; j < n - 1; j++) R.line(p[j * 2 - 2], p[j * 2 - 1], p[j * 2], p[j * 2 + 1], 0.8);
  }

  // Стебель с парами овальных листочков вверх-в стороны (соседние пары — под разным углом); на макушке — почка
  function stem(fr) {
    const p = fr.p, n = fr.n, P = fr.red ? STEM_R : STEM_G;
    for (let j = 1; j < n; j++) {
      const c = tint(P.stem, fr.tone, p[j * 2], p[j * 2 + 1]);
      R.color(c[0], c[1], c[2], 0.95); R.line(p[j * 2 - 2], p[j * 2 - 1], p[j * 2], p[j * 2 + 1], fr.w * (1 - 0.4 * j / n));
    }
    for (let j = 1; j < n; j++) {
      const u = j / (n - 1), x = p[j * 2], y = p[j * 2 + 1];
      segN(p, j, n);
      const tx = sny, ty = -snx; // к кончику
      const ll = (8.5 - 2.5 * u) * (0.8 + 0.2 * fr.tone), hw = 2.8 - 0.7 * u;
      for (const sg of [1, -1]) {
        const a = (0.75 + (j % 2 ? 0.25 : -0.1) - 0.25 * u + 0.1 * Math.sin(time * 1.5 + j + fr.ph)) * sg;
        const c = Math.cos(a), s = Math.sin(a), dx = tx * c - ty * s, dy = tx * s + ty * c; // повёрнутая касательная
        const k = 0.85 + 0.3 * Math.max(0, dx * LX + dy * LY);
        // овал из четырёх долек вдоль листа; цвет — от основания к кончику
        let ax = x, ay = y, bx = x, by = y;
        for (let q = 1; q <= 4; q++) {
          const t = q / 4, w = hw * Math.pow(Math.sin(Math.PI * Math.min(t, 0.999)), 0.8);
          const cx = x + dx * ll * t, cy = y + dy * ll * t;
          const c0 = tint(mix3(M1, P.leaf0, P.leaf1, (0.4 + 0.6 * u) * (t - 0.25)), fr.tone * k, cx, cy);
          mix3(C1, c0, c0, 0);
          const c1 = tint(mix3(M2, P.leaf0, P.leaf1, (0.4 + 0.6 * u) * t), fr.tone * k, cx, cy);
          R.color(C1[0], C1[1], C1[2], 0.92); R.color2(c1[0], c1[1], c1[2], 0.92);
          const lx = cx - dy * w, ly = cy + dx * w, rx = cx + dy * w, ry = cy - dx * w;
          R.quadG(ax, ay, bx, by, rx, ry, lx, ly);
          ax = lx; ay = ly; bx = rx; by = ry;
        }
      }
    }
    const tc = tint(P.leaf1, fr.tone, p[n * 2 - 2], p[n * 2 - 1]);
    R.color(tc[0], tc[1], tc[2], 0.95); R.disc(p[n * 2 - 2], p[n * 2 - 1], 2);
  }

  const STONE = new Float32Array(20);
  // Рисует сад: front = false — всё, что за рыбкой (камни, взвесь, задние водоросли, пузырьки), true — передние
  Sb.draw = function (front) {
    if (!AK.Water.on) return;
    R.lit(R.gi ? 0.45 : 0);
    if (!front) {
      for (const s of Sb.stones) {
        for (let a = 0; a < 10; a++) {
          const t = (a / 10) * TAU;
          STONE[a * 2] = s.x + Math.cos(t) * s.rx * s.sh[a]; STONE[a * 2 + 1] = s.y + Math.sin(t) * s.ry * s.sh[a];
        }
        const c = tint(s.c, 1, s.x, s.y);
        R.color(0, 0.01, 0.015, 0.35); R.soft(s.x + 2, s.y + 3, s.rx * 1.5);
        R.color(c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 1); R.color2(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 1);
        R.polyShade(STONE, s.x - s.rx * 0.2, s.y - s.ry * 0.25, LX, LY, 0.45);
        R.color(1, 1, 1, 0.12, 1); R.soft(s.x - s.rx * 0.35, s.y - s.ry * 0.45, s.ry * 0.6);
      }
    }
    for (const fr of Sb.fronds) {
      if (fr.front !== front) continue;
      if (fr.kind === 'ribbon') ribbon(fr);
      else if (fr.kind === 'leaf') leaf(fr);
      else stem(fr);
    }
    R.lit(0);
    if (front) return;
    for (const m of Sb.motes) { R.color(0.7, 0.9, 1, m.a * (0.6 + 0.4 * Math.sin(time * 1.3 + m.ph)), 1); R.disc(m.x, m.y, m.s); }
    for (const b of Sb.bub) {
      R.color(0.75, 0.92, 1, 0.4, 1); R.ring(b.x, b.y, b.r, 0.35);
      R.color(1, 1, 1, 0.5, 1); R.disc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.35);
    }
  };

  AK.Seabed = Sb;
})(window.AK);
