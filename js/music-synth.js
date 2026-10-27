'use strict';
// Инструменты процедурной музыки: синтезированные барабаны, басы (саб, пила, acid, reese, FM, 808,
// треугольник), пэды, аккордовые стабы, плаки для арпеджио, лиды, эффекты и сайдчейн-дакинг.
(function (AK) {
  const S = {};
  let ctx, noiseBuf, pulse25, pulse12, pianoBody, pianoAir, kit, delayRight, transport, color;
  let busDrums, busBass, busDirt, busSynth, duck, delaySend, revSend, fbGain;
  let fbBase = 0.36;
  let openHat = null;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  S.mtof = mtof;

  // Отыгравшую ноту отключаем от графа сами. Иначе её узлы остаются подключёнными к шинам, пока до них
  // не доберётся сборщик мусора, и звуковой поток всё это время обсчитывает их тишину: нагрузка растёт минута
  // за минутой, пока звук не начнёт рваться. Узлы ноты копятся в voice; когда кончается её последний
  // источник, все они отключаются (см. voiced).
  let voice = null;
  const active = new Set();
  const keep = n => { if (voice) voice.push(n); return n; };
  function voiced(fn) {
    return (...a) => {
      const outer = voice, v = (voice = []);
      try { return fn(...a); } finally {
        voice = outer;
        let last = null;
        for (const n of v) if (n._end != null && (!last || n._end > last._end)) last = n;
        if (last) {
          active.add(v);
          last.onended = () => { for (const n of v) n.disconnect(); active.delete(v); };
        }
      }
    };
  }

  function gain(v, to) { const g = keep(ctx.createGain()); g.gain.value = v; if (to) g.connect(to); return g; }
  function filt(type, f, q) { const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; }
  function curve(k) {
    const c = new Float32Array(1024), n = Math.tanh(k);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(k * x) / n; }
    return c;
  }
  function makePulse(d) {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
    return ctx.createPeriodicWave(re, im);
  }

  S.init = function (c, dest, reverb, noise) {
    ctx = c; noiseBuf = noise; ports = new Map(); active.clear(); openHat = null;
    kit = AK.MKit.create(c);
    S.out = gain(0.27, dest);
    transport = gain(1, S.out);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.16;
    comp.connect(transport);
    const dc = filt('highpass', 28, 0.7); dc.connect(comp);
    const shelf = filt('lowshelf', 95); shelf.gain.value = 2.5; shelf.connect(dc);
    S.react = filt('lowpass', 20000, 0.9); S.react.connect(shelf);   // реакция на игру
    S.hp = filt('highpass', 10, 1); S.hp.connect(S.react);           // срез низов перед дропом
    S.lp = filt('lowpass', 20000, 1.1); S.lp.connect(S.hp);          // свипы секций
    busDrums = gain(1, S.lp);
    duck = gain(1, S.lp);
    busBass = gain(1, duck);
    const shaper = ctx.createWaveShaper(); shaper.curve = curve(2.4); shaper.oversample = '2x';
    busDirt = gain(0.75); busDirt.connect(shaper); shaper.connect(busBass);
    color = filt('lowpass', 9000, 0.6); color.connect(duck);
    const clean = filt('highpass', 170, 0.7); clean.connect(color);
    busSynth = gain(1, clean);
    S.delay = ctx.createDelay(2); S.delay.delayTime.value = 0.3;
    delayRight = ctx.createDelay(2); delayRight.delayTime.value = 0.3;
    const fb = fbGain = gain(fbBase), dl = filt('lowpass', 3200), dh = filt('highpass', 380);
    delaySend = gain(1); delaySend.connect(S.delay); S.delay.connect(dl); dl.connect(delayRight);
    delayRight.connect(dh); dh.connect(fb); fb.connect(S.delay);
    // True ping-pong repeats; filtered feedback leaves space for bass and the next phrase.
    if (ctx.createStereoPanner) {
      const pl = ctx.createStereoPanner(), pr = ctx.createStereoPanner();
      pl.pan.value = -0.78; pr.pan.value = 0.78;
      dl.connect(pl); pl.connect(gain(0.34, duck));
      dh.connect(pr); pr.connect(gain(0.34, duck));
    } else { dl.connect(gain(0.3, duck)); dh.connect(gain(0.3, duck)); }
    // Music gets its own return BEFORE its master gain. Pause/mute/master now include the wet signal.
    const room = ctx.createConvolver(), impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 1.85), ctx.sampleRate);
    const ir = AK.U.rng(0xaced);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < d.length; i++) {
        smooth += (ir() * 2 - 1 - smooth) * 0.35;
        d[i] = i < ctx.sampleRate * 0.018 ? 0 : smooth * Math.pow(1 - i / d.length, 3.4);
      }
    }
    room.buffer = impulse;
    const roomHP = filt('highpass', 420, 0.7), roomLP = filt('lowpass', 5500, 0.7);
    revSend = gain(0.8, roomHP); roomHP.connect(room); room.connect(roomLP); roomLP.connect(gain(0.24, duck));
    pulse25 = makePulse(0.25); pulse12 = makePulse(0.125);
    const wave = decay => {
      const re = new Float32Array(32), im = new Float32Array(32);
      for (let h = 1; h < 32; h++) im[h] = Math.exp(-h * decay) / Math.pow(h, 0.8);
      return ctx.createPeriodicWave(re, im);
    };
    pianoBody = wave(0.32); pianoAir = wave(0.075);
    mixParams = {
      master: S.out.gain, drums: busDrums.gain, bass: busBass.gain, synth: busSynth.gain,
      low: shelf.gain, reverb: revSend.gain, delay: fb.gain,
    };
  };

  // Микшер (music.html): master, drums, bass, synth — усиление; low — подъём низов в дБ;
  // reverb — посыл в реверберацию; delay — обратная связь задержки
  let mixParams = null;
  S.mix = (k, v) => {
    if (k === 'delay') fbBase = v;
    if (mixParams && mixParams[k]) mixParams[k].setTargetAtTime(v, ctx.currentTime, 0.03);
  };

  S.setTempo = bpm => {
    S.delay.delayTime.setTargetAtTime((60 / bpm) * 0.75, ctx.currentTime, 0.03);
    delayRight.delayTime.setTargetAtTime((60 / bpm) * 0.75, ctx.currentTime, 0.03);
  };
  S.expression = (t, energy) => color.frequency.setTargetAtTime(2800 + 9500 * energy, t, 0.22);
  S.gate = on => transport.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.012);
  // fade — постоянная времени затухания: на паузе звук обрывается сразу, а при смене песни
  // звучащие ноты гаснут за полсекунды под начало новой; ноты, расписанные вперёд, не звучат вовсе
  S.stop = (fade = 0.004) => {
    // Also cancel sources scheduled in the lookahead, so a new song cannot play the previous hook.
    const t = ctx.currentTime, end = t + 0.02 + fade * 5;
    for (const nodes of active) for (const n of nodes) {
      if (n._end != null && n._end > end) { try { n.stop(end); n._end = end; } catch (_) { /* already ended */ } }
      if (n._envelope) { cancelFrom(n.gain, t); n.gain.setTargetAtTime(0, t, fade); }
    }
    openHat = null;
  };
  S.stats = () => ({ voices: active.size, ports: [...ports.values()].reduce((n, p) => n + p.size, 0) });

  // ---------- Базовые блоки ----------
  // Порт: постоянный вход шины dest с посылами в эхо (send) и реверберацию (rev), один на каждое их сочетание.
  // Голоса подключаются к нему, а не заводят свои узлы посылов: звуковой поток обрабатывает каждый живой
  // узел на каждом такте рендера, даже молчащий, так что лишние узлы у каждой ноты — это заметная нагрузка.
  let ports = new Map();
  function port(dest, send, rev) {
    let byDest = ports.get(dest);
    if (!byDest) ports.set(dest, (byDest = new Map()));
    const key = send + '|' + rev;
    let p = byDest.get(key);
    if (!p) {
      p = ctx.createGain(); p.connect(dest);
      if (send) { const g = ctx.createGain(); g.gain.value = send; p.connect(g); g.connect(delaySend); }
      if (rev) { const g = ctx.createGain(); g.gain.value = rev; p.connect(g); g.connect(revSend); }
      byDest.set(key, p);
    }
    return p;
  }
  // Выход голоса: усиление (возвращается) → панорама → порт
  function vout(dest, pan, send, rev) {
    const g = keep(ctx.createGain()); g.gain.value = 0; g._envelope = true;
    let node = g;
    if (pan && ctx.createStereoPanner) { const p = keep(ctx.createStereoPanner()); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
    node.connect(port(dest, send || 0, rev || 0));
    return g;
  }
  function perc(p, t, a, peak, d) {
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    p.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function hold(p, t, a, peak, dur, rel) {
    const h = t + Math.max(a, dur);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, h);
    p.setTargetAtTime(0, h, rel / 3);
  }
  function osc(type, f, t, stop, detune) {
    const o = keep(ctx.createOscillator());
    if (type === 'pulse') o.setPeriodicWave(pulse25);
    else if (type === 'pulse12') o.setPeriodicWave(pulse12);
    else o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.value = detune;
    o.start(t); o.stop(stop); o._end = stop;
    return o;
  }
  // Петля шума с t до stop, с места offset
  function noiseSrc(t, stop, offset) {
    const src = keep(ctx.createBufferSource());
    src.buffer = noiseBuf; src.loop = true;
    src.start(t, offset || 0); src.stop(stop); src._end = stop;
    return src;
  }
  function glide(o, from, to, t, time) {
    if (!from) return;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + time);
  }
  function nhit(t, o) {
    const a = o.a || 0.001, end = t + a + o.d + 0.05;
    const src = noiseSrc(t, end, Math.random() * 1.5);
    src.playbackRate.value = o.rate || 1;
    const f = filt(o.type || 'bandpass', o.f, o.q);
    if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + a + o.d); }
    const g = vout(o.dest || busDrums, o.pan, 0, o.rev);
    src.connect(f); f.connect(g);
    perc(g.gain, t, a, o.vol, o.d);
    return g;
  }

  S.duckAt = (t, depth, rel) => {
    const p = duck.gain;
    p.setValueAtTime(1 - Math.min(depth, 0.8), t);
    p.setTargetAtTime(1, t + 0.012, rel);
  };

  // ---------- Барабаны ----------
  function sampleHit(t, name, vel, pan = 0, rev = 0) {
    const src = keep(ctx.createBufferSource()); src.buffer = kit.get(name, vel);
    const g = vout(busDrums, pan, 0, rev);
    g.gain.setValueAtTime(Math.max(0, vel), t);
    src.connect(g); src.start(t); src._end = t + src.buffer.duration; src.stop(src._end);
    return g;
  }
  S.kick = (t, vel, kind) => {
    if (kind !== 'chip') {
      sampleHit(t, kind === 'soft' ? 'soft' : 'punch', vel);
      S.duckAt(t, (kind === 'soft' ? 0.24 : 0.46) * vel, kind === 'soft' ? 0.07 : 0.095);
      return;
    }
    const soft = kind === 'soft', chip = kind === 'chip';
    const end = t + 0.5;
    const o = osc(chip ? 'triangle' : 'sine', 170, t, end);
    o.frequency.exponentialRampToValueAtTime(chip ? 60 : 52, t + 0.055);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const g = vout(busDrums);
    o.connect(g);
    const pk = vel * (soft ? 0.75 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.002);
    g.gain.setTargetAtTime(0.0001, t + 0.05, soft ? 0.07 : 0.09);
    if (!soft) nhit(t, { type: 'highpass', f: 2600, d: 0.012, vol: 0.28 * vel });
    S.duckAt(t, 0.5 * vel, 0.09);
  };

  S.snare = (t, vel, kind) => {
    if (kind !== 'chip') { sampleHit(t, kind === 'clap' || kind === 'rim' ? kind : 'snare', vel * 0.9, 0.06, 0.16); return; }
    nhit(t, { type: 'lowpass', f: 7000, d: 0.13, vol: 0.5 * vel, rate: 0.22 });
  };

  S.hat = (t, vel, open) => {
    if (openHat && !open) {
      try { cancelFrom(openHat.gain, t); openHat.gain.setTargetAtTime(0.0001, t, 0.008); } catch (e) { /* уже отыграл */ }
      openHat = null;
    }
    const g = sampleHit(t, open ? 'open' : 'closed', vel * (open ? 0.53 : 0.64), open ? 0.28 : -0.18);
    if (open) openHat = g;
  };

  S.tom = (t, vel, f) => {
    const o = osc('sine', f, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.28);
    const g = vout(busDrums, (f - 150) / 250, 0, 0.25); o.connect(g); perc(g.gain, t, 0.002, 0.6 * vel, 0.32);
    nhit(t, { f: f * 4, q: 1, d: 0.03, vol: 0.12 * vel });
  };
  S.crash = (t, vel) => {
    nhit(t, { type: 'highpass', f: 4500, q: 0.5, d: 1.8, vol: 0.2 * vel, rev: 0.5, a: 0.002 });
    nhit(t, { f: 7500, q: 0.8, d: 0.9, vol: 0.1 * vel });
  };
  S.shaker = (t, vel) => sampleHit(t, 'shaker', vel * 0.5, 0.38);
  S.perc = (t, vel, f) => {
    const o = osc('square', f, t, t + 0.12), b = filt('bandpass', f * 1.5, 4);
    const g = vout(busDrums, -0.3, 0.25, 0.1); o.connect(b); b.connect(g); perc(g.gain, t, 0.001, 0.22 * vel, 0.06);
  };

  // ---------- Эффекты ----------
  S.riser = (t, dur, vel) => {
    const src = noiseSrc(t, t + dur + 0.1);
    const f = filt('bandpass', 300, 2.5);
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur);
    const g = vout(busSynth, 0, 0.3, 0.5); src.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22 * vel, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    const o = osc('sawtooth', 110, t, t + dur + 0.1); o.frequency.exponentialRampToValueAtTime(990, t + dur);
    const lp = filt('lowpass', 1400, 1), g2 = vout(busSynth, 0, 0, 0.3); o.connect(lp); lp.connect(g2);
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.05 * vel, t + dur); g2.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  };
  S.impact = (t, vel) => {
    const o = osc('sine', 100, t, t + 1.4); o.frequency.exponentialRampToValueAtTime(30, t + 1.1);
    const g = vout(busDrums); o.connect(g); perc(g.gain, t, 0.003, 0.75 * vel, 1.1);
    nhit(t, { type: 'lowpass', f: 1600, f2: 70, d: 0.9, vol: 0.4 * vel, rev: 0.6 });
    S.crash(t, vel);
  };
  S.downlift = (t, dur) => nhit(t, { f: 5000, f2: 200, q: 1.5, d: dur, vol: 0.18, rev: 0.5, dest: busSynth });
  // Обратная тарелка: шум нарастает и обрывается ровно на сильную долю новой секции
  S.swell = (t, dur, vel) => {
    const end = t + dur;
    const src = noiseSrc(t, end + 0.05, Math.random());
    const f = filt('highpass', 1500, 0.7);
    f.frequency.setValueAtTime(1500, t); f.frequency.exponentialRampToValueAtTime(6500, end);
    const g = vout(busSynth, 0, 0, 0.4); src.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vel, end); g.gain.linearRampToValueAtTime(0.0001, end + 0.03);
  };
  // Эхо-бросок: на время len всё, что звучит, сильнее уходит в задержку, хвост тянется в новую секцию
  S.throw = (t, len, tail) => {
    delaySend.gain.setTargetAtTime(3.2, t, 0.01);
    delaySend.gain.setTargetAtTime(1, t + len, 0.05);
    fbGain.gain.setTargetAtTime(Math.max(fbBase, 0.6), t, 0.02);
    fbGain.gain.setTargetAtTime(fbBase, t + len + tail, tail / 3);
  };

  // Фильтр секций (свипы) и реакция на события игры.
  // Отмена автоматизации с момента t с удержанием значения: свип, который заканчивается ровно в t,
  // доходит до конца (cancelScheduledValues отменил бы его целиком и фильтр откатился бы назад).
  function cancelFrom(p, t) {
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
    else p.cancelScheduledValues(t + 1e-3);
  }
  S.sweep = (t, from, to, dur) => {
    const p = S.lp.frequency;
    cancelFrom(p, t);
    p.setValueAtTime(from, t);
    p.exponentialRampToValueAtTime(to, t + dur);
  };
  S.setLp = (t, f, tc) => { const p = S.lp.frequency; cancelFrom(p, t); p.setTargetAtTime(f, t, tc); };
  // Ломаная кривая фильтра: pts = [[частота, через сколько секунд], ...]
  S.lpPath = (t, pts) => {
    const p = S.lp.frequency;
    cancelFrom(p, t);
    p.setValueAtTime(pts[0][0], t);
    for (let i = 1; i < pts.length; i++) { t += pts[i][1]; p.exponentialRampToValueAtTime(pts[i][0], t); }
  };
  S.hpSweep = (t, to, dur) => {
    const p = S.hp.frequency;
    cancelFrom(p, t);
    p.setValueAtTime(20, t);
    p.exponentialRampToValueAtTime(to, t + dur);
  };
  S.hpReset = t => { const p = S.hp.frequency; cancelFrom(p, t); p.setTargetAtTime(10, t, 0.006); };
  S.dip = () => {
    const now = ctx.currentTime, p = S.react.frequency;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(380, now, 0.04);
    p.setTargetAtTime(20000, now + 1.1, 0.5);
  };

  // ---------- Басы ----------
  function subLayer(t, f, dur, vel, from, end) {
    const k = f < 70 ? 1 : 0.5;
    const s = osc('sine', f * k, t, end);
    glide(s, from && from * k, f * k, t, Math.min(0.08, dur * 0.5));
    const g = vout(busBass); s.connect(g); hold(g.gain, t, 0.006, 0.55 * vel, dur, 0.06);
  }

  S.bass = (t, midi, dur, vel, tone, o) => {
    o = o || {};
    const f = mtof(midi), end = t + dur + 0.4;
    const from = o.slide != null ? mtof(o.slide) : 0;
    const gt = Math.min(0.08, dur * 0.5);
    const acc = o.accent ? 1 : 0;
    switch (tone) {
      case 'saw': {
        const g = vout(busDirt), lp = filt('lowpass', f * 2, 5);
        lp.frequency.setValueAtTime(f * (5 + acc * 6), t); lp.frequency.setTargetAtTime(f * 1.6, t + 0.005, 0.07);
        for (const d of [-8, 8]) { const s = osc('sawtooth', f, t, end, d); glide(s, from, f, t, gt); s.connect(lp); }
        lp.connect(g); hold(g.gain, t, 0.004, 0.3 * vel, dur, 0.05);
        subLayer(t, f, dur, vel * 0.55, from, end);
        break;
      }
      case 'acid': {
        const g = vout(busBass, 0, 0.12), lp = filt('lowpass', 400, 13);
        const peak = 500 + (acc ? 2600 : 1100) * (0.7 + Math.random() * 0.3);
        lp.frequency.setValueAtTime(peak, t); lp.frequency.setTargetAtTime(Math.max(f * 1.5, 160), t + 0.01, 0.06 + acc * 0.07);
        const s = osc('sawtooth', f, t, end); glide(s, from, f, t, gt); s.connect(lp); lp.connect(g);
        hold(g.gain, t, 0.003, (0.2 + acc * 0.1) * vel, dur, 0.03);
        subLayer(t, f, dur, vel * 0.35, from, end);
        break;
      }
      case 'reese': {
        const g = vout(busDirt), lp = filt('lowpass', 420, 1.5);
        lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(760, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(300, t + dur);
        for (const d of [-17, 13, 0]) { const s = osc('sawtooth', f, t, end, d); glide(s, from, f, t, gt); s.connect(lp); }
        lp.connect(g); hold(g.gain, t, 0.03, 0.22 * vel, dur, 0.12);
        subLayer(t, f, dur, vel * 0.65, from, end);
        break;
      }
      case 'pluck': {
        const g = vout(busBass), lp = filt('lowpass', f * 6, 3);
        lp.frequency.setValueAtTime(f * 10, t); lp.frequency.setTargetAtTime(f * 1.3, t, 0.05);
        const s = osc('square', f, t, end); glide(s, from, f, t, gt); s.connect(lp); lp.connect(g);
        hold(g.gain, t, 0.003, 0.24 * vel, Math.min(dur, 0.22), 0.09);
        subLayer(t, f, dur, vel * 0.5, from, end);
        break;
      }
      case 'fm': {
        const g = vout(busBass), car = osc('sine', f, t, end), mod = osc('sine', f * 2, t, end), mg = keep(ctx.createGain());
        glide(car, from, f, t, gt); glide(mod, from * 2, f * 2, t, gt);
        mg.gain.setValueAtTime(f * (2.5 + acc * 2), t); mg.gain.setTargetAtTime(f * 0.3, t + 0.005, 0.08);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        hold(g.gain, t, 0.004, 0.36 * vel, dur, 0.06);
        subLayer(t, f, dur, vel * 0.4, from, end);
        break;
      }
      case '808': {
        const g = vout(busDirt), s = osc('sine', f, t, end + 0.3);
        if (from) glide(s, from, f, t, 0.12);
        else { s.frequency.setValueAtTime(f * 2.2, t); s.frequency.exponentialRampToValueAtTime(f, t + 0.04); }
        s.connect(g); hold(g.gain, t, 0.003, 0.8 * vel, dur, 0.18);
        nhit(t, { type: 'highpass', f: 2200, d: 0.01, vol: 0.2 * vel });
        break;
      }
      case 'tri': {
        const g = vout(busBass), s = osc('triangle', f, t, end); glide(s, from, f, t, gt);
        s.connect(g); hold(g.gain, t, 0.002, 0.55 * vel, dur * 0.9, 0.02);
        break;
      }
      default: { // sub
        const g = vout(busBass), s = osc('sine', f, t, end); glide(s, from, f, t, gt);
        s.connect(g); hold(g.gain, t, 0.006, 0.6 * vel, dur, 0.06);
        const s2 = osc('triangle', f * 2, t, end); glide(s2, from * 2, f * 2, t, gt);
        const g2 = vout(busBass); s2.connect(g2); hold(g2.gain, t, 0.006, 0.08 * vel, dur, 0.06);
      }
    }
  };

  // ---------- Пэды, стабы ----------
  const PAD_LV = { saw: 0.045, string: 0.032, glass: 0.06, square: 0.03, organ: 0.045 };
  // Пэд звучит широко: расстроенные голоса одной ноты и соседние звуки аккорда расходятся влево и вправо
  S.pad = (t, midis, dur, vel, kind) => {
    const release = Math.min(0.65, dur * 0.35), end = t + dur + release + 0.05;
    const g = vout(busSynth, 0, 0.1, 0.6);
    const side = [-0.6, 0.6].map(pan => {
      const lp = filt('lowpass', 5000, 0.8);
      if (ctx.createStereoPanner) { const p = keep(ctx.createStereoPanner()); p.pan.value = pan; lp.connect(p); p.connect(g); }
      else lp.connect(g);
      if (kind === 'saw' || kind === 'string') {
        lp.frequency.setValueAtTime(450, t);
        lp.frequency.linearRampToValueAtTime(kind === 'saw' ? 2400 : 1700, t + dur * 0.5);
        lp.frequency.linearRampToValueAtTime(650, t + dur + 0.8);
      }
      return lp;
    });
    midis.forEach((m, i) => {
      const f = mtof(m), a = side[i % 2], b = side[(i + 1) % 2];
      if (kind === 'saw') { osc('sawtooth', f, t, end, -9).connect(side[0]); osc('sawtooth', f, t, end, 9).connect(side[1]); }
      else if (kind === 'string') {
        osc('sawtooth', f, t, end, -12).connect(side[0]); osc('sawtooth', f, t, end, 11).connect(side[1]);
        osc('sawtooth', f, t, end, 0).connect(a);
      } else if (kind === 'glass') { osc('sine', f, t, end).connect(a); osc('triangle', f * 2, t, end, 4).connect(gain(0.3, b)); }
      else if (kind === 'square') osc('pulse12', f, t, end).connect(a);
      else [1, 2, 4].forEach((h, k) => osc('sine', f * h, t, end).connect(gain([1, 0.5, 0.25][k], k === 1 ? b : a)));
    });
    const lv = (PAD_LV[kind] || 0.045) * vel * (3 / Math.max(3, midis.length));
    hold(g.gain, t, Math.min(dur * 0.3, kind === 'square' ? 0.02 : kind === 'glass' ? 0.18 : 0.35), lv, dur, release);
  };

  // Velocity-sensitive keys: a damped harmonic body + a short hammer layer, or FM tines.
  // PeriodicWave is bandlimited by Web Audio; two or three oscillators per key keep chords inexpensive.
  function keys(t, midi, dur, vel, kind, pan) {
    const f = mtof(midi), release = kind === 'piano' ? 0.16 : 0.24, end = t + dur + release + 0.03;
    const g = vout(busSynth, pan, 0.12, 0.28), body = osc('sine', f, t, end);
    const touch = Math.max(0.1, Math.min(1.2, vel));
    if (kind === 'piano') {
      body.setPeriodicWave(pianoBody);
      const hammer = osc('sine', f, t, end, 2.5), hg = gain(0, g);
      hammer.setPeriodicWave(pianoAir); hammer.connect(hg);
      perc(hg.gain, t, 0.002, 0.45 * touch * touch, Math.min(0.22, dur));
    } else {
      const mod = osc('sine', f * 1.002, t, end), mg = gain(0);
      mod.connect(mg); mg.connect(body.frequency);
      mg.gain.setValueAtTime(f * (0.4 + 1.9 * touch * touch), t);
      mg.gain.exponentialRampToValueAtTime(f * 0.035, t + Math.min(dur, 0.65));
      const tine = osc('sine', f * 3, t, end), tg = gain(0, g); tine.connect(tg);
      perc(tg.gain, t, 0.002, touch * 0.16, Math.min(0.3, dur));
    }
    body.connect(g);
    const peak = (kind === 'piano' ? 0.15 : 0.17) * touch;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * Math.exp(-dur / 0.75)), t + Math.max(0.01, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  }

  S.stab = (t, midis, dur, vel, kind, pan) => {
    if (kind === 'piano' || kind === 'epiano') {
      midis.forEach((m, i) => keys(t + i * 0.004, m, Math.max(0.18, dur), vel * 0.62 * 3 / Math.max(3, midis.length), kind,
        (pan || 0) + (i / Math.max(1, midis.length - 1) - 0.5) * 0.45));
      return;
    }
    const end = t + dur + 0.25;
    const g = vout(busSynth, pan || 0, 0.25, 0.35);
    const lp = filt('lowpass', 3000, 2);
    lp.frequency.setValueAtTime(kind === 'chip' ? 7000 : 3400, t);
    lp.frequency.setTargetAtTime(kind === 'chip' ? 7000 : kind === 'organ' ? 1800 : 520, t + 0.01, 0.08);
    lp.connect(g);
    for (const m of midis) {
      const f = mtof(m);
      if (kind === 'chip') osc('pulse', f, t, end).connect(lp);
      else if (kind === 'organ') [1, 2, 3].forEach((h, i) => osc('sine', f * h, t, end).connect(gain([1, 0.6, 0.3][i], lp)));
      else for (const d of [-7, 7]) osc('sawtooth', f, t, end, d).connect(lp);
    }
    hold(g.gain, t, 0.004, (0.07 * vel * 3) / Math.max(3, midis.length), dur, 0.08);
  };

  // ---------- Плаки (арпеджио) ----------
  S.pluck = (t, midi, dur, vel, kind, pan) => {
    if (kind === 'piano' || kind === 'epiano') { keys(t, midi, Math.max(0.15, dur), vel * 0.8, kind, pan || 0); return; }
    // нота живёт, пока слышна огибающая: арпеджио играет шестнадцатыми, и лишние полсекунды на каждую ноту
    // заметно добавляют звуковому потоку работы
    const life = kind === 'square' ? dur * 0.8 + 0.12 : kind === 'chip' ? dur * 0.85 + 0.05
      : kind === 'bell' ? 0.71 : kind === 'marimba' ? 0.36 : kind === 'glass' ? 0.61 : 0.31;
    const f = mtof(midi), end = t + life + 0.02;
    const g = vout(busSynth, pan, 0.18, 0.25);
    switch (kind) {
      case 'square': { const lp = filt('lowpass', 4000, 1); osc('square', f, t, end).connect(lp); lp.connect(g); hold(g.gain, t, 0.002, 0.05 * vel, dur * 0.8, 0.03); break; }
      case 'chip': { osc('pulse', f, t, end).connect(g); hold(g.gain, t, 0.001, 0.05 * vel, dur * 0.85, 0.01); break; }
      case 'bell': {
        const car = osc('sine', f, t, end), mod = osc('sine', f * 3.5, t, end), mg = keep(ctx.createGain());
        mg.gain.setValueAtTime(f * 2, t); mg.gain.setTargetAtTime(f * 0.1, t, 0.12);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g); perc(g.gain, t, 0.002, 0.09 * vel, 0.7);
        break;
      }
      case 'marimba': {
        osc('sine', f, t, end).connect(g);
        const g2 = gain(0.3, g); const o2 = osc('sine', f * 4, t, end); o2.connect(g2);
        g2.gain.setValueAtTime(0.3, t); g2.gain.setTargetAtTime(0, t, 0.03);
        perc(g.gain, t, 0.002, 0.14 * vel, 0.35);
        break;
      }
      case 'glass': { osc('sine', f, t, end).connect(g); osc('sine', f * 2.01, t, end).connect(gain(0.4, g)); perc(g.gain, t, 0.002, 0.08 * vel, 0.6); break; }
      default: { // pluck
        const lp = filt('lowpass', f * 8, 2);
        lp.frequency.setValueAtTime(Math.min(f * 9, 12000), t); lp.frequency.setTargetAtTime(f * 1.4, t, 0.06);
        osc('sawtooth', f, t, end).connect(lp); lp.connect(g); perc(g.gain, t, 0.002, 0.11 * vel, 0.3);
      }
    }
  };

  // ---------- Лид ----------
  const LEAD_LV = { supersaw: 0.052, saw: 0.07, square: 0.055, sine: 0.11, chip: 0.055, fm: 0.09 };
  S.lead = (t, midi, dur, vel, kind, o) => {
    o = o || {};
    if (kind === 'piano' || kind === 'epiano') { keys(t, midi, dur, vel, kind, o.pan || 0); return; }
    const f = mtof(midi), end = t + dur + 0.35;
    const g = vout(busSynth, o.pan || 0, 0.3, 0.3);
    const lp = filt('lowpass', 6000, 1.2); lp.connect(g);
    const oscs = [];
    switch (kind) {
      case 'supersaw':
        for (const [detune, pan] of [[-12, -0.65], [0, 0], [12, 0.65]]) {
          const x = osc('sawtooth', f, t, end, detune);
          if (ctx.createStereoPanner) {
            const p = keep(ctx.createStereoPanner()); p.pan.value = pan;
            x.connect(p); p.connect(lp); x._routed = true;
          }
          oscs.push([x, 1]);
        }
        lp.frequency.setValueAtTime(2400 + 3800 * Math.min(1, vel), t);
        lp.frequency.setTargetAtTime(1800 + vel * 1200, t + 0.03, 0.18);
        break;
      case 'saw': oscs.push([osc('sawtooth', f, t, end, -7), 1], [osc('sawtooth', f, t, end, 7), 1]);
        lp.frequency.setValueAtTime(4500, t); lp.frequency.setTargetAtTime(2200, t, 0.18); break;
      case 'square': oscs.push([osc('square', f, t, end), 1], [osc('square', f / 2, t, end, 4), 0.5]); lp.frequency.value = 3200; break;
      case 'chip': oscs.push([osc('pulse', f, t, end), 1]); lp.frequency.value = 9000; break;
      case 'fm': {
        const car = osc('sine', f, t, end), mod = osc('sine', f * 2, t, end), mg = keep(ctx.createGain());
        mg.gain.setValueAtTime(f * 1.6, t); mg.gain.setTargetAtTime(f * 0.4, t, 0.2);
        mod.connect(mg); mg.connect(car.frequency);
        oscs.push([car, 1], [mod, 2]);
        break;
      }
      default: oscs.push([osc('sine', f, t, end), 1], [osc('triangle', f, t, end, 5), 1]);
    }
    for (const [x, k] of oscs) {
      if (o.glide) glide(x, S.mtof(o.glide) * k, f * k, t, 0.07);
      if (!x._routed && (kind !== 'fm' || x === oscs[0][0])) x.connect(lp); // модулятор FM в фильтр не идёт
    }
    // вибрато нарастает к середине ноты
    const lfo = osc('sine', 5.2 + Math.random() * 0.8, t, end), lg = keep(ctx.createGain());
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(o.vib != null ? o.vib : 10, t + Math.min(dur, 0.4));
    lfo.connect(lg);
    for (const [x] of oscs) lg.connect(x.detune);
    hold(g.gain, t, 0.012, (LEAD_LV[kind] || 0.08) * vel, dur, 0.12);
  };

  for (const k of ['kick', 'snare', 'hat', 'tom', 'crash', 'shaker', 'perc', 'riser', 'impact', 'downlift', 'swell',
    'bass', 'pad', 'stab', 'pluck', 'lead']) S[k] = voiced(S[k]);

  AK.MSynth = S;
})(window.AK);
