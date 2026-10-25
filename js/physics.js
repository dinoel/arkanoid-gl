'use strict';
// Геометрия форм и импульсная физика контакта (круг против выпуклого многоугольника/круга/капсулы)
// с учётом трения, вращения мяча и скорости поверхности в точке контакта.
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
