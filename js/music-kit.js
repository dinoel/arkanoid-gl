'use strict';
// Original percussion samples, made once per AudioContext. No downloads or sample licences.
// Two takes at two dynamic levels keep repeated hits alive without rebuilding a synth graph.
// Банк считается при первом клике, на главном потоке. У каждого инструмента свой цикл: общий цикл
// с ветками по инструментам JIT переоптимизировал при каждой смене инструмента, и первый расчёт шёл
// в разы дольше. Спады и синусы постоянной частоты идут рекуррентно — умножением на шаг.
(function (AK) {
  const TAU = Math.PI * 2;
  const lengths = { punch: 0.55, soft: 0.48, snare: 0.3, clap: 0.32, rim: 0.12, closed: 0.09, open: 0.48, shaker: 0.12 };
  const METAL = [1, 1.342, 1.753, 2.137, 2.731, 3.196];

  // Общее для всех: шум, его полосы, атака и срез хвоста, мягкое ограничение
  function noiseBands(rate) {
    return { kLow: 1 - Math.exp(-TAU * 1800 / rate), kLow2: 1 - Math.exp(-TAU * 7000 / rate) };
  }
  const env = (t, dur) => Math.min(1, t / 0.0015) * Math.min(1, (dur - t) / 0.012);
  const step = (tau, rate) => Math.exp(-1 / (tau * rate)); // exp(-t/tau) за один отсчёт

  function kick(o) {
    const { data, rng, rate, dur, bright, tune, soft } = o, { kLow2 } = noiseBands(rate);
    const dF = step(0.022, rate), dB = step(soft ? 0.105 : 0.125, rate), dC = step(0.009, rate);
    const drive = soft ? 1.2 : 1.8, level = soft ? 0.79 : 0.9;
    let low2 = 0, phase = 0, eF = 1, eB = 1, eC = 1;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low2 += (n - low2) * kLow2;
      phase += TAU * (46 + 115 * eF) * tune / rate;
      const body = Math.sin(phase) * eB;
      const click = (0.18 * (n - low2) + 0.12 * Math.sin(phase * 3)) * eC * bright;
      data[i] = Math.tanh(Math.tanh((body + click) * drive) * level) * env(t, dur);
      eF *= dF; eB *= dB; eC *= dC;
    }
  }

  function snare(o) {
    const { data, rng, rate, dur, bright, tune, layer } = o, { kLow, kLow2 } = noiseBands(rate);
    const dB = step(0.032, rate), dW = step(layer ? 0.066 : 0.047, rate);
    const c1 = Math.cos(TAU * 185 * tune / rate), s1 = Math.sin(TAU * 185 * tune / rate);
    const c2 = Math.cos(TAU * 331 / rate), s2 = Math.sin(TAU * 331 / rate);
    let low = 0, low2 = 0, eB = 1, eW = 1, x1 = 1, y1 = 0, x2 = 1, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low += (n - low) * kLow; low2 += (n - low2) * kLow2;
      const body = (y1 + 0.4 * y2) * eB;
      const wire = ((low2 - low) * 1.6 + (n - low2) * 0.28 * bright) * eW;
      data[i] = Math.tanh(body * 0.38 + wire * 0.85) * env(t, dur);
      eB *= dB; eW *= dW;
      let x = x1; x1 = x * c1 - y1 * s1; y1 = y1 * c1 + x * s1;
      x = x2; x2 = x * c2 - y2 * s2; y2 = y2 * c2 + x * s2;
    }
  }

  function clap(o) {
    const { data, rng, rate, dur, bright } = o, { kLow, kLow2 } = noiseBands(rate);
    // четыре хлопка: три коротких и последний с хвостом
    const on = [0, 0.009, 0.021, 0.034].map(x => Math.ceil(x * rate - 1e-9));
    const d = [0.006, 0.006, 0.006, 0.055].map(tau => step(tau, rate));
    let low = 0, low2 = 0, e0 = 1, e1 = 1, e2 = 1, e3 = 1;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low += (n - low) * kLow; low2 += (n - low2) * kLow2;
      let g = e0; e0 *= d[0];
      if (i >= on[1]) { g += e1; e1 *= d[1]; }
      if (i >= on[2]) { g += e2; e2 *= d[2]; }
      if (i >= on[3]) { g += e3; e3 *= d[3]; }
      data[i] = Math.tanh(((low2 - low) + (n - low2) * 0.12 * bright) * g * 0.95) * env(t, dur);
    }
  }

  function rim(o) {
    const { data, rng, rate, dur, tune } = o, { kLow, kLow2 } = noiseBands(rate);
    const dT = step(0.014, rate), dN = step(0.006, rate);
    const c1 = Math.cos(TAU * 840 * tune / rate), s1 = Math.sin(TAU * 840 * tune / rate);
    const c2 = Math.cos(TAU * 1720 / rate), s2 = Math.sin(TAU * 1720 / rate);
    let low = 0, low2 = 0, eT = 1, eN = 1, x1 = 1, y1 = 0, x2 = 1, y2 = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low += (n - low) * kLow; low2 += (n - low2) * kLow2;
      data[i] = Math.tanh((y1 * 0.45 + y2 * 0.3) * eT + (low2 - low) * eN * 0.3) * env(t, dur);
      eT *= dT; eN *= dN;
      let x = x1; x1 = x * c1 - y1 * s1; y1 = y1 * c1 + x * s1;
      x = x2; x2 = x * c2 - y2 * s2; y2 = y2 * c2 + x * s2;
    }
  }

  function shaker(o) {
    const { data, rng, rate, dur } = o, { kLow, kLow2 } = noiseBands(rate);
    const dE = step(0.025, rate);
    let low = 0, low2 = 0, e = 1;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low += (n - low) * kLow; low2 += (n - low2) * kLow2;
      const v = ((n - low2) + (low2 - low) * 0.35) * Math.sin(Math.PI * Math.min(1, t / dur)) * e * 1.5;
      data[i] = Math.tanh(v) * env(t, dur);
      e *= dE;
    }
  }

  // Inharmonic metallic partials plus an airy noise tail.
  function hat(o) {
    const { data, rng, rate, dur, bright, tune, open } = o, { kLow, kLow2 } = noiseBands(rate);
    const dE = step(open ? 0.105 : 0.018, rate), K = METAL.length * 2;
    const c = new Float64Array(K), s = new Float64Array(K), x = new Float64Array(K).fill(1), y = new Float64Array(K);
    METAL.forEach((m, k) => {
      for (const [j, f] of [[2 * k, m * 410 * tune], [2 * k + 1, m * 410 * tune * 2.71]]) {
        c[j] = Math.cos(TAU * f / rate); s[j] = Math.sin(TAU * f / rate);
      }
    });
    let low = 0, low2 = 0, e = 1;
    for (let i = 0; i < data.length; i++) {
      const t = i / rate, n = rng() * 2 - 1;
      low += (n - low) * kLow; low2 += (n - low2) * kLow2;
      let ring = 0;
      for (let k = 0; k < K; k += 2) ring += y[k] * y[k + 1];
      data[i] = Math.tanh((ring * 0.045 * bright + (n - low2) * 0.5 + (low2 - low) * 0.12) * e) * env(t, dur);
      e *= dE;
      for (let k = 0; k < K; k++) { const a = x[k]; x[k] = a * c[k] - y[k] * s[k]; y[k] = y[k] * c[k] + a * s[k]; }
    }
  }

  const MAKE = {
    punch: o => kick(o), soft: o => kick(Object.assign(o, { soft: true })), snare, clap, rim,
    closed: o => hat(o), open: o => hat(Object.assign(o, { open: true })), shaker,
  };

  AK.MKit = {
    create(ctx) {
      const rate = ctx.sampleRate, bank = {};
      for (const name of Object.keys(lengths)) {
        bank[name] = [];
        for (let layer = 0; layer < 2; layer++) for (let take = 0; take < 2; take++) {
          const dur = lengths[name], b = ctx.createBuffer(1, Math.ceil(rate * dur), rate);
          MAKE[name]({
            data: b.getChannelData(0), rng: AK.U.rng(AK.U.seedFrom(name, layer * 2 + take)), rate, dur, layer,
            bright: layer ? 1 : 0.58, tune: 1 + (take - 0.5) * 0.018, soft: false, open: false,
          });
          bank[name].push(b);
        }
      }
      const counters = {};
      return {
        get(name, velocity) {
          const takes = bank[name];
          if (!takes) return null;
          const take = (counters[name] = (counters[name] || 0) + 1) % 2;
          return takes[(velocity >= 0.65 ? 2 : 0) + take];
        },
      };
    },
  };
})(window.AK);
