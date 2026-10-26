'use strict';
// Original percussion samples, made once per AudioContext. No downloads or sample licences.
// Two takes at two dynamic levels keep repeated hits alive without rebuilding a synth graph.
(function (AK) {
  const TAU = Math.PI * 2;
  const lengths = { punch: 0.55, soft: 0.48, snare: 0.3, clap: 0.32, rim: 0.12, closed: 0.09, open: 0.48, shaker: 0.12 };
  AK.MKit = {
    create(ctx) {
      const bank = {};
      for (const name of Object.keys(lengths)) {
        bank[name] = [];
        for (let layer = 0; layer < 2; layer++) for (let take = 0; take < 2; take++) {
          const rng = AK.U.rng(AK.U.seedFrom(name, layer * 2 + take));
          const rate = ctx.sampleRate, dur = lengths[name];
          const b = ctx.createBuffer(1, Math.ceil(rate * dur), rate), data = b.getChannelData(0);
          const bright = layer ? 1 : 0.58, tune = 1 + (take - 0.5) * 0.018;
          let low = 0, low2 = 0, phase = 0;
          const metal = [1, 1.342, 1.753, 2.137, 2.731, 3.196].map(x => x * 410 * tune);
          for (let i = 0; i < data.length; i++) {
            const t = i / rate, n = rng() * 2 - 1;
            low += (n - low) * (1 - Math.exp(-TAU * 1800 / rate));
            low2 += (n - low2) * (1 - Math.exp(-TAU * 7000 / rate));
            const high = n - low2, band = low2 - low;
            const attack = Math.min(1, t / 0.0015), tail = Math.min(1, (dur - t) / 0.012);
            let v = 0;
            if (name === 'punch' || name === 'soft') {
              const soft = name === 'soft';
              phase += TAU * (46 + 115 * Math.exp(-t / 0.022)) * tune / rate;
              const body = Math.sin(phase) * Math.exp(-t / (soft ? 0.105 : 0.125));
              const click = (0.18 * high + 0.12 * Math.sin(phase * 3)) * Math.exp(-t / 0.009) * bright;
              v = Math.tanh((body + click) * (soft ? 1.2 : 1.8)) * (soft ? 0.79 : 0.9);
            } else if (name === 'snare') {
              const body = (Math.sin(TAU * 185 * tune * t) + 0.4 * Math.sin(TAU * 331 * t)) * Math.exp(-t / 0.032);
              const wire = (band * 1.6 + high * 0.28 * bright) * Math.exp(-t / (layer ? 0.066 : 0.047));
              v = body * 0.38 + wire * 0.85;
            } else if (name === 'clap') {
              let env = 0;
              for (const onset of [0, 0.009, 0.021, 0.034]) if (t >= onset) env += Math.exp(-(t - onset) / (onset === 0.034 ? 0.055 : 0.006));
              v = (band + high * 0.12 * bright) * env * 0.95;
            } else if (name === 'rim') {
              v = (Math.sin(TAU * 840 * tune * t) * 0.45 + Math.sin(TAU * 1720 * t) * 0.3) * Math.exp(-t / 0.014)
                + band * Math.exp(-t / 0.006) * 0.3;
            } else if (name === 'shaker') {
              v = (high + band * 0.35) * Math.sin(Math.PI * Math.min(1, t / dur)) * Math.exp(-t / 0.025) * 1.5;
            } else {
              // Inharmonic metallic partials plus an airy noise tail.
              let ring = 0;
              for (const f of metal) ring += Math.sin(TAU * f * t) * Math.sin(TAU * f * 2.71 * t);
              const decay = name === 'open' ? 0.105 : 0.018;
              v = (ring * 0.045 * bright + high * 0.5 + band * 0.12) * Math.exp(-t / decay);
            }
            data[i] = Math.tanh(v) * attack * tail;
          }
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
