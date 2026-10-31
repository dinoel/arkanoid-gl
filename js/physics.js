'use strict';
// Геометрия форм, законы движения подвижных кирпичей и импульсная физика контакта (круг против выпуклого
// многоугольника/круга/капсулы) с учётом трения, вращения мяча и скорости поверхности в точке контакта.
(function (AK) {
  const { TAU, clamp } = AK.U;
  const P = {};

  // ---- Фабрики форм (локальные координаты, центр масс в нуле) ----
  P.rect = (w, h) => [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2];
  P.ngon = (n, r, rot = 0) => {
    const v = [];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; v.push(Math.cos(a) * r, Math.sin(a) * r); }
    return v;
  };
  P.tri = (s, up) => {
    const h = (s * Math.sqrt(3)) / 2;
    return up ? [0, (-2 * h) / 3, s / 2, h / 3, -s / 2, h / 3] : [-s / 2, -h / 3, s / 2, -h / 3, 0, (2 * h) / 3];
  };
  P.diamond = (w, h) => [0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0];
  P.mirrorX = v => { const o = v.slice(); for (let i = 0; i < o.length; i += 2) o[i] = -o[i]; return o; };
  P.rot = (v, a) => {
    const c = Math.cos(a), s = Math.sin(a), o = v.slice();
    for (let i = 0; i < v.length; i += 2) { o[i] = v[i] * c - v[i + 1] * s; o[i + 1] = v[i] * s + v[i + 1] * c; }
    return o;
  };
  P.centroid = v => {
    let a = 0, cx = 0, cy = 0;
    const n = v.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = v[i * 2], y0 = v[i * 2 + 1], x1 = v[j * 2], y1 = v[j * 2 + 1];
      const c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    return [cx / (3 * a), cy / (3 * a)];
  };
  // Тот же многоугольник, сдвинутый центром масс в ноль
  P.centered = v => { const [cx, cy] = P.centroid(v); return v.map((x, i) => x - (i % 2 ? cy : cx)); };
  // Трапеция: нижнее основание wb, верхнее wt
  P.trap = (wb, wt, h) => P.centered([-wb / 2, h / 2, -wt / 2, -h / 2, wt / 2, -h / 2, wb / 2, h / 2]);
  // Параллелограмм: верх сдвинут на sk вправо, низ — влево
  P.para = (w, h, sk) => [-w / 2 + sk, -h / 2, w / 2 + sk, -h / 2, w / 2 - sk, h / 2, -w / 2 - sk, h / 2];
  // Дельтоид: поперечная диагональ — на доле top высоты сверху
  P.kite = (w, h, top) => P.centered([0, -h * top, w / 2, 0, 0, h * (1 - top), -w / 2, 0]);
  // Капсула w × h (w > h), каждое скругление — seg отрезков
  P.pill = (w, h, seg = 5) => {
    const r = h / 2, hl = w / 2 - r, v = [];
    for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + (i / seg) * Math.PI; v.push(hl + Math.cos(a) * r, Math.sin(a) * r); }
    for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + (i / seg) * Math.PI; v.push(-hl + Math.cos(a) * r, Math.sin(a) * r); }
    return v;
  };
  // Полукруг плоской стороной вниз
  P.half = (r, seg = 8) => {
    const v = [];
    for (let i = 0; i <= seg; i++) { const a = Math.PI + (i / seg) * Math.PI; v.push(Math.cos(a) * r, Math.sin(a) * r); }
    return P.centered(v);
  };
  // Сектор кольца r0…r1 между углами a0 и a1 (в координатах центра кольца). Внутренняя сторона — хорда:
  // вогнутую дугу выпуклый многоугольник не повторит.
  P.sector = (r0, r1, a0, a1, seg = 3) => {
    const v = [r0 * Math.cos(a0), r0 * Math.sin(a0), r0 * Math.cos(a1), r0 * Math.sin(a1)];
    for (let i = seg; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / seg; v.push(r1 * Math.cos(a), r1 * Math.sin(a)); }
    return v;
  };

  // ---- Движение кирпичей ----
  // Положение кирпича с движением m в момент t: x, y, ang, скорости vx, vy, w — в o. (bx, by, bang) — его
  // исходные координаты и угол.
  //   orbit — по окружности радиуса r вокруг (cx, cy), поворачиваясь вместе с ней, как спица колеса; с amp — ещё
  //     и покачиваясь туда-обратно на amp·sin(f·t + ph) (с w = 0 — только качается: головка кивает на стебле);
  //   slide — качается по горизонтали с размахом amp;
  //   spin — крутится на месте;
  //   liss — фигура Лиссажу: размахи ax, ay, частоты fx, fy, фазы px, py; может ещё и крутиться (w);
  //   swing — маятник: висит на нити длины l из точки (px, py), отклоняется на a·sin(f·t + ph);
  //   track — конвейер: едет со скоростью v по петле-стадиону (см. P.trackAt), повторяя её изгибы.
  // Другие типы (кирпичи босса: их двигает boss.js) o не меняют.
  P.pose = (m, bx, by, bang, t, o) => {
    let x = bx, y = by, ang = bang, vx = 0, vy = 0, w = 0;
    switch (m.type) {
      case 'orbit': {
        const d = P.turn(m, t), th = m.a0 + d;
        w = m.amp ? m.w + m.amp * m.f * Math.cos(m.f * t + m.ph) : m.w;
        x = m.cx + m.r * Math.cos(th); y = m.cy + m.r * Math.sin(th);
        ang = bang + d;
        vx = -w * (y - m.cy); vy = w * (x - m.cx);
        break;
      }
      case 'slide': {
        const ph = m.f * t + m.ph;
        x = bx + m.amp * Math.sin(ph); vx = m.amp * m.f * Math.cos(ph);
        break;
      }
      case 'spin': ang = bang + m.w * t; w = m.w; break;
      case 'liss': {
        const p = m.fx * t + m.px, q = m.fy * t + m.py;
        x = bx + m.ax * Math.sin(p); y = by + m.ay * Math.sin(q);
        vx = m.ax * m.fx * Math.cos(p); vy = m.ay * m.fy * Math.cos(q);
        if (m.w) { ang = bang + m.w * t; w = m.w; }
        break;
      }
      case 'swing': {
        const ph = m.f * t + m.ph, th = m.a * Math.sin(ph), dth = m.a * m.f * Math.cos(ph);
        const s = Math.sin(th), c = Math.cos(th);
        x = m.px + m.l * s; y = m.py + m.l * c;
        vx = m.l * c * dth; vy = -m.l * s * dth;
        ang = bang - th; w = -dth;
        break;
      }
      case 'track': {
        const p = P.trackAt(m, m.s0 + m.v * t, trk);
        x = p.x; y = p.y; vx = m.v * p.tx; vy = m.v * p.ty;
        ang = bang + Math.atan2(p.ty, p.tx); w = m.v * p.k;
        break;
      }
      default: return o;
    }
    o.x = x; o.y = y; o.ang = ang; o.vx = vx; o.vy = vy; o.w = w;
    return o;
  };
  // На сколько повернулось движение orbit к моменту t (им же живая картина поворачивает полотно под головкой)
  P.turn = (m, t) => m.w * t + (m.amp ? m.amp * Math.sin(m.f * t + m.ph) : 0);
  const trk = { x: 0, y: 0, tx: 0, ty: 0, k: 0 };
  // Точка петли конвейера на расстоянии s по ходу: стадион с центром (cx, cy), прямыми длины 2·hl и полукругами
  // радиуса r, повёрнутый на rot. Ход начинается сверху посередине и идёт по часовой стрелке (dir = 1) или против
  // (dir = −1). Возвращает точку, единичную касательную по ходу и кривизну со знаком поворота.
  P.trackAt = (m, s, o) => {
    const hl = m.hl, r = m.r, arc = Math.PI * r, per = 4 * hl + 2 * arc;
    s = ((s % per) + per) % per;
    let lx, ly, tx, ty, k = 0;
    if (s < hl) { lx = s; ly = -r; tx = 1; ty = 0; }
    else if ((s -= hl) < arc) { const a = -Math.PI / 2 + s / r; lx = hl + r * Math.cos(a); ly = r * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a); k = 1 / r; }
    else if ((s -= arc) < 2 * hl) { lx = hl - s; ly = r; tx = -1; ty = 0; }
    else if ((s -= 2 * hl) < arc) { const a = Math.PI / 2 + s / r; lx = -hl + r * Math.cos(a); ly = r * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a); k = 1 / r; }
    else { lx = -hl + s - arc; ly = -r; tx = 1; ty = 0; }
    if (m.dir < 0) { lx = -lx; tx = -tx; k = -k; }
    const c = Math.cos(m.rot || 0), sn = Math.sin(m.rot || 0);
    o.x = m.cx + lx * c - ly * sn; o.y = m.cy + lx * sn + ly * c;
    o.tx = tx * c - ty * sn; o.ty = tx * sn + ty * c; o.k = k;
    return o;
  };
  P.trackLen = m => 4 * m.hl + 2 * Math.PI * m.r;

  // Пересекаются ли выпуклые многоугольники a и b (мировые координаты), если зазор меньше gap
  P.overlap = (a, b, gap) => {
    for (let pass = 0; pass < 2; pass++) {
      const v = pass ? b : a, n = v.length / 2;
      for (let i = 0; i < n; i++) {
        const j = i + 1 < n ? i + 1 : 0;
        const nx = v[j * 2 + 1] - v[i * 2 + 1], ny = v[i * 2] - v[j * 2];
        const l = Math.hypot(nx, ny) || 1;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        for (let q = 0; q < a.length; q += 2) { const p = (a[q] * nx + a[q + 1] * ny) / l; if (p < a0) a0 = p; if (p > a1) a1 = p; }
        for (let q = 0; q < b.length; q += 2) { const p = (b[q] * nx + b[q + 1] * ny) / l; if (p < b0) b0 = p; if (p > b1) b1 = p; }
        if (b0 - a1 >= gap || a0 - b1 >= gap) return false;
      }
    }
    return true;
  };

  P.signedArea = v => {
    let a = 0;
    const n = v.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += v[i * 2] * v[j * 2 + 1] - v[j * 2] * v[i * 2 + 1];
    }
    return a * 0.5;
  };
  P.radius = v => { let r = 0; for (let i = 0; i < v.length; i += 2) r = Math.max(r, Math.hypot(v[i], v[i + 1])); return r; };

  // Смещение рёбер внутрь на d (митра) — для фаски.
  P.inset = (v, d) => {
    const n = v.length / 2, o = Math.sign(P.signedArea(v)) || 1;
    const nx = new Array(n), ny = new Array(n), out = new Array(v.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = v[j * 2] - v[i * 2], ey = v[j * 2 + 1] - v[i * 2 + 1];
      const len = Math.hypot(ex, ey) || 1;
      nx[i] = (o * ey) / len; ny[i] = (-o * ex) / len;
    }
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n;
      const k = 1 + nx[p] * nx[i] + ny[p] * ny[i];
      const sx = (nx[p] + nx[i]) / Math.max(k, 0.25), sy = (ny[p] + ny[i]) / Math.max(k, 0.25);
      out[i * 2] = v[i * 2] - sx * d;
      out[i * 2 + 1] = v[i * 2 + 1] - sy * d;
    }
    return out;
  };

  P.transform = (local, x, y, ang, out) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i < local.length; i += 2) {
      const lx = local[i], ly = local[i + 1];
      out[i] = x + lx * c - ly * s;
      out[i + 1] = y + lx * s + ly * c;
    }
    return out;
  };

  // ---- Детекция контакта ----
  // Возвращает нормаль (от препятствия к кругу), глубину и точку контакта, либо null.
  const hit = { nx: 0, ny: 0, pen: 0, px: 0, py: 0 };

  P.circleVsPoly = (cx, cy, r, v, orient) => {
    const n = v.length / 2;
    let maxSep = -Infinity, mnx = 0, mny = 0;
    let bestD2 = Infinity, bpx = 0, bpy = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      const ax = v[i * 2], ay = v[i * 2 + 1];
      const ex = v[j * 2] - ax, ey = v[j * 2 + 1] - ay;
      const l2 = ex * ex + ey * ey, len = Math.sqrt(l2);
      const nx = (orient * ey) / len, ny = (-orient * ex) / len;
      const dx = cx - ax, dy = cy - ay;
      const sep = dx * nx + dy * ny;
      if (sep > r) return null; // разделяющая ось
      if (sep > maxSep) { maxSep = sep; mnx = nx; mny = ny; }
      const t = clamp((dx * ex + dy * ey) / l2, 0, 1);
      const px = ax + ex * t, py = ay + ey * t;
      const d2 = (cx - px) * (cx - px) + (cy - py) * (cy - py);
      if (d2 < bestD2) { bestD2 = d2; bpx = px; bpy = py; }
    }
    if (maxSep <= 0) { // центр внутри
      hit.nx = mnx; hit.ny = mny; hit.pen = r - maxSep;
      hit.px = cx - mnx * maxSep; hit.py = cy - mny * maxSep;
      return hit;
    }
    if (bestD2 > r * r) return null;
    const d = Math.sqrt(bestD2) || 1e-6;
    hit.nx = (cx - bpx) / d; hit.ny = (cy - bpy) / d; hit.pen = r - d;
    hit.px = bpx; hit.py = bpy;
    return hit;
  };

  P.circleVsCircle = (cx, cy, r, ox, oy, or) => {
    const dx = cx - ox, dy = cy - oy, rr = r + or;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-6;
    hit.nx = dx / d; hit.ny = dy / d; hit.pen = rr - d;
    hit.px = ox + hit.nx * or; hit.py = oy + hit.ny * or;
    return hit;
  };

  // Капсула: отрезок (x-hw..x+hw, y) радиуса cr.
  P.circleVsCapsule = (cx, cy, r, x, y, hw, cr) => {
    const px = clamp(cx, x - hw, x + hw);
    return P.circleVsCircle(cx, cy, r, px, y, cr);
  };

  // ---- Импульсный отклик ----
  // body: {vx, vy, w}; R — радиус; k — коэффициент момента инерции (I = k·m·R²; шар 0.4, диск 0.5).
  // (cvx, cvy) — скорость поверхности препятствия в точке контакта.
  // Возвращает нормальный импульс (на единицу массы) — для силы звука/эффектов.
  P.resolve = (b, R, nx, ny, cvx, cvy, e, mu, k) => {
    const rvx = b.vx + b.w * ny * R - cvx;
    const rvy = b.vy - b.w * nx * R - cvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const jn = -(1 + e) * vn;
    let jt = -vt / (1 + 1 / k);
    const maxF = mu * jn;
    jt = clamp(jt, -maxF, maxF);
    b.vx += jn * nx + jt * tx;
    b.vy += jn * ny + jt * ty;
    b.w += -jt / (k * R);
    return jn;
  };

  AK.P = P;
})(window.AK);
