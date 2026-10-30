'use strict';
// Процедурный композитор. Бесконечная песня из секций (интро, грув, нарастание, дроп, брейк, бридж).
// Цельной песню делают общие инструменты (kit) и темы — гармония, бит, бас, арпеджио, мотив, — которые
// секции берут и варьируют. Переход в следующую секцию готовится за пару тактов: связующие аккорды,
// затакт мелодии, подход баса, эффекты; партии сменяются не разом, а по очереди.
(function (AK) {
  const { U } = AK;
  const MG = AK.MGen, SY = AK.MSynth;
  const M = {};
  let mix = { drums: 1, bass: 1, pad: 1, stab: 1, arp: 1, lead: 1 };
  // Синтезатор с той же API, только удары и ноты ещё и записываются для цветомузыки (см. M.lights).
  // У ударных громкость — второй аргумент; у тональных — четвёртый, а второй и третий — нота и длительность.
  const S = Object.create(SY);
  const DRUM = ['kick', 'snare', 'hat', 'perc', 'crash', 'impact', 'tom', 'shaker'], TONAL = ['bass', 'pad', 'stab', 'pluck', 'lead'];
  for (const k of DRUM) S[k] = (...a) => {
    a[1] *= mix.drums;
    const name = k === 'tom' ? 'perc' : k === 'shaker' ? 'hat' : k;
    light(a[0], name, a[1]); return SY[k](...a);
  };
  for (const k of TONAL) S[k] = (...a) => {
    a[3] *= mix[k === 'pluck' ? 'arp' : k];
    light(a[0], k, a[3], a[1], a[2]); return SY[k](...a);
  };
  // Ручные настройки (их меняет music.html). null — решает композитор.
  const cfg = M.cfg = {
    style: null, lockStyle: false, bpm: null, key: null, mode: null, swing: null,
    evolve: 1, modulate: 0.35,
    mute: { drums: false, bass: false, arp: false, pad: false, stab: false, lead: false },
  };
  let ctx = null;
  let r = U.rng(1);
  let intensity = 0.3, inten = 0.3;
  let timer = null, running = false, hotBars = 0, calmBars = 0;

  // ---------- Стили ----------
  // live — доля песен с живыми ударными (записи вместо синтеза; бочка всегда синтез). piano, marimba, vibes,
  // kalimba, sax — записанные инструменты (music-samples.js)
  const PAL = {
    synthwave: {
      bpm: [98, 114], swing: [0, 0.03], modes: [['aeolian', 3], ['dorian', 2], ['harmonic', 1], ['lydian', 0.4]],
      drums: [['four', 2], ['break', 2], ['half', 0.8]], kick: 'punch', snare: [['snare', 2], ['clap', 1]], live: 0.45,
      bass: [['rolling', 3], ['offbeat', 1.5], ['synco', 2], ['gallop', 1.2]], bassTone: [['saw', 3], ['pluck', 1.5], ['fm', 1]],
      arp: [['pluck', 3], ['piano', 1], ['glass', 1]], lead: [['supersaw', 4], ['sax', 1.6], ['piano', 1], ['sine', 1]],
      pad: [['saw', 3], ['string', 2]], stab: [['saw', 1], ['epiano', 0.4]],
      ext: [['triad', 3], ['seven', 2], ['add9', 1.5], ['sus2', 1]], leadP: 0.7,
    },
    techno: {
      bpm: [122, 130], swing: [0, 0.02], modes: [['phrygian', 2], ['aeolian', 2], ['dorian', 1.5]],
      drums: [['four', 6], ['break', 0.6]], kick: 'punch', snare: [['clap', 3], ['snare', 1]],
      bass: [['acid', 3], ['rolling', 1.5], ['offbeat', 2]], bassTone: [['acid', 3], ['saw', 1], ['sub', 1]],
      arp: [['pluck', 2], ['bell', 1], ['square', 1]], lead: [['saw', 1], ['fm', 1]],
      pad: [['string', 1], ['glass', 1]], stab: [['saw', 2], ['organ', 1]],
      ext: [['triad', 2], ['seven', 2], ['sus4', 1]], leadP: 0.35,
    },
    dnb: {
      bpm: [164, 174], swing: [0, 0.02], modes: [['aeolian', 2], ['dorian', 2], ['harmonic', 1]],
      drums: [['dnb', 4], ['half', 1]], kick: 'punch', snare: [['snare', 3]], live: 0.7,
      bass: [['long', 3], ['synco', 2], ['808', 0.8]], bassTone: [['reese', 4], ['sub', 1.5], ['fm', 1]],
      arp: [['piano', 2], ['glass', 2], ['vibes', 1.5], ['pluck', 1]], lead: [['piano', 2], ['epiano', 1.5], ['supersaw', 1]],
      pad: [['string', 2], ['glass', 2]], stab: [['epiano', 1]],
      ext: [['seven', 3], ['add9', 2], ['triad', 1]], leadP: 0.6,
    },
    lofi: {
      bpm: [76, 90], swing: [0.08, 0.16], modes: [['dorian', 3], ['aeolian', 2], ['lydian', 0.8], ['mixolydian', 0.8]],
      drums: [['boom', 4], ['half', 1]], kick: 'soft', snare: [['snare', 2], ['rim', 1]], live: 1,
      bass: [['walking', 2], ['synco', 2], ['long', 1]], bassTone: [['sub', 2], ['pluck', 1], ['fm', 1]],
      arp: [['marimba', 1], ['vibes', 2], ['kalimba', 1.2], ['epiano', 3], ['piano', 2]],
      lead: [['epiano', 3], ['piano', 3], ['vibes', 1], ['sax', 1]],
      pad: [['organ', 1], ['glass', 1]], stab: [['epiano', 4]],
      ext: [['seven', 4], ['add9', 2], ['sus2', 1]], leadP: 0.6,
    },
    trap: {
      bpm: [136, 150], swing: [0, 0.04], modes: [['harmonic', 2], ['phrygian', 2], ['aeolian', 2]],
      drums: [['half', 5]], kick: 'punch', snare: [['clap', 2], ['snare', 1]],
      bass: [['808', 5]], bassTone: [['808', 5]],
      arp: [['bell', 2], ['piano', 2], ['kalimba', 1.5], ['marimba', 1]], lead: [['piano', 3], ['fm', 1], ['sine', 1]],
      pad: [['glass', 2], ['string', 1]], stab: [['epiano', 0.5]],
      ext: [['triad', 3], ['seven', 1]], leadP: 0.7,
    },
    chip: {
      bpm: [132, 152], swing: [0, 0.02], modes: [['aeolian', 2], ['dorian', 1], ['harmonic', 1], ['mixolydian', 1], ['ionian', 0.6]],
      drums: [['chip', 5]], kick: 'chip', snare: [['chip', 4]],
      bass: [['chip', 4], ['gallop', 1]], bassTone: [['tri', 4]],
      arp: [['chip', 4]], lead: [['chip', 4]], pad: [['square', 1]], stab: [['chip', 1]],
      ext: [['triad', 4], ['seven', 1]], leadP: 0.85,
    },
  };

  // ---------- Секции ----------
  const SEC = {
    intro: { e: 0.2, len: [4, 8], drums: ['none', 'sparse', 'pulse'], bass: 0.35, bassStyle: 'long', arp: 0.7, pad: 0.9, lead: 0, stab: 0.1, lp: 1400 },
    groove: { e: 0.55, len: [8, 16], drums: 'main', bass: 1, arp: 0.6, pad: 0.5, lead: 0.6, stab: 0.35 },
    build: { e: 0.75, len: [4, 8], drums: 'main', bass: 0.7, arp: 1, pad: 0.6, lead: 0, stab: 0.2 },
    drop: { e: 1, len: [8, 16], drums: 'main', bass: 1, arp: 0.5, pad: 0.45, lead: 1, stab: 0.5 },
    break: { e: 0.3, len: [8], drums: ['none', 'sparse'], bass: 0.5, bassStyle: 'long', arp: 0.5, pad: 1, lead: 0.8, stab: 0.2, lp: 2600 },
    bridge: { e: 0.6, len: [8], drums: 'alt', bass: 1, arp: 0.7, pad: 0.7, lead: 0.7, stab: 0.3, modulate: true },
  };
  const NEXT = {
    intro: [['groove', 3], ['build', 1.5]],
    groove: [['build', 3], ['groove', 1], ['break', 1.2], ['bridge', 1]],
    build: [['drop', 6], ['groove', 0.5]],
    drop: [['break', 2], ['groove', 2], ['drop', 0.8], ['bridge', 1.2]],
    break: [['build', 3], ['groove', 1.5]],
    bridge: [['build', 2], ['drop', 1], ['groove', 1]],
  };
  const STABS = [[2, 6, 10, 14], [0, 3, 6, 10, 12], [3, 6, 11, 14], [0, 6, 12], [2, 5, 8, 11, 14], [0, 10]];

  // Аккорды связок строятся от абсолютного корня: доминанта новой тональности, ♭VI–♭VII и т.п.
  const Q = { dom7: [0, 4, 7, 10], maj: [0, 4, 7], min: [0, 3, 7], min7: [0, 3, 7, 10], hdim: [0, 3, 6, 10], sus4: [0, 5, 7] };
  const QN = { dom7: '7', maj: '', min: 'm', min7: 'm7', hdim: 'm7b5', sus4: 'sus4' };
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const LAYERS = ['bass', 'arp', 'pad', 'stab'];
  const DRUMS = ['kick', 'snare', 'hat', 'perc'];
  const NO_TR = { fx: [], turn: [], pk: [], T: null, pedalFrom: Infinity, leadFrom: Infinity };

  const song = {
    pal: PAL.synthwave, palName: '', tpal: null, tpalName: null, bpm: 110, swing: 0, key: 38, mode: 'aeolian',
    kit: null, theme: null, sec: null, bar: 0, step: 0, nextT: 0, count: 0, seed: 0, homeKey: 38, homeMode: 'aeolian',
    voicing: null, lastBass: null, lastLead: null, lastLeadDeg: null, arpI: 0, pending: null,
  };
  // Расписанные шаги: по ним M.state() показывает то, что звучит сейчас, а не то, что уже запланировано
  const heard = [];
  let lastHeard = null;
  // То же для цветомузыки: начала шагов со сквозным номером (по ним идёт счёт долей) и прозвучавшие ноты
  const steps = [], lit = [];
  let stepN = 0;
  function light(t, name, v, m, d) { lit.push({ t, name, v, m, d }); if (lit.length > 512) lit.splice(0, 256); }

  const tp = () => song.tpal || song.pal; // палитра тембров (может дрейфовать)
  const clone = o => JSON.parse(JSON.stringify(o));
  const isBeat = p => p.style !== 'none' && p.style !== 'sparse' && p.style !== 'pulse';
  function fold(m, lo, hi) { while (m < lo) m += 12; while (m > hi) m -= 12; return m; }
  const stepDur = () => 60 / song.bpm / 4;

  // ---------- Аккорды ----------
  function chordIdx(s, bar, st) { return Math.floor((bar + st / 16) / s.chordBars) % s.prog.length; }
  function chordAt(s, bar, st) { return s.prog[chordIdx(s, bar, st)]; }
  // Аккорд с учётом связки в последнем такте секции
  function chordNow(s, bar, st) {
    if (s.tr && bar === s.len - 1) {
      let c = null;
      for (const [k, ch] of s.tr.turn) if (st >= k) c = ch;
      if (c) return c;
    }
    return chordAt(s, bar, st);
  }
  function chordStarts(s, bar, st) {
    if (s.tr && bar === s.len - 1 && s.tr.turn.some(([k]) => k === st)) return true;
    return (bar * 16 + st) % (s.chordBars * 16) === 0;
  }
  // Сколько шагов звучит аккорд от этого шага до следующей смены
  function chordSpan(s, bar, st) {
    const pos = bar * 16 + st, len = s.chordBars * 16;
    let end = Math.min((Math.floor(pos / len) + 1) * len, s.len * 16);
    if (s.tr) for (const [k] of s.tr.turn) { const p = (s.len - 1) * 16 + k; if (p > pos && p < end) end = p; }
    return end - pos;
  }
  function chordMidis(ch) {
    if (ch.abs) { const root = fold(ch.root + 60, 55, 66); return Q[ch.q].map(i => root + i); }
    return MG.chordMidis(fold(song.key + 24, 55, 66), song.mode, ch);
  }
  function chordName(ch, key = song.key, mode = song.mode) {
    if (ch.abs) return NOTE[ch.root] + QN[ch.q];
    const at = d => MG.deg2midi(key, mode, ch.deg + d);
    const root = at(0), third = at(2) - root, fifth = at(4) - root, sev = at(6) - root;
    let q = third === 3 ? 'm' : '';
    if (fifth === 6) q = third === 3 ? 'dim' : '(b5)';
    if (fifth === 8) q += '+';
    let ext = '';
    if (ch.ext === 'seven' && q === 'dim') { q = ''; ext = sev === 9 ? 'dim7' : 'm7b5'; }
    else if (ch.ext === 'seven') ext = sev === 11 ? 'maj7' : '7';
    else if (ch.ext === 'sus2' || ch.ext === 'sus4') { q = ''; ext = ch.ext; }
    else if (ch.ext === 'add9') ext = q === 'dim' ? '(add9)' : 'add9';
    return NOTE[root % 12] + q + ext;
  }

  // ---------- Песня ----------
  M.newSong = function (seed) {
    const fixed = Number.isFinite(seed);
    song.seed = fixed ? seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    r = U.rng(song.seed);
    const names = Object.keys(PAL).filter(n => fixed || n !== song.palName);
    song.palName = cfg.style && PAL[cfg.style] ? cfg.style : r.pick(names);
    const pal = song.pal = PAL[song.palName];
    song.tpal = null; song.tpalName = null;
    song.bpm = cfg.bpm || r.int(pal.bpm[0], pal.bpm[1]);
    song.swing = cfg.swing != null ? cfg.swing : r.range(pal.swing[0], pal.swing[1]);
    song.key = cfg.key != null ? fold(36 + cfg.key, 33, 44) : 33 + r.int(0, 11);
    song.mode = cfg.mode || r.weighted(pal.modes);
    song.homeKey = song.key; song.homeMode = song.mode;
    inten = intensity; hotBars = calmBars = 0;
    // инструменты песни: секции берут их отсюда, а меняются они по одному за переход
    song.kit = {
      bass: song.palName === 'chip' ? 'tri' : r.weighted(pal.bassTone), arp: r.weighted(pal.arp), pad: r.weighted(pal.pad),
      stab: r.weighted(pal.stab), lead: r.weighted(pal.lead), snare: r.weighted(pal.snare),
      percF: r.pick([520, 680, 800, 1040]), stabR: r.pick(STABS),
    };
    song.kit.live = r.chance(pal.live || 0);
    S.liveDrums(song.kit.live);
    want(pal);
    const bassStyle = r.weighted(pal.bass);
    song.theme = {
      prog: MG.progression(r, 4, pal.ext, song.mode), motif: MG.motif(r, song.palName === 'techno' ? 0.35 : 0.65, song.palName), phrases: {},
      drums: MG.drumPattern(r, r.weighted(pal.drums)), bassStyle, bass: MG.bassPattern(r, bassStyle), arp: MG.arp(r),
    };
    song.count = 0; song.sec = null; song.voicing = null; song.pending = null; song.harmony = null;
    song.lastBass = song.lastLead = song.lastLeadDeg = null; song.arpI = 0;
    heard.length = 0; lastHeard = null;
    steps.length = lit.length = 0; stepN = 0;
    song.nextT = ctx ? ctx.currentTime + 0.05 : 0;
    if (ctx) { S.stop(0.1); S.setTempo(song.bpm); } // прошлая песня гаснет, а не обрывается
    activate(makeSection('intro', null), song.nextT);
    return song.seed;
  };

  // Записи инструментов палитры грузятся заранее, пока они не нужны
  const want = p => S.want([...p.arp, ...p.lead, ...p.stab].map(k => k[0]));

  // Куда модулировать. Сама смена тональности готовится связкой в конце секции.
  function modTarget() {
    let key = song.key, mode = song.mode;
    const minor = !!MG.MINOR[mode];
    switch (r.weighted([['up5', 2], ['up7', 1.5], ['down2', 0.8], ['rel', 2], ['up1', 0.3], ['up3', 0.6], ['mode', 0.6]])) {
      case 'up5': key += 5; break;
      case 'up7': key += 7; break;
      case 'down2': key -= 2; break;
      case 'up1': key += 1; break;
      case 'up3': key += 3; break;
      case 'rel':
        if (minor) { key += 3; mode = r.pick(['ionian', 'lydian', 'mixolydian']); }
        else { key -= 3; mode = r.pick(['aeolian', 'dorian']); }
        break;
      case 'mode': {
        const opts = song.pal.modes.filter(m => m[0] !== mode);
        if (opts.length) mode = r.weighted(opts);
        break;
      }
    }
    key = fold(key, 31, 44);
    if (cfg.key != null) key = song.key;   // зафиксированные вручную тональность/лад не трогаем
    if (cfg.mode) mode = song.mode;
    return { key, mode };
  }

  // Одна замена инструмента за переход: тембр песни меняется постепенно
  function swapKit() {
    const T = tp(), k = song.kit;
    switch (r.weighted([['arp', 3], ['pad', 2], ['lead', 2], ['stab', 1.5], ['bass', song.palName === 'chip' ? 0 : 1]])) {
      case 'arp': k.arp = r.weighted(T.arp); break;
      case 'pad': k.pad = r.weighted(T.pad); break;
      case 'lead': k.lead = r.weighted(T.lead); break;
      case 'stab': k.stab = r.weighted(T.stab); k.stabR = r.pick(STABS); break;
      case 'bass': k.bass = r.weighted(song.pal.bassTone); break;
    }
  }

  function nextType(type) {
    if (song.pending) { const p = song.pending; song.pending = null; return p; }
    const opts = NEXT[type].map(([t, w]) => [t, Math.max(0.1, w * (1 + (SEC[t].e - 0.5) * (inten - 0.4) * 3))]);
    return r.weighted(opts);
  }

  function makeSection(type, prev) {
    const def = SEC[type], pal = song.pal, th = song.theme, kit = song.kit;
    const s = { type, def, len: r.pick(def.len), key: song.key, mode: song.mode, prev: null, next: null, tr: null };
    if (prev) {
      if (type === 'drop') { s.key = cfg.key == null ? song.homeKey : song.key; s.mode = cfg.mode || song.homeMode; }
      else if (cfg.modulate > 0 && r.chance((def.modulate ? 0.65 : 0.08) * cfg.modulate)) Object.assign(s, modTarget());
      if (!cfg.lockStyle && r.chance(0.07)) {
        const others = Object.keys(PAL).filter(n => n !== song.palName && n !== 'chip');
        song.tpalName = r.chance(0.6) ? r.pick(others) : null; // дрейф тембров
        song.tpal = song.tpalName ? PAL[song.tpalName] : null;
        if (song.tpal) want(song.tpal);
      }
      if (type !== 'drop' && r.chance(song.tpal ? 0.5 : 0.3)) swapKit();
    }
    if (cfg.lockStyle) { song.tpal = null; song.tpalName = null; }
    // гармония: в дропе звучит тема песни, иногда секция продолжает гармонию предыдущей. Взятая
    // гармония подгоняется под лад секции: после модуляции в ней могли оказаться уменьшённые аккорды.
    if (type !== 'bridge' && (type === 'drop' || r.chance(0.85))) s.prog = MG.fitProg(th.prog, s.mode);
    else if (prev && type !== 'bridge' && r.chance(0.25)) s.prog = MG.fitProg(prev.prog, s.mode);
    else s.prog = MG.progression(r, r.pick([2, 4, 4, 8]), pal.ext, s.mode);
    s.chordBars = type === 'break' ? 2 : type === 'bridge' ? r.pick([1, 1, 0.5]) : 1;
    if (type === 'intro') s.len = 4;
    // ритм: бит песни переходит из секции в секцию с вариациями, дроп узнаётся по своему биту
    if (def.drums === 'main') {
      if (type === 'drop') s.drums = clone(th.drums);
      else if (prev && isBeat(prev.drums) && r.chance(0.55)) s.drums = clone(prev.drums);
      else if (r.chance(0.65)) s.drums = clone(th.drums);
      else s.drums = MG.drumPattern(r, r.weighted(pal.drums));
      if (type !== 'drop' || r.chance(0.4)) MG.mutateDrums(r, s.drums, 0.5);
    } else if (def.drums === 'alt') s.drums = MG.drumPattern(r, r.weighted(pal.drums.concat([['half', 1.5], ['break', 1]])));
    else s.drums = MG.drumPattern(r, r.pick(def.drums));
    s.kick = pal.kick; s.snare = kit.snare; s.percF = kit.percF;
    // бас
    s.useBass = r.chance(def.bass) || type === 'drop' || type === 'groove';
    if (def.bassStyle && song.palName !== 'trap') {
      s.bassStyle = def.bassStyle;
      s.bassTone = r.chance(0.5) ? kit.bass : r.pick(['sub', 'reese']);
      s.bass = MG.bassPattern(r, s.bassStyle);
    } else {
      s.bassTone = kit.bass;
      if (type === 'drop' || r.chance(0.35)) { s.bassStyle = th.bassStyle; s.bass = clone(th.bass); }
      else if (prev && prev.bassStyle !== 'long' && r.chance(0.5)) { s.bassStyle = prev.bassStyle; s.bass = clone(prev.bass); MG.mutateBass(r, s.bass); }
      else { s.bassStyle = r.weighted(pal.bass); s.bass = MG.bassPattern(r, s.bassStyle); }
    }
    if (song.palName === 'chip') s.bassTone = 'tri';
    // остальные партии
    s.useArp = r.chance(def.arp) || type === 'groove' || type === 'drop';
    s.arp = type === 'drop' || r.chance(0.3) ? clone(th.arp) : prev && r.chance(0.4) ? clone(prev.arp) : MG.arp(r);
    s.arpTone = kit.arp;
    s.usePad = r.chance(def.pad) || type === 'intro' || type === 'break'; s.padTone = kit.pad;
    s.useStab = r.chance(def.stab); s.stabTone = kit.stab; s.stabR = kit.stabR;
    s.useLead = type === 'drop' || type === 'groove' || r.chance(Math.min(1, def.lead * (pal.leadP + 0.5))); s.leadTone = kit.lead;
    // под мелодией середина не забивается: арпеджио или стабы, редко всё сразу
    if (s.useLead && s.useArp && s.useStab && r.chance(0.6)) { if (r.chance(0.5)) s.useArp = false; else s.useStab = false; }
    // Мелодия. В дропе звучит тема песни — тот же мотив и те же фразы (они общие на всю песню), поэтому
    // дроп узнаётся. В других секциях мотив — тема или её вариация (из темы или из предыдущей секции).
    if (type === 'drop') { s.motif = th.motif; s.phrases = th.phrases; }
    else {
      const base = prev && prev.motif && r.chance(0.4) ? prev.motif : th.motif;
      s.motif = type === 'bridge' ? MG.varyMotif(r, base, 'invert')
        : r.chance(0.35) ? clone(th.motif) : MG.varyMotif(r, base, r.pick(['tail', 'rhythm', 'ornament']));
      s.phrases = {};
    }
    if (!s.usePad && !s.useArp && !s.useLead && !s.useStab) s.usePad = true;
    s.fillP = r.range(0.4, 0.85);
    s.sw = handoff(prev, s);
    return s;
  }

  // С какого такта новой секции партия играет свой материал. До него доигрывает партия предыдущей
  // секции: старое арпеджио звучит поверх новой гармонии, а новые партии входят по очереди.
  function handoff(prev, s) {
    const sw = { bass: 0, arp: 0, pad: 0, stab: 0, lead: 0, kick: 0, snare: 0, hat: 0, perc: 0 };
    if (!prev || s.type === 'drop' || prev.type === 'build') return sw; // в дроп всё входит разом
    const lim = Math.max(0, Math.min(4, s.len - 2));
    const pick = w => Math.min(lim, r.weighted(w));
    for (const k of LAYERS) sw[k] = pick([[0, 3], [1, 2], [2, 2], [4, 0.6]]);
    if (LAYERS.every(k => sw[k] > 0)) sw[r.pick(LAYERS)] = 0; // что-то меняется точно на сильную долю
    if (s.len >= 8 && r.chance(0.35)) sw.lead = 4;              // мелодия вступает со второй фразы
    if (s.type === 'break') { sw.bass = Math.min(sw.bass, 1); return sw; } // ударные уходят сразу — это и есть брейк
    if (!isBeat(prev.drums)) {
      // ударные входят слоями: бочка, потом хэты, потом малый и перкуссия
      sw.hat = pick([[0, 1], [1, 2], [2, 1]]);
      sw.snare = Math.max(sw.hat, pick([[1, 1], [2, 2], [4, 0.8]]));
      sw.perc = Math.max(sw.snare, pick([[2, 1], [4, 1]]));
    } else if (r.chance(0.5)) sw.hat = sw.perc = pick([[1, 2], [2, 1]]);
    else sw.kick = sw.snare = pick([[1, 2], [2, 1]]);
    return sw;
  }

  // План перехода s → n: связующие аккорды в последнем такте, затакт, подход баса и эффекты
  function transition(s, n) {
    const at = song.bar * 16 + song.step;            // первый ещё не сыгранный шаг
    const end = s.len * 16, lastBar = end - 16;
    const from = s.type, to = n.type, fromBuild = from === 'build';
    const mod = n.key !== song.key || n.mode !== song.mode;
    const iv = (d, k) => MG.deg2midi(n.key, n.mode, d + k) - MG.deg2midi(n.key, n.mode, d);
    const tc = n.prog[0], tDim = iv(tc.deg, 4) === 6;
    const tDeg = tDim && mod ? 0 : tc.deg; // в уменьшённый аккорд доминанта не ведёт — тогда цель тоника новой тональности
    const tRoot = MG.deg2midi(n.key, n.mode, tDeg), tMinor = iv(tDeg, 2) === 3;
    let W;
    if (mod) W = [['V7', 3], ['iiV', 2]];             // модуляция через доминанту новой тональности
    else if (tDim) W = [['pedal', 2], ['none', 1]];
    else if (to === 'drop') W = [['V7', 3], [tMinor ? 'bVIbVII' : 'IVV', 2.5], ['iiV', 1]];
    else if (to === 'break') W = [['sus', 2], ['plagal', 2], ['pedal', 1.5], ['none', 1]];
    else if (to === 'build') W = [['pedal', 2.5], ['V7', 1], ['none', 1]];
    else W = [['V7', 2], ['iiV', 1.5], ['pedal', 1.5], [tMinor ? 'bVIbVII' : 'IVV', 1],
      ['tritone', song.palName === 'lofi' || song.palName === 'synthwave' ? 1 : 0.2], ['none', 0.6]];
    let kind = r.weighted(W);
    if (kind === 'sus' && /^sus/.test(tc.ext)) kind = 'plagal'; // задержание в аккорд, который сам sus, ничего не разрешает
    const C = (semi, q) => ({ abs: true, root: (tRoot + semi) % 12, q });
    const plan = {
      V7: [[8, C(7, 'dom7')]], iiV: [[0, C(2, tMinor ? 'hdim' : 'min7')], [8, C(7, 'dom7')]],
      IVV: [[0, C(5, 'maj')], [8, C(7, 'dom7')]], bVIbVII: [[0, C(8, 'maj')], [8, C(10, 'maj')]],
      tritone: [[8, C(1, 'dom7')]], sus: [[8, C(0, 'sus4')]], plagal: [[0, C(5, tMinor ? 'min' : 'maj')]],
    }[kind] || [];
    // при переходе по кнопке посреди такта связка сдвигается на оставшиеся шаги, а не помещается — выпадает
    const turn = [], from0 = Math.max(0, at - lastBar);
    for (const [k, c] of plan) {
      const kk = Math.max(k, from0);
      if (kk > 13) continue;
      if (turn.length && turn[turn.length - 1][0] === kk) turn.pop();
      turn.push([kk, c]);
    }
    if (plan.length && !turn.length) kind = 'none';
    const tr = {
      kind, mod, tgt: C(0, tMinor ? 'min' : 'maj'), turn,
      pedalFrom: kind === 'pedal' ? Math.max(at, lastBar - (to === 'build' ? 16 : 0)) : Infinity,
      approach: n.useBass && kind !== 'pedal' && !fromBuild && r.chance(0.6),
      hp: to === 'drop' ? r.chance(fromBuild ? 0.75 : 0.55) : fromBuild && r.chance(0.35),
      rise: !!s.def.lp && !s.lpOpen && !n.def.lp && to !== 'build',
      thr: r.chance(to === 'break' ? 0.8 : to === 'drop' ? 0.15 : 0.35),
      swell: !fromBuild && to !== 'break' && r.chance(to === 'drop' ? 0.85 : 0.45),
      T: null, pk: [],
    };
    // затакт мелодии: несколько аккордовых звуков, подбирающихся к первой ноте новой секции;
    // в нарастании он звучит до паузы перед дропом и тянется через неё
    if (n.useLead && n.sw.lead === 0 && r.chance(fromBuild ? 0.5 : 0.65)) {
      const first = getPhrase(n, 0)[0][0];
      if (first && first.s < 4) {
        tr.T = MG.deg2midi(fold(n.key + 36, 60, 71), n.mode, first.deg);
        tr.pk = r.pick(fromBuild ? [[8, 10, 12], [10, 12]] : [[12, 14], [10, 12, 14], [8, 11, 14]]).filter(k => lastBar + k >= at);
      }
    }
    tr.leadFrom = lastBar + Math.min(tr.turn.length ? tr.turn[0][0] : 16, tr.pk.length ? tr.pk[0] : 16);
    // эффекты: pos — шаг секции, на котором эффект запускается; длительность — до границы секций
    const fx = tr.fx = [];
    const add = (pos, fn) => fx.push({ pos: Math.max(pos, at), fn });
    if (tr.hp) add(fromBuild ? lastBar - 16 : lastBar, (t, d) => S.hpSweep(t, fromBuild ? 260 : 340, d));
    if (tr.rise) add(end - 32, (t, d) => S.sweep(t, s.def.lp, 18000, d));
    if (tr.thr) add(end - 4, (t, d) => S.throw(t, d, 16 * stepDur()));
    if (tr.swell) add(to === 'drop' ? lastBar : lastBar + 8, (t, d) => { if (!cfg.mute.drums) S.swell(t, d, to === 'drop' ? 1 : 0.7); });
    return tr;
  }

  function planNext(s, type) {
    const n = makeSection(type, s);
    s.next = n; s.nextType = type;
    s.tr = transition(s, n);
  }

  function activate(n, t0) {
    const old = song.sec;
    if (old) old.prev = null; // цепочка секций не растёт
    n.prev = old;
    if (cfg.key == null) song.key = n.key;
    if (!cfg.mode) song.mode = n.mode;
    song.sec = n; song.bar = 0; song.step = 0; song.count++;
    hotBars = calmBars = 0;
    if (ctx) { S.hpReset(t0); sectionFx(n, t0); }
  }

  // Фильтр секции. Без скачков: нарастание сначала прикрывается и раскрывается к дропу,
  // брейк затемняется за такт, после брейка фильтр открывается ещё в его последних тактах.
  function sectionFx(s, t) {
    const L = s.len * 16 * stepDur(), bar = 16 * stepDur(), prev = s.prev;
    if (s.type === 'build') {
      if (prev && prev.def.lp && !prev.lpOpen) S.sweep(t, prev.def.lp, 18000, L);
      else S.lpPath(t, [[20000, 0], [900, L * 0.4], [18000, L * 0.6]]);
    } else if (s.type === 'intro' && !prev) { S.sweep(t, 900, 18000, L); s.lpOpen = true; }
    else S.setLp(t, s.def.lp || 20000, s.def.lp ? bar / 3 : 0.05);
  }

  // Каждые 4 такта материал немного мутирует, слои включаются/выключаются
  function evolve(s) {
    const e = cfg.evolve;
    if (e <= 0) return;
    const p = x => r.chance(Math.min(1, x * e));
    MG.mutateDrums(r, s.drums, (0.4 + inten) * e);
    if (p(0.4)) MG.mutateBass(r, s.bass);
    if (p(0.12)) s.bass = MG.bassPattern(r, s.bassStyle);
    if (p(0.25)) s.arp.mode = r.pick(['up', 'down', 'updown', 'pattern', 'broken']);
    if (p(0.2)) s.arp.oct = r.int(1, 2);
    if (p(0.2)) s.arp.pat = MG.arpPat(r);
    if (p(0.18)) s.useStab = !s.useStab && s.def.stab > 0;
    if (p(0.15) && s.type !== 'build') s.useArp = !s.useArp;
    if (!s.useLead && s.def.lead > 0 && p(0.3 * (0.5 + inten))) s.useLead = true;
    // новая мелодия на старой гармонии (в дропе — тема)
    if (s.type !== 'drop' && p(0.12)) {
      s.phrases = {};
      if (r.chance(0.5)) s.motif = MG.varyMotif(r, s.motif, r.pick(['tail', 'rhythm', 'ornament']));
    }
  }

  // Мелодия идёт периодами по 8 тактов: первая фраза открывается тактом темы и продолжает мотивом секции,
  // вторая ей отвечает — другой схемой и другим продолжением. Тема узнаётся в каждой секции (кроме бриджа —
  // он контрастный), а одна и та же фраза не повторяется четыре такта за четырьмя.
  function getPhrase(s, bar) {
    const chords = []; // по аккорду на каждые полтакта: аккорды могут меняться посреди такта
    for (let h = 0; h < 8; h++) chords.push(chordAt(s, bar + (h >> 1), (h & 1) * 8));
    const answer = Math.floor(bar / 4) % 2 === 1;
    const key = (answer ? 'b:' : 'a:') + s.mode + ':' + chords.map(c => c.deg + c.ext).join(',');
    if (!s.phrases[key]) {
      s.phrases[key] = MG.phrase(r, chords, s.motif, {
        lo: 0, hi: 10, density: s.def.e, vary: answer, style: song.palName,
        head: answer || s.type === 'bridge' ? null : song.theme.motif,
      });
    }
    return s.phrases[key];
  }

  // ---------- Проигрывание шага ----------
  function bassNote(n, ch, next) {
    let root, rel;
    if (ch.abs) {
      const iv = Q[ch.q];
      root = fold(ch.root + 36, 31, 47);
      rel = k => root + ({ 1: 2, 2: iv[1], 4: iv[2], [-1]: -2 }[k] || 0);
    } else {
      root = fold(MG.deg2midi(song.key, song.mode, ch.deg), 31, 47);
      rel = k => root + (MG.deg2midi(song.key, song.mode, ch.deg + k) - MG.deg2midi(song.key, song.mode, ch.deg));
    }
    switch (n) {
      case 'o': return root + 12;
      case 'O': return root + 24;
      case 'f': return rel(4);
      case 't': return rel(2);
      case 's+1': return rel(1);
      case 's-1': return rel(-1);
      case 's+2': return rel(2);
      case 'a': {
        const nr = fold(next.abs ? next.root : MG.deg2midi(song.key, song.mode, next.deg), root - 6, root + 6);
        return nr === root ? root + 7 : r.chance(0.5) ? nr - 1 : nr + 1;
      }
      default: return root;
    }
  }
  // Подход баса к корню новой секции: полутон снизу/сверху или квинта
  function approachNote(tgt) {
    return fold(tgt.root + 36, 31, 47) + r.weighted([[-1, 3], [1, 1], [-5, 1.2], [7, 0.6]]);
  }

  function playDrums(t, s, st, bar, sd) {
    const last = bar === s.len - 1;
    if (st === 0) {
      s.fill = null;
      if (s.type !== 'build' && (bar % 4 === 3 || last) && (last || r.chance(s.fillP)) && s.drums.style !== 'none') {
        const nextIsDrop = last && s.nextType === 'drop';
        s.fill = MG.fill(r, nextIsDrop ? 'dropout' : r.weighted([['roll', 2], ['toms', 1.5], ['stutter', 1], ['short', 2], ['dropout', 0.6]]));
      }
    }
    if (s.type === 'build') {
      const prog = (bar * 16 + st) / (s.len * 16);
      if (last && st >= 14) return; // тишина перед дропом
      // первую половину нарастания продолжается бит предыдущей секции, поверх — дробь малого
      const pv = s.prev && isBeat(s.prev.drums) && prog < 0.5 ? s.prev.drums : null;
      if (pv) {
        if (pv.kick[st]) S.kick(t, pv.kick[st], s.kick);
        if (pv.hat[st]) S.hat(t, pv.hat[st], false);
        if (pv.open[st]) S.hat(t, pv.open[st], true);
        if (pv.perc[st]) S.perc(t, pv.perc[st], s.percF);
      } else {
        if (st % 4 === 0 && prog < 0.8) S.kick(t, 0.85, s.kick);
        if (st % 2 === 0) S.hat(t, 0.25 + prog * 0.4, false);
      }
      const rate = prog < 0.5 ? 4 : prog < 0.75 ? 2 : 1;
      if (st % rate === 0) S.snare(t, 0.3 + prog * 0.6, 'snare');
      if (prog > 0.85) S.snare(t + sd / 2, 0.4 + prog * 0.5, 'snare');
      return;
    }
    // каждая часть установки может ещё доигрывать рисунок предыдущей секции
    const D = c => (s.prev && bar < s.sw[c] ? s.prev.drums : s.drums);
    const pk = D('kick'), ps = D('snare'), ph = D('hat'), pp = D('perc');
    const f = s.fill, inFill = f && st >= f.from;
    const vj = () => r.range(0.94, 1.06);
    if (pk.kick[st] && (!inFill || f.keepKick)) S.kick(t, pk.kick[st] * vj(), s.kick);
    if (ps.snare[st] && !inFill) S.snare(t, ps.snare[st] * vj(), s.snare);
    if (!inFill) {
      if (ph.hat[st]) S.hat(t + r.range(0, 0.004), ph.hat[st] * vj(), false);
      if (ph.open[st]) S.hat(t, ph.open[st], true);
      if (ph.roll && st % 4 === 2 && r.chance(ph.roll)) {
        const n = r.pick([2, 3, 4, 6]);
        for (let i = 1; i < n; i++) S.hat(t + (i * 2 * sd) / n, 0.3 + 0.2 * (i / n), false);
      }
      if (pp.shaker[st] && mix.percussion) S.shaker(t, pp.shaker[st]);
      if (pp.perc[st] && mix.percussion) S.perc(t, pp.perc[st], s.percF);
      if (mix.lift && st === 14 && !pp.perc[st]) S.perc(t, 0.3, s.percF * 1.5);
      if (inten > 0.7 && ph.style !== 'none' && !ph.hat[st] && st % 2 === 1 && r.chance(0.5)) S.hat(t, 0.22, false);
    }
    if (inFill) {
      for (const e of f.ev) {
        if (e.s !== st) continue;
        const te = t + e.sub * sd;
        if (e.i === 'snare') S.snare(te, e.v, s.snare === 'chip' ? 'chip' : 'snare');
        else if (e.i === 'tom') S.tom(te, e.v, e.f);
        else if (e.i === 'kick') S.kick(te, e.v, s.kick);
        else if (e.i === 'open') S.hat(te, e.v, true);
      }
    }
  }

  // Затакт: аккордовые звуки связки, ближайшие к первой ноте мелодии новой секции
  function pickup(t, s, tr, st, sd) {
    if (!tr.pkNotes) {
      const up = r.chance(0.65), pcs = song.voicing.map(m => m % 12), cand = [];
      for (let m = tr.T - 14; m <= tr.T + 14; m++) if (m !== tr.T && pcs.includes(m % 12) && (up ? m < tr.T : m > tr.T)) cand.push(m);
      cand.sort((a, b) => Math.abs(a - tr.T) - Math.abs(b - tr.T));
      tr.pkNotes = cand.slice(0, tr.pk.length).reverse();
    }
    const i = tr.pk.indexOf(st), m = tr.pkNotes[i];
    if (m == null) return;
    const nx = i + 1 < tr.pk.length ? tr.pk[i + 1] : 16;
    S.lead(t, m, (nx - st) * sd * 0.85, 0.5 + 0.12 * i, s.useLead ? s.leadTone : s.next.leadTone, { pan: 0.05, vib: 4 });
    song.lastLead = m;
  }

  function playStep(t0) {
    const s = song.sec, st = song.step, bar = song.bar, pos = bar * 16 + st;
    if (st === 0) {
      inten += (intensity - inten) * 0.55;
      mix = MG.arrangement(s.type, bar, inten);
      S.expression(t0, inten);
      hotBars = inten >= 0.68 ? hotBars + 1 : 0;
      calmBars = inten <= 0.32 ? calmBars + 1 : 0;
      // Sustained action brings the build forward to a phrase boundary. Quiet play gives a drop room to breathe.
      if (!s.next && bar >= 1) {
        const type = hotBars >= 2 && ['intro', 'break', 'groove'].includes(s.type) ? 'build'
          : calmBars >= 4 && bar >= 4 && s.type === 'drop' ? 'break' : null;
        if (type) { s.len = Math.min(s.len, Math.ceil((bar + 2) / 4) * 4); planNext(s, type); }
      }
    }
    heard.push({ t: t0, s, bar, st, key: song.key, mode: song.mode, mix });
    if (heard.length > 256) heard.shift();
    steps.push({ t: t0, n: stepN++, e: s.def.e, bpm: song.bpm, type: s.type, bar, len: s.len });
    if (steps.length > 256) steps.shift();
    if (!s.next && bar >= s.len - 2) planNext(s, nextType(s.type));
    const tr = s.tr || NO_TR;
    const sd = stepDur();
    const t = t0 + (st % 2 === 1 ? song.swing * 2 * sd : 0);
    const last = bar === s.len - 1;
    for (const f of tr.fx) if (f.pos === pos) f.fn(t0, (s.len * 16 - pos) * sd); // без свинга: эффект кончается ровно на границе
    const ch = chordNow(s, bar, st);
    const next = s.next && bar + Math.max(1, s.chordBars) >= s.len ? tr.tgt : chordAt(s, bar + s.chordBars, 0);
    const harmony = song.key + ':' + song.mode + ':' + JSON.stringify(ch);
    const chStart = chordStarts(s, bar, st) || harmony !== song.harmony;
    song.harmony = harmony;
    const silent = s.type === 'build' && last && st >= 14;
    const mute = cfg.mute;
    const L = k => (s.prev && bar < s.sw[k] ? s.prev : s); // чей материал сейчас играет партия

    // акцент начала секции
    if (bar === 0 && st === 0 && song.count > 1) {
      if (s.type === 'drop' && !mute.drums) S.impact(t, 1);
      else if ((s.type === 'groove' || s.type === 'bridge') && !mute.drums) S.crash(t, 0.8);
      else if (s.type === 'break') S.downlift(t, 1.5);
    }
    if (s.type === 'build' && st === 0 && bar === Math.max(0, s.len - 2)) S.riser(t, Math.min(2, s.len) * 16 * sd, 1);

    if (!mute.drums) playDrums(t, s, st, bar, sd);

    // голоса аккорда (для пэда, стабов, арпеджио); смена аккорда — и для цветомузыки: корень и длительность
    if (chStart || !song.voicing) song.voicing = MG.voice(chordMidis(ch), song.voicing, 53, 77);
    if (chStart) light(t0, 'chord', 1, chordMidis(ch)[0], chordSpan(s, bar, st) * sd);

    // бас; органный пункт — корень новой секции уже звучит под последними аккордами старой
    const sb = L('bass'), pedal = pos >= tr.pedalFrom;
    if (st === 0 || !s.bassBar) s.bassBar = MG.bassBar(sb.bass, sb.drums, bar, inten);
    if (sb.useBass && !silent && !mute.bass) {
      const bch = pedal ? tr.tgt : ch;
      const cut = tr.approach && last ? 14 : 16; // перед подходом ноты баса не тянутся через него
      if (st >= cut) {
        if (st === cut) {
          const m = approachNote(tr.tgt);
          S.bass(t, m, 2 * sd * 0.95, 0.85, sb.bassTone, { slide: sb.bassTone === '808' ? song.lastBass : null });
          song.lastBass = m;
        }
      } else {
        const ev = s.bassBar.find(e => e.s === st);
        if (ev) {
          const midi = bassNote(ev.n, bch, next);
          const dur = Math.max(0.05, Math.min(ev.len, cut - st, chordSpan(s, bar, st)) * sd * 0.95);
          S.bass(t, midi, dur, (0.85 + ev.acc * 0.15) * (0.85 + 0.15 * inten), sb.bassTone,
            { accent: ev.acc, slide: ev.slide && song.lastBass ? song.lastBass : null });
          song.lastBass = midi;
        } else if (chStart && st !== 0 && !pedal) {
          // смена аккорда посреди такта — переподтвердить корень
          const nx = s.bassBar.find(e => e.s > st);
          const midi = bassNote('r', bch, next);
          S.bass(t, midi, (Math.min(nx ? nx.s : 16, cut) - st) * sd * 0.95, 0.9, sb.bassTone);
          song.lastBass = midi;
        }
      }
    }

    const leadOn = s.useLead && bar >= s.sw.lead && !mute.lead;
    if (s.useLead && st === 0 && (bar % 4 === 0 || !s.cur)) s.cur = getPhrase(s, bar - (bar % 4));
    const leadNotes = s.cur ? s.cur[bar % 4] : [];
    const leadBusy = leadOn && pos < tr.leadFrom && leadNotes.some(n => n.s <= st && n.s + n.len > st);
    // пэд и стабы
    const sp = L('pad'), ss = L('stab');
    const padIn = !chStart && st === 0 && bar > 0 && bar === s.sw.pad && s.usePad; // пэд новой секции вступает посреди аккорда
    if (sp.usePad && (chStart || padIn) && !silent && !mute.pad) {
      S.pad(t, song.voicing, chordSpan(s, bar, st) * sd * 0.98, 0.8 + 0.4 * (1 - inten), sp.padTone);
    }
    if (ss.useStab && ss.stabR.includes(st) && !silent && !mute.stab && (!leadBusy || st % 8 === 6)) {
      const keys = ss.stabTone === 'epiano' || ss.stabTone === 'piano';
      S.stab(t, song.voicing.map(m => m + (keys ? 0 : 12)), sd * (keys ? 3.4 : 1.6), leadBusy ? 0.55 : 0.9, ss.stabTone, r.range(-0.2, 0.2));
    }

    // арпеджио; под мелодией — на октаву ниже и в одну октаву, чтобы не спорить с ней
    const sa = L('arp');
    if (sa.useArp && !silent && !mute.arp) {
      const a = leadOn ? Object.assign({}, sa.arp, { oct: 1 }) : sa.arp;
      const tones = song.voicing.map(m => m + (leadOn ? 0 : 12));
      const vel = leadBusy ? 0.32 : 0.8;
      if (a.rate === 3) {
        if (st % 4 === 0 && !leadBusy) for (let i = 0; i < (inten < 0.35 ? 1 : 3); i++) {
          S.pluck(t + (i * 4 * sd) / 3, MG.arpNote(a, tones, song.arpI++), ((4 * sd) / 3) * a.gate, vel, sa.arpTone, (i - 1) * a.pan);
        }
      } else if (st % Math.max(a.rate, mix.arpStride) === 0 && a.mask[st] && (!leadBusy || st % 4 === 2)) {
        S.pluck(t, MG.arpNote(a, tones, song.arpI++), sd * a.rate * a.gate, vel * (st % 4 === 0 ? 1 : 0.8), sa.arpTone, (song.arpI % 2 ? 1 : -1) * a.pan);
      }
    }

    // мелодия; в связке она замолкает и уступает место затакту
    if (s.useLead && !silent && bar >= s.sw.lead) {
      const notes = s.cur ? s.cur[bar % 4] : null;
      if (notes && pos < tr.leadFrom) {
        const base = fold(song.key + 36, 60, 71);
        for (const n of notes) {
          if (Math.floor(n.s) !== st) continue;
          const midi = MG.deg2midi(base, song.mode, n.deg);
          const len = Math.max(0.5, Math.min(n.len, chordSpan(s, bar, st), tr.leadFrom - bar * 16 - n.s));
          const legato = song.lastLead && Math.abs(midi - song.lastLead) <= 7 && r.chance(0.3);
          if (!mute.lead) S.lead(t + (n.s - st) * sd, midi, len * sd * 0.92, n.vel * (0.8 + 0.25 * inten), s.leadTone,
            { glide: legato ? song.lastLead : null, pan: 0.05 });
          song.lastLead = midi;
          song.lastLeadDeg = n.deg;
        }
      }
    }
    if (last && tr.T != null && tr.pk.includes(st) && !mute.lead) pickup(t, s, tr, st, sd);
  }

  function advance() {
    song.nextT += stepDur();
    song.step++;
    if (song.step < 16) return;
    song.step = 0;
    song.bar++;
    const s = song.sec;
    if (song.bar >= s.len) activate(s.next || makeSection(nextType(s.type), s), song.nextT);
    else if (song.bar % 4 === 0) evolve(s);
  }

  function tick() {
    const A = AK.A;
    const now = ctx.currentTime;
    const on = !!(A.playing && A.musicOn && song.sec);
    if (on !== running) {
      running = on; S.gate(on);
      if (!on) { S.stop(); lit.length = steps.length = heard.length = 0; lastHeard = null; }
    }
    if (!on) { song.nextT = now + 0.05; return; }
    // Главный поток был занят дольше запаса. Опоздавшие шаги не играем задним числом: ноты с прошедшим
    // временем звучат все разом, а их огибающие ломаются в щелчки. Сетка просто сдвигается.
    if (song.nextT < now + 0.01) song.nextT = now + 0.03;
    // в фоновой вкладке таймеры редкие — расписываем дальше вперёд
    const ahead = typeof document !== 'undefined' && document.hidden ? 1.2 : 0.2;
    while (song.nextT < now + ahead) { playStep(song.nextT); advance(); }
  }

  // ---------- API ----------
  M.init = function (c, dest, reverb, noise) {
    ctx = c;
    S.init(c, dest, reverb, noise);
    S.setTempo(song.bpm);
    if (!song.sec) M.newSong();
    else sectionFx(song.sec, ctx.currentTime); // песня сочинена до запуска звука
    running = false; S.gate(false);
    if (timer != null) clearInterval(timer);
    timer = setInterval(tick, 25);
  };

  M.setIntensity = x => { if (Number.isFinite(x)) intensity = Math.max(0, Math.min(1, x)); };

  // Нота для звука кирпича: тон текущего аккорда, чем больше индекс — тем выше
  M.brickNote = idx => {
    const h = heardNow(), s = h.s;
    const ch = s ? chordNow(s, h.bar, h.st) : { deg: 0, ext: 'seven' };
    const key = h.key ?? song.key, mode = h.mode || song.mode;
    const base = fold(key + 24, 52, 63);
    const tones = ch.abs
      ? [0, 1, 2, 3, 4].map(i => { const iv = Q[ch.q]; return fold(ch.root + iv[i % iv.length], base, base + 11); })
      : [0, 2, 4, 6, 8].map(d => fold(MG.deg2midi(base, mode, ch.deg + d), base, base + 11));
    tones.sort((a, b) => a - b);
    const i = Math.max(0, Math.round(idx));
    return tones[i % 5] + 12 * Math.floor(i / 5);
  };

  M.event = name => {
    if (!ctx || !AK.A.playing || !AK.A.musicOn) return;
    const s = song.sec;
    if (name === 'lose' && s) {
      S.dip();
      if (s.type === 'break' || (s.next && s.next.type === 'break')) return;
      if (s.type === 'build') {
        // нарастание не обрывается: дроп всё равно наступает, но короткий, и за ним брейк
        if (!s.next || s.next.type !== 'drop') planNext(s, 'drop');
        s.next.len = Math.min(s.next.len, 4);
        song.pending = 'break';
        return;
      }
      // брейк — с чётной тактовой черты секции (сетка фраз не ломается), а на связку остаётся
      // хотя бы полтакта
      let end = song.bar + 1;
      if (end % 2) end++; else if (song.step > 8) end += 2;
      s.len = Math.min(s.len, end);
      song.pending = null;
      planNext(s, 'break');
    }
    // Уровень пройден: тарелка. Через пару секунд игра начинает новую песню, и звучащая плавно гаснет
    // под её начало, поэтому нарастание здесь не запускается — оно бы оборвалось на полуслове.
    if (name === 'clear' && !cfg.mute.drums) S.crash(ctx.currentTime, 0.7);
  };

  // ---------- Ручное управление (music.html) ----------
  M.styles = Object.keys(PAL);
  M.sections = Object.keys(SEC);
  M.modes = Object.keys(MG.MODES);

  // Применяет настройку сразу, не дожидаясь новой песни
  M.set = (k, v) => {
    switch (k) {
      case 'bpm':
        cfg.bpm = Number.isFinite(v) ? U.clamp(v, 60, 180) : null;
        if (cfg.bpm) { song.bpm = cfg.bpm; if (ctx) S.setTempo(song.bpm); } break;
      case 'swing': cfg.swing = Number.isFinite(v) ? U.clamp(v, 0, 0.2) : null; if (cfg.swing != null) song.swing = cfg.swing; break;
      case 'key': cfg.key = Number.isFinite(v) ? ((Math.round(v) % 12) + 12) % 12 : null; if (cfg.key != null) song.key = fold(36 + cfg.key, 33, 44); break;
      case 'mode': cfg.mode = MG.MODES[v] ? v : null; if (cfg.mode) song.mode = cfg.mode; break;
      case 'lockStyle': cfg.lockStyle = v; if (v) { song.tpal = null; song.tpalName = null; } break;
      default: cfg[k] = v;
    }
  };

  // Перейти в секцию type со следующего такта (с той связкой, что успеет поместиться)
  M.queue = type => {
    const s = song.sec;
    if (!s || !SEC[type]) return;
    s.len = song.bar + 1;
    song.pending = null;
    planNext(s, type);
  };

  // Перегенерировать часть материала текущей секции. Новое становится темой песни
  // и дальше переходит в следующие секции.
  M.regen = part => {
    const s = song.sec;
    if (!s) return;
    const T = tp(), kit = song.kit, th = song.theme;
    switch (part) {
      case 'chords': s.prog = th.prog = MG.progression(r, 4, song.pal.ext, song.mode); s.phrases = th.phrases = {}; s.cur = null; song.voicing = null; break;
      case 'drums':
        s.drums = MG.drumPattern(r, r.weighted(song.pal.drums)); th.drums = clone(s.drums);
        s.snare = kit.snare = r.weighted(song.pal.snare);
        for (const k of DRUMS) s.sw[k] = 0;
        break;
      case 'bass':
        s.bassStyle = th.bassStyle = r.weighted(song.pal.bass);
        s.bassTone = kit.bass = song.palName === 'chip' ? 'tri' : r.weighted(song.pal.bassTone);
        s.bass = MG.bassPattern(r, s.bassStyle); th.bass = clone(s.bass);
        s.bassBar = null;
        s.useBass = true; s.sw.bass = 0;
        break;
      case 'arp': s.arp = MG.arp(r); th.arp = clone(s.arp); s.arpTone = kit.arp = r.weighted(T.arp); s.useArp = true; s.sw.arp = 0; break;
      case 'pad':
        s.padTone = kit.pad = r.weighted(T.pad); s.stabTone = kit.stab = r.weighted(T.stab); s.stabR = kit.stabR = r.pick(STABS);
        s.usePad = true; s.sw.pad = s.sw.stab = 0;
        break;
      case 'melody':
        s.motif = th.motif = MG.motif(r, s.def.e, song.palName); s.phrases = th.phrases = {}; s.cur = null;
        s.leadTone = kit.lead = r.weighted(T.lead); s.useLead = true; s.sw.lead = 0;
        break;
    }
  };

  // Шаг, который звучит сейчас (музыка расписана вперёд)
  function heardNow() {
    if (ctx) while (heard.length && heard[0].t <= ctx.currentTime) lastHeard = heard.shift();
    return lastHeard || { s: song.sec, bar: song.bar, st: song.step };
  }

  M.state = () => {
    const h = heardNow(), s = h.s;
    if (!s) return null;
    const L = k => (s.prev && h.bar < s.sw[k] ? s.prev : s);
    const lb = L('bass'), la = L('arp'), lp = L('pad'), ls = L('stab');
    const tr = s.tr, n = s.next;
    const key = h.key ?? song.key, mode = h.mode || song.mode, arrangement = h.mix || mix;
    const name = ch => chordName(ch, key, mode);
    let turnIdx = -1;
    if (tr && h.bar === s.len - 1) tr.turn.forEach(([k], i) => { if (h.st >= k) turnIdx = i; });
    return {
      style: song.palName, timbre: song.tpalName, bpm: song.bpm, swing: song.swing,
      key: NOTE[key % 12], keyPc: key % 12, mode,
      section: s.type, bar: h.bar, len: s.len, step: h.st,
      next: n ? n.type : song.pending || null,
      chord: name(chordNow(s, h.bar, h.st)), prog: s.prog.map(name),
      chordIdx: turnIdx >= 0 ? -1 : chordIdx(s, h.bar, h.st), chordBars: s.chordBars,
      turn: tr ? tr.turn.map(([, c]) => name(c)) : [], turnIdx,
      trans: tr && n ? {
        kind: tr.kind, hp: tr.hp, rise: tr.rise, thr: tr.thr, swell: tr.swell, pickup: tr.T != null && tr.pk.length > 0,
        approach: tr.approach, stagger: Object.values(n.sw).some(v => v > 0),
        mod: tr.mod ? { key: NOTE[n.key % 12], mode: n.mode } : null,
      } : null,
      layers: {
        drums: DRUMS.some(c => (s.prev && h.bar < s.sw[c] ? s.prev.drums : s.drums).style !== 'none'),
        bass: lb.useBass, arp: la.useArp, pad: lp.usePad, stab: ls.useStab, lead: s.useLead && h.bar >= s.sw.lead,
      },
      tones: {
        drums: s.drums.style, bass: lb.bassStyle + ' · ' + lb.bassTone, arp: la.arpTone + ' · ' + la.arp.mode,
        pad: lp.padTone, stab: ls.stabTone, lead: s.leadTone,
      },
      intensity: arrangement.energy ?? inten, targetIntensity: intensity,
      seed: song.seed, phrase: arrangement.phrase || 'Тема',
    };
  };

  // ---------- Для цветомузыки ----------
  // Где песня в момент now (часы звука): сквозной номер доли с дробью (доли 0, 4, 8… — начала тактов),
  // темп, секция (тип, энергия, такт и длина в тактах). null — музыка не играет.
  M.clock = now => {
    if (!running) return null;
    while (steps.length > 1 && steps[1].t <= now - 1) steps.shift(); // секунду истории держим
    let c = null;
    for (const s of steps) { if (s.t > now) break; c = s; }
    const sd = c ? 60 / c.bpm / 4 : 0;
    if (!c || now - c.t > 4 * sd) return null;
    return { beat: (c.n + (now - c.t) / sd) / 4, bpm: c.bpm, e: c.e, type: c.type, bar: c.bar, len: c.len };
  };
  // Отдаёт fn(инструмент, громкость, нота, длительность) за каждую ноту и удар, прозвучавшие к моменту now.
  // У ударных нота и длительность не заданы; 'chord' — смена аккорда (нота — его корень).
  M.lights = (now, fn) => {
    let j = 0;
    for (const h of lit) { if (h.t <= now) fn(h.name, h.v, h.m, h.d); else lit[j++] = h; }
    lit.length = j;
  };

  // Для офлайн-рендера (OfflineAudioContext): заранее расписать музыку до момента until
  M.prerender = until => {
    if (!ctx || !Number.isFinite(until)) return [];
    if (!running) { running = true; S.gate(true); }
    const log = [];
    while (song.nextT < until) { if (song.step === 0 && song.bar === 0) log.push(song.nextT.toFixed(1) + 's ' + M.info()); playStep(song.nextT); advance(); }
    return log;
  };

  M.info = () => (song.sec ? `${song.palName} ${song.bpm}bpm ${song.mode} key${song.key} · ${song.sec.type} ${song.bar + 1}/${song.sec.len}` : '');

  AK.Music = M;
})(window.AK);
