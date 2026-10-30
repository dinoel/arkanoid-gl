'use strict';
window.AK = window.AK || {};

(function (AK) {
  const U = {};
  U.TAU = Math.PI * 2;
  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = t => t * t * (3 - 2 * t);
  U.sign = x => (x < 0 ? -1 : 1);
  // Цвет тонкой плёнки (перламутр, чешуя, мыльный пузырь) при разности хода t, в периодах: радуга по кругу;
  // пишет в out
  U.film = function (t, out) {
    for (let i = 0; i < 3; i++) out[i] = 0.5 + 0.5 * Math.cos(U.TAU * (t - i / 3));
    return out;
  };
  // Блики света, прошедшего сквозь рябь на поверхности воды, в точке (x, y) в момент t: 0…1, яркие полосы бегут
  U.caustic = function (x, y, t) {
    const a = Math.sin(x * 0.11 + y * 0.03 + t * 2.3), b = Math.sin(y * 0.13 - x * 0.05 - t * 1.7);
    const c = 0.5 + 0.25 * (a + b);
    return c * c;
  };

  // Детерминированный ГПСЧ (mulberry32) с удобными помощниками.
  U.rng = function (seed) {
    let s = seed >>> 0;
    const r = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.chance = p => r() < p;
    r.weighted = items => { // [[value, weight], ...]
      let sum = 0;
      for (const it of items) sum += it[1];
      let x = r() * sum;
      for (const it of items) { x -= it[1]; if (x <= 0) return it[0]; }
      return items[items.length - 1][0];
    };
    return r;
  };

  // Хэш нескольких целых в [0,1) — для симметричных (зеркальных) решений в генераторе.
  U.hash = function (a, b, c) {
    let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };

  U.seedFrom = function (a, b) {
    let h = 2166136261 >>> 0;
    const str = a + ':' + b;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // 2D value-noise с октавами.
  U.noise = function (rng) {
    const perm = new Uint8Array(512), vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rng(); }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
    const n1 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const u = U.smooth(x - xi), w = U.smooth(y - yi);
      return U.lerp(U.lerp(v(xi, yi), v(xi + 1, yi), u), U.lerp(v(xi, yi + 1), v(xi + 1, yi + 1), u), w);
    };
    return (x, y, oct = 3) => {
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += n1(x * f + i * 17.3, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  };

  U.hsl = function (h, s, l) {
    h = ((h % 1) + 1) % 1;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  };

  U.mix3 = (a, b, t) => [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)];

  const SYL = ['ka', 'ze', 'ri', 'to', 'vo', 'nu', 'sha', 'mi', 'el', 'dra', 'qu', 'ix', 'or', 'ul', 'ny', 'ae', 'th', 'zo', 'ly', 'ran'];
  const SUF = ['Prime', 'Nebula', 'Gate', 'Core', 'Drift', 'Reach', 'Spire', 'Vault', 'Ring', 'Bastion', 'Halo', 'Abyss'];
  U.levelName = function (rng) {
    let s = '';
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) s += rng.pick(SYL);
    return s[0].toUpperCase() + s.slice(1) + ' ' + rng.pick(SUF);
  };

  AK.U = U;
})(window.AK);
