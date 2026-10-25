'use strict';
// Синтезированный звук на WebAudio: удары с громкостью от импульса и панорамой по X,
// ноты кирпичей из текущего аккорда музыки, реверберация. Музыку пишет AK.Music (music.js).
(function (AK) {
  const { clamp } = AK.U;
  const A = { ready: false, musicOn: true, playing: false };
  let ctx, master, sfx, reverb, noiseBuf;
  const last = {};

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  A.init = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 5;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.85;
    master.connect(comp); comp.connect(ctx.destination);
    A.ctx = ctx; A.output = comp; // финальный микс — для анализатора и записи в music.html

    reverb = ctx.createConvolver();
    reverb.buffer = impulse(2.6, 3.2);
    const rv = ctx.createGain(); rv.gain.value = 0.5;
    reverb.connect(rv); rv.connect(master);

    sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
    const sSend = ctx.createGain(); sSend.gain.value = 0.22; sfx.connect(sSend); sSend.connect(reverb);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    A.ready = true;
    AK.Music.init(ctx, master, reverb, noiseBuf);
  };

  function impulse(dur, decay) {
    const len = Math.floor(ctx.sampleRate * dur);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function out(pan, bus) {
    const g = ctx.createGain();
    g.gain.value = 0;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan || 0, -1, 1);
      g.connect(p); p.connect(bus || sfx);
    } else g.connect(bus || sfx);
    return g;
  }
  function env(param, t, a, peak, d) {
    peak = Math.max(peak, 0.0002);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  // Ограничение частоты одинаковых звуков (чтобы не было «каши» при множестве контактов).
  function gate(name, gap) {
    const now = ctx.currentTime;
    if (last[name] && now - last[name] < gap) return false;
    last[name] = now;
    return true;
  }

  function tone(o) {
    const t = o.t != null ? o.t : ctx.currentTime;
    const a = o.a || 0.004, d = o.d || 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || d));
    if (o.detune) osc.detune.value = o.detune;
    const g = out(o.pan, o.bus);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = o.q || 0.8;
      f.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + a + d);
      osc.connect(f); node = f;
    }
    node.connect(g);
    env(g.gain, t, a, o.vol, d);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }

  function noise(o) {
    const t = o.t != null ? o.t : ctx.currentTime;
    const a = o.a || 0.002, d = o.d || 0.1;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass'; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    const g = out(o.pan, o.bus);
    src.connect(f); f.connect(g);
    env(g.gain, t, a, o.vol, d);
    src.start(t, Math.random() * 1.5); src.stop(t + a + d + 0.05);
  }

  // FM-колокольчик
  function bell(f, vol, pan, dur, ratio, index, t) {
    t = t != null ? t : ctx.currentTime;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    car.frequency.value = f; mod.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * index, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.05 + 0.01, t + dur * 0.6);
    mod.connect(mg); mg.connect(car.frequency);
    const g = out(pan);
    car.connect(g);
    env(g.gain, t, 0.002, vol, dur);
    car.start(t); mod.start(t); car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  // Металл: набор негармонических обертонов
  function metal(f, vol, pan, dur) {
    const parts = [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25], [13.34, 0.12]];
    for (const [r, a] of parts) tone({ f: f * r, d: dur / Math.sqrt(r), vol: vol * a, pan, type: 'sine' });
  }

  // Нота кирпича — тон аккорда, который сейчас играет музыка
  A.note = idx => mtof(AK.Music.brickNote(idx));

  // ---- Звуковые события ----
  A.paddle = (p, pan) => {
    if (!A.ready || !gate('paddle', 0.03)) return;
    const v = clamp(p / 900, 0.15, 1);
    tone({ f: 160, f2: 70, d: 0.14, vol: 0.55 * v, pan, glide: 0.1 });
    tone({ f: 420, f2: 260, d: 0.06, vol: 0.18 * v, pan, type: 'triangle' });
    noise({ f: 1800, q: 1.2, d: 0.03, vol: 0.25 * v, pan });
  };
  A.wall = (p, pan) => {
    if (!A.ready || !gate('wall', 0.025)) return;
    const v = clamp(p / 900, 0.1, 1);
    noise({ f: 3200, q: 2, d: 0.035, vol: 0.28 * v, pan, ft: 'bandpass' });
    tone({ f: 980, f2: 700, d: 0.04, vol: 0.08 * v, pan, type: 'triangle' });
  };
  A.brick = (note, p, pan) => {
    if (!A.ready || !gate('brick', 0.02)) return;
    const v = clamp(p / 800, 0.25, 1);
    bell(A.note(note), 0.22 * v, pan, 0.45, 3.5, 1.6);
    noise({ f: 2500, q: 3, d: 0.025, vol: 0.12 * v, pan });
  };
  A.brickBreak = (note, p, pan, big) => {
    if (!A.ready || !gate('break', 0.015)) return;
    const v = clamp(p / 800, 0.35, 1);
    bell(A.note(note), 0.26 * v, pan, 0.8, 2.0, 2.4);
    bell(A.note(note + 2), 0.1 * v, pan, 0.6, 3.01, 1.2);
    noise({ f: 2600, f2: 900, q: 0.9, d: big ? 0.35 : 0.2, vol: 0.32 * v, pan });
    noise({ f: 6000, q: 0.7, d: 0.08, vol: 0.12 * v, pan, ft: 'highpass' });
  };
  A.steel = (p, pan) => {
    if (!A.ready || !gate('steel', 0.04)) return;
    const v = clamp(p / 800, 0.2, 1);
    metal(560 + Math.random() * 40, 0.16 * v, pan, 0.6);
    noise({ f: 5000, q: 2, d: 0.02, vol: 0.2 * v, pan });
  };
  A.explode = pan => {
    if (!A.ready || !gate('boom', 0.05)) return;
    noise({ ft: 'lowpass', f: 2400, f2: 70, q: 0.6, a: 0.004, d: 0.9, vol: 0.9, pan });
    tone({ f: 90, f2: 28, d: 0.5, vol: 0.7, pan, glide: 0.45 });
    noise({ f: 900, f2: 200, q: 0.8, d: 0.25, vol: 0.35, pan, rate: 0.5 });
  };
  A.power = pan => {
    if (!A.ready) return;
    const t = ctx.currentTime;
    [0, 2, 4, 7].forEach((s, i) =>
      tone({ t: t + i * 0.06, f: A.note(5 + s), d: 0.22, vol: 0.16, pan, type: 'square', lp: 3000 }));
  };
  // Пойманный осколок: короткий колокольчик; серия поимок поднимается по тонам текущего аккорда
  A.shard = (n, pan) => {
    if (!A.ready || !gate('shard', 0.035)) return;
    bell(A.note(4 + Math.min(n - 1, 9)), 0.11, pan, 0.3, 4.0, 0.9);
    noise({ f: 7000, q: 1.5, d: 0.02, vol: 0.05, pan, ft: 'highpass' });
  };
  A.laser = pan => {
    if (!A.ready || !gate('laser', 0.05)) return;
    tone({ f: 1500, f2: 260, d: 0.13, vol: 0.12, pan, type: 'square', lp: 4000, glide: 0.12 });
  };
  A.launch = pan => {
    if (!A.ready) return;
    noise({ f: 600, f2: 3000, q: 1.5, a: 0.05, d: 0.18, vol: 0.18, pan });
    tone({ f: 300, f2: 600, d: 0.12, vol: 0.12, pan, type: 'triangle' });
  };
  A.lose = () => {
    if (!A.ready) return;
    tone({ f: 440, f2: 90, d: 1.0, vol: 0.3, type: 'sawtooth', lp: 1800, lp2: 200, glide: 0.95 });
    tone({ f: 445, f2: 92, d: 1.0, vol: 0.2, type: 'sawtooth', lp: 1800, lp2: 200, glide: 0.95 });
    noise({ ft: 'lowpass', f: 900, f2: 60, d: 0.8, vol: 0.3 });
    AK.Music.event('lose');
  };
  A.clear = () => {
    if (!A.ready) return;
    AK.Music.event('clear');
    const t = ctx.currentTime;
    [0, 2, 4, 5, 7, 9, 10].forEach((s, i) => bell(A.note(s + 3), 0.18, (i - 3) / 4, 1.4, 2.0, 1.4, t + i * 0.09));
  };
  A.start = () => {
    if (!A.ready) return;
    const t = ctx.currentTime;
    [0, 4, 7].forEach((s, i) => tone({ t: t + i * 0.08, f: mtof(57 + s), d: 0.5, vol: 0.15, type: 'triangle' }));
  };

  // Новая песня (новый стиль, темп, тональность) — на каждом уровне
  A.newSong = () => AK.Music.newSong();

  A.toggleMusic = () => { A.musicOn = !A.musicOn; return A.musicOn; };

  AK.A = A;
})(window.AK);
