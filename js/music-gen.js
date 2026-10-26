'use strict';
// Музыкальная теория и генераторы материала: лады, марковские гармонические последовательности,
// голосоведение, ритмы баса и барабанов с мутациями, сбивки, арпеджио, мотивы и фразы мелодии.
// Мелодия и гармония считаются в ступенях лада (deg), в MIDI переводятся при проигрывании.
(function (AK) {
  const MG = {};

  MG.MODES = {
    aeolian: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    ionian: [0, 2, 4, 5, 7, 9, 11],
  };
  MG.MINOR = { aeolian: 1, dorian: 1, phrygian: 1, harmonic: 1 };
  const EXT = { triad: [0, 2, 4], seven: [0, 2, 4, 6], sus2: [0, 1, 4], sus4: [0, 3, 4], add9: [0, 2, 4, 8] };
  const mod7 = d => ((d % 7) + 7) % 7;

  MG.deg2midi = (key, mode, deg) => key + MG.MODES[mode][mod7(deg)] + 12 * Math.floor(deg / 7);
  MG.chordDegs = ch => EXT[ch.ext].map(d => d + ch.deg);
  MG.chordMidis = (key, mode, ch) => MG.chordDegs(ch).map(d => MG.deg2midi(key, mode, d));
  MG.isChordDeg = (ch, deg) => MG.chordDegs(ch).some(d => mod7(d - deg) === 0);
  MG.nearestChordDeg = (ch, deg) => {
    for (let k = 0; k <= 3; k++) {
      if (MG.isChordDeg(ch, deg - k)) return deg - k;
      if (MG.isChordDeg(ch, deg + k)) return deg + k;
    }
    return deg;
  };
  MG.nearestRootDeg = (ch, deg) => { let d = deg; while (mod7(d - ch.deg) !== 0) d--; return deg - d > 3 ? d + 7 : d; };

  // ---------- Гармония ----------
  // Аккорд ступени звучит чисто, если квинта у него чистая: уменьшённые и увеличенные (ii° в миноре,
  // vii° в мажоре, III+ в гармоническом) заменяются родственным аккордом с двумя общими звуками —
  // терцией ниже или выше. У расширений убираются резкие варианты: малая нона, тритон вместо кварты,
  // малая секунда вместо большой.
  const iv = (mode, deg, k) => MG.deg2midi(0, mode, deg + k) - MG.deg2midi(0, mode, deg);
  MG.goodDeg = (mode, deg) => iv(mode, deg, 4) === 7;
  MG.fitChord = (ch, mode) => {
    let deg = mod7(ch.deg);
    if (!MG.goodDeg(mode, deg)) deg = [5, 2].map(k => (deg + k) % 7).find(d => MG.goodDeg(mode, d)) ?? 0;
    let ext = ch.ext;
    if ((ext === 'add9' && iv(mode, deg, 8) !== 14) || (ext === 'sus2' && iv(mode, deg, 1) !== 2) ||
      (ext === 'sus4' && iv(mode, deg, 3) !== 5)) ext = 'triad';
    return { deg, ext };
  };
  MG.fitProg = (prog, mode) => prog.map(ch => (ch.abs ? ch : MG.fitChord(ch, mode)));

  // Проверенные последовательности, на которых держится много поп- и электронной музыки
  const PROGS = {
    minor: [
      [[0, 5, 2, 6], 3], [[0, 6, 5, 6], 2], [[5, 6, 0, 0], 1.5], [[0, 5, 3, 4], 2], [[0, 3, 5, 4], 1.5],
      [[0, 6, 5, 4], 1.5], [[0, 3, 6, 2], 1.5], [[3, 6, 2, 5], 1], [[0, 5, 6, 0], 1.5], [[0, 2, 5, 6], 1],
      [[0, 3, 0, 4], 1], [[5, 3, 0, 6], 1.2],
    ],
    major: [
      [[0, 4, 5, 3], 3], [[5, 3, 0, 4], 2.5], [[0, 5, 3, 4], 2], [[0, 3, 5, 4], 1.5], [[3, 0, 4, 5], 1.5],
      [[0, 3, 0, 4], 1], [[0, 2, 5, 3], 1], [[3, 4, 0, 0], 1], [[0, 5, 1, 4], 1.2],
    ],
    minor2: [[[0, 5], 2], [[0, 6], 1.5], [[0, 3], 1.5], [[5, 6], 1], [[0, 1], 0.6]],
    major2: [[[0, 3], 2], [[0, 4], 1], [[0, 5], 1.5], [[3, 4], 1], [[0, 1], 0.6]],
  };
  // Марковская цепь по ступеням — для разнообразия
  const TRANS = {
    0: [[3, 2], [5, 3], [6, 2], [2, 1.5], [4, 1.5], [1, 0.5]],
    1: [[4, 3], [6, 1], [3, 1], [0, 0.5]],
    2: [[5, 2], [6, 2], [3, 2], [0, 0.5]],
    3: [[0, 2], [4, 2], [6, 2], [5, 1], [1, 0.5]],
    4: [[0, 3], [5, 2], [3, 1]],
    5: [[6, 3], [3, 2], [2, 2], [0, 1], [4, 1]],
    6: [[0, 3], [2, 2], [5, 1], [3, 0.5]],
  };
  // Последовательность из len аккордов (2, 4 или 8) для лада mode: чаще из проверенных, иногда цепью
  MG.progression = (r, len, extW, mode = 'aeolian') => {
    const minor = !!MG.MINOR[mode];
    let degs;
    if (r.chance(0.7)) {
      if (len <= 2) degs = r.weighted(PROGS[minor ? 'minor2' : 'major2']).slice(0, len);
      else {
        const list = PROGS[minor ? 'minor' : 'major'], a = r.weighted(list);
        degs = len > 4 ? a.concat(r.chance(0.5) ? a : r.weighted(list)) : a.slice(0, len);
      }
    } else {
      const start = r.chance(0.7) ? 0 : r.pick([5, 3, 2]);
      degs = [start];
      for (let i = 1; i < len; i++) degs.push(r.weighted(TRANS[degs[i - 1]]));
      // каденция: последний аккорд должен вести обратно к первому
      if (len > 2) {
        const last = degs[len - 1];
        if (last === start || !TRANS[last].some(x => x[0] === start)) {
          const prev = degs[len - 2];
          const ok = TRANS[prev].filter(x => x[0] !== start && TRANS[x[0]].some(y => y[0] === start));
          if (ok.length) degs[len - 1] = r.weighted(ok);
        }
      }
    }
    return degs.map(deg => MG.fitChord({ deg, ext: r.weighted(extW) }, mode));
  };

  // Голосоведение: обращение аккорда, ближайшее к предыдущему звучанию
  MG.voice = (midis, prev, lo, hi) => {
    const pcs = midis.map(m => ((m % 12) + 12) % 12);
    let best = null, bestCost = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      let base = lo;
      while (((base % 12) + 12) % 12 !== pcs[inv]) base++;
      const v = [base];
      for (let i = 1; i < pcs.length; i++) {
        let m = v[i - 1] + 1;
        while (((m % 12) + 12) % 12 !== pcs[(inv + i) % pcs.length]) m++;
        v.push(m);
      }
      if (v[v.length - 1] > hi) continue;
      const cost = prev
        ? v.reduce((s, m, i) => s + Math.abs(m - prev[Math.min(i, prev.length - 1)]), 0)
        : Math.abs(v[0] - (lo + 4));
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    return best || midis;
  };

  // ---------- Бас ----------
  // Событие: шаг s, длина len (в 16-х), нота n: r — корень, o/O — октава/две, f — квинта,
  // t — терция, s±k — ступени лада от корня, a — подход к следующему аккорду; acc — акцент, slide — глайд.
  MG.bassPattern = (r, style) => {
    const ev = [];
    const add = (s, len, n, acc = 0, slide = 0) => ev.push({ s, len, n, acc, slide });
    switch (style) {
      case 'offbeat':
        for (const s of [2, 6, 10, 14]) add(s, 1.6, s === 14 && r.chance(0.3) ? 'o' : 'r', 0);
        if (r.chance(0.4)) add(0, 0.8, 'r', 1);
        break;
      case 'rolling': {
        const pat = r.pick([['r', 'r', 'o', 'r'], ['r', 'o', 'r', 'r'], ['r', 'r', 'f', 'o'], ['r', 'r', 'r', 'o'], ['r', 'o', 'f', 'o']]);
        for (let s = 0; s < 16; s++) add(s, 0.75, pat[s % 4], s % 4 === 0 ? 1 : 0);
        break;
      }
      case 'gallop':
        for (let s = 0; s < 16; s++) if (s % 4 !== 1) add(s, 0.7, s % 4 === 3 && r.chance(0.35) ? 'o' : 'r', s % 4 === 0 ? 1 : 0);
        break;
      case 'synco': {
        let s = 0;
        while (s < 16) {
          const len = r.weighted([[1, 2], [2, 3], [3, 3], [4, 1.5], [6, 0.6]]);
          if (s === 0 || r.chance(0.72)) {
            const n = s === 0 ? 'r' : r.weighted([['r', 4], ['o', 2], ['f', 1.5], ['t', 0.8], ['s-1', 0.6], ['s+1', 0.6]]);
            add(s, Math.max(0.8, len * r.range(0.5, 0.95)), n, s % 4 === 0 ? 1 : 0, r.chance(0.12) ? 1 : 0);
          }
          s += len;
        }
        if (r.chance(0.5)) { for (let i = ev.length - 1; i >= 0; i--) if (ev[i].s >= 14) ev.splice(i, 1); add(14, 1.8, 'a'); }
        break;
      }
      case 'acid':
        for (let s = 0; s < 16; s++) {
          if (s !== 0 && !r.chance(0.68)) continue;
          const n = s === 0 ? 'r' : r.weighted([['r', 5], ['o', 2], ['f', 1], ['s-1', 1], ['s+1', 1], ['t', 1], ['s+2', 0.5], ['O', 0.6]]);
          add(s, r.chance(0.3) ? 1.9 : 0.7, n, r.chance(0.3) ? 1 : 0, r.chance(0.22) ? 1 : 0);
        }
        break;
      case 'long':
        add(0, 16, 'r');
        if (r.chance(0.45)) { ev[0].len = 12; add(12, 4, r.pick(['f', 'o', 'a'])); }
        break;
      case 'walking':
        add(0, 3.6, 'r', 1); add(4, 3.6, r.pick(['t', 'f', 'o'])); add(8, 3.6, r.pick(['f', 't', 's+1'])); add(12, 3.6, 'a');
        if (r.chance(0.4)) add(r.pick([3, 7, 11]), 0.9, r.pick(['o', 's+1', 'f']));
        break;
      case '808': {
        add(0, r.pick([6, 7, 10]), 'r', 1);
        for (const s of r.pick([[10], [7, 11], [6, 10, 14], [11], [3, 10]])) add(s, r.pick([2, 3, 4]), r.chance(0.7) ? 'r' : r.pick(['o', 'f', 's-1']), 0, r.chance(0.35) ? 1 : 0);
        break;
      }
      case 'chip': {
        const pat = r.pick([['r', 'o'], ['r', 'f', 'o', 'f'], ['r', 'r', 'o', 'r'], ['r', 'o', 'f', 'o']]);
        const step = r.chance(0.3) ? 1 : 2;
        for (let s = 0; s < 16; s += step) add(s, step * 0.8, pat[(s / step) % pat.length]);
        break;
      }
    }
    ev.sort((a, b) => a.s - b.s);
    const uniq = ev.filter((e, i) => i === 0 || e.s !== ev[i - 1].s);
    for (let i = 0; i < uniq.length; i++) {
      const nx = i + 1 < uniq.length ? uniq[i + 1].s : 16;
      uniq[i].len = Math.min(uniq[i].len, nx - uniq[i].s);
    }
    return uniq;
  };

  // Мутация баса: меняет одну-две ноты/акценты, сохраняя ритмический характер
  MG.mutateBass = (r, ev) => {
    for (let k = 0; k < r.int(1, 2); k++) {
      const e = r.pick(ev);
      if (!e || e.s === 0) continue;
      e.n = r.weighted([['r', 3], ['o', 2], ['f', 1.5], ['t', 0.8], ['s+1', 0.6], ['s-1', 0.6]]);
      if (r.chance(0.3)) e.acc = 1 - e.acc;
      if (r.chance(0.2)) e.slide = 1 - e.slide;
    }
  };

  // ---------- Барабаны ----------
  MG.drumPattern = (r, style) => {
    const z = () => new Array(16).fill(0);
    const p = { kick: z(), snare: z(), hat: z(), open: z(), shaker: z(), perc: z(), roll: 0, style };
    switch (style) {
      case 'four': {
        for (const s of [0, 4, 8, 12]) p.kick[s] = 1;
        p.snare[4] = p.snare[12] = 1;
        const openOff = r.chance(0.45);
        for (let s = 0; s < 16; s++) {
          if (s % 4 === 2) { if (openOff) p.open[s] = 0.8; else p.hat[s] = 0.9; }
          else if (r.chance(0.55)) p.hat[s] = s % 2 ? 0.35 : 0.5;
        }
        if (r.chance(0.3)) p.kick[r.pick([14, 15, 7])] = 0.6;
        if (r.chance(0.4)) for (let s = 0; s < 16; s++) if (r.chance(0.18)) p.perc[s] = 0.6;
        break;
      }
      case 'break': case 'dnb':
        p.kick[0] = 1; p.kick[10] = 1;
        if (style === 'break') for (const s of r.pick([[3], [7], [6, 11], [14], [7, 13]])) p.kick[s] = 0.8;
        else if (r.chance(0.5)) p.kick[r.pick([6, 11, 14])] = 0.7;
        p.snare[4] = p.snare[12] = 1;
        for (const s of [7, 9, 15, 2]) if (r.chance(0.3)) p.snare[s] = 0.22;
        for (let s = 0; s < 16; s++) p.hat[s] = s % 2 === 0 ? 0.7 : r.chance(style === 'dnb' ? 0.7 : 0.35) ? 0.35 : 0;
        if (r.chance(0.4)) p.open[r.pick([6, 14, 10])] = 0.6;
        break;
      case 'half': {
        p.kick[0] = 1;
        for (const s of r.pick([[11], [6, 11], [3, 10], [10, 13], [7]])) p.kick[s] = 0.85;
        p.snare[8] = 1;
        if (r.chance(0.3)) p.snare[r.pick([15, 13])] = 0.3;
        const dens = r.pick([2, 1]);
        for (let s = 0; s < 16; s += dens) p.hat[s] = s % 4 === 0 ? 0.7 : 0.45;
        p.roll = r.range(0.15, 0.45);
        break;
      }
      case 'boom':
        p.kick[0] = 1;
        for (const s of r.pick([[7, 10], [10], [8, 11], [3, 10]])) p.kick[s] = 0.8;
        p.snare[4] = p.snare[12] = 1;
        for (let s = 0; s < 16; s += 2) p.hat[s] = s % 4 ? 0.4 : 0.6;
        if (r.chance(0.5)) p.hat[15] = 0.3;
        if (r.chance(0.5)) for (let s = 0; s < 16; s++) p.shaker[s] = s % 2 ? 0.3 : 0.5;
        break;
      case 'chip':
        p.kick[0] = p.kick[8] = 1;
        if (r.chance(0.5)) p.kick[r.pick([6, 10, 14])] = 0.8;
        p.snare[4] = p.snare[12] = 1;
        for (let s = 0; s < 16; s++) p.hat[s] = s % 2 ? 0.25 : 0.4;
        break;
      case 'pulse':
        p.kick[0] = 0.7; p.kick[8] = 0.6;
        for (let s = 2; s < 16; s += 4) p.hat[s] = 0.5;
        break;
      case 'sparse':
        for (let s = 2; s < 16; s += 4) p.hat[s] = 0.45;
        for (let s = 0; s < 16; s++) if (r.chance(0.5)) p.shaker[s] = 0.5;
        if (r.chance(0.6)) p.perc[r.pick([3, 7, 11])] = 0.5;
        break;
      // 'none' — тишина
    }
    return p;
  };

  MG.mutateDrums = (r, p, amt) => {
    if (p.style === 'none') return;
    const n = Math.round(1 + amt * 3);
    for (let i = 0; i < n; i++) {
      const s = r.int(0, 15);
      switch (r.weighted([['hat', 4], ['perc', 1.5], ['shaker', 1], ['ghost', 1], ['kick', 0.7], ['open', 0.6]])) {
        case 'hat': if (s % 4 !== 2 || !p.open[s]) p.hat[s] = p.hat[s] ? 0 : 0.35; break;
        case 'perc': p.perc[s] = p.perc[s] ? 0 : 0.55; break;
        case 'shaker': p.shaker[s] = p.shaker[s] ? 0 : 0.4; break;
        case 'ghost': if (p.snare[s] < 1) p.snare[s] = p.snare[s] ? 0 : 0.2; break;
        case 'kick': { const k = r.pick([3, 7, 11, 14, 15]); if (p.kick[k] < 1) p.kick[k] = p.kick[k] ? 0 : 0.7; break; }
        case 'open': { const k = r.pick([2, 6, 10, 14]); if (!p.hat[k] || p.hat[k] < 0.9) p.open[k] = p.open[k] ? 0 : 0.6; break; }
      }
    }
  };

  // Сбивка в конце фразы. sub — смещение внутри шага (для 32-х).
  MG.fill = (r, kind) => {
    const ev = [];
    let from = 12;
    switch (kind) {
      case 'roll':
        for (let s = 12; s < 16; s++) for (const sub of [0, 0.5]) ev.push({ s, sub, i: 'snare', v: 0.35 + (s - 12) * 0.15 + sub * 0.1 });
        break;
      case 'toms': {
        from = r.pick([8, 12]);
        const fr = [260, 200, 150, 110];
        for (let s = from; s < 16; s++) if (s % 2 === 0 || r.chance(0.6)) ev.push({ s, sub: 0, i: 'tom', v: 0.8, f: fr[Math.floor(((s - from) / (16 - from)) * 4)] });
        break;
      }
      case 'stutter':
        for (let s = 12; s < 16; s++) ev.push({ s, sub: 0, i: s % 2 ? 'snare' : 'kick', v: 0.85 });
        ev.push({ s: 15, sub: 0.5, i: 'snare', v: 0.9 });
        break;
      case 'dropout':
        from = 14;
        ev.push({ s: 14, sub: 0, i: 'open', v: 0.7 });
        break;
      case 'build':
        from = 16; // нарастание делает свои барабаны сам
        break;
      default: // short
        from = 14;
        ev.push({ s: 14, sub: 0, i: 'snare', v: 0.7 }, { s: 15, sub: 0, i: 'snare', v: 0.8 }, { s: 15, sub: 0.5, i: 'snare', v: 0.9 });
    }
    return { from, ev, keepKick: kind === 'roll' || kind === 'short' };
  };

  // ---------- Арпеджио ----------
  // Рисунки по звукам аккорда (номера снизу вверх): вместо случайных — узнаваемые фигуры
  const ARP_PATS = [[0, 1, 2, 1], [0, 2, 1, 2], [0, 1, 2, 3], [0, 2, 3, 1], [0, 1, 0, 2], [0, 2, 4, 2], [3, 2, 1, 0],
    [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4], [0, 0, 2, 1]];
  MG.arpPat = r => r.pick(ARP_PATS).slice();
  MG.arp = r => ({
    mode: r.weighted([['up', 3], ['down', 1.2], ['updown', 2.5], ['pattern', 3], ['broken', 1.5]]),
    rate: r.weighted([[1, 4], [2, 2.5], [3, 1.2]]), // 16-е, 8-е, триоли
    oct: r.weighted([[1, 3], [2, 2]]),
    gate: r.range(0.35, 0.9),
    mask: Array.from({ length: 16 }, (_, i) => i % 4 === 0 || r.chance(0.8)),
    pat: MG.arpPat(r),
    pan: r.range(0.2, 0.6),
  });
  MG.arpNote = (a, tones, i) => {
    const ext = [];
    for (let o = 0; o < a.oct; o++) for (const t of tones) ext.push(t + 12 * o);
    const n = ext.length;
    switch (a.mode) {
      case 'down': return ext[n - 1 - (i % n)];
      case 'updown': { const p = Math.max(1, 2 * n - 2), k = i % p; return ext[k < n ? k : p - k]; }
      case 'random': return ext[Math.floor(Math.random() * n)];
      case 'pattern': return ext[a.pat[i % a.pat.length] % n];
      case 'broken': return ext[([0, 2, 1, 3][i % 4] + Math.floor(i / 4)) % n];
      default: return ext[i % n];
    }
  };

  // ---------- Мелодия ----------
  // Ритмы мотива на такт (шаги 16-х): редкие, средние, плотные
  const RHY = [
    [[0, 8], [0, 6, 12], [0, 4, 8], [0, 10], [0, 3, 8], [0, 6, 10], [0, 8, 12], [0, 4, 12]],
    [[0, 3, 6, 10], [0, 4, 6, 8, 12], [0, 2, 4, 8, 12], [0, 3, 6, 8, 12], [0, 4, 7, 10], [2, 4, 8, 12],
      [0, 6, 8, 12, 14], [0, 3, 6, 12, 14], [0, 4, 8, 10, 12]],
    [[0, 2, 4, 6, 8, 12], [0, 2, 3, 6, 8, 10, 12], [0, 3, 6, 8, 10, 12, 14], [0, 2, 4, 7, 8, 10, 12],
      [0, 3, 4, 6, 8, 11, 12, 14]],
  ];
  // Мотив: ритм на такт + контур (шаги по ступеням между соседними нотами). Ритм чаще берётся из готовых,
  // контур — дуга, впадина, подъём, спуск или волна; ходы в основном поступенные, а после скачка мелодия
  // делает шаг назад, заполняя его.
  MG.motif = (r, density) => {
    const tier = density < 0.35 ? r.weighted([[0, 2], [1, 1]])
      : density < 0.8 ? r.weighted([[0, 0.6], [1, 3], [2, 0.6]]) : r.weighted([[1, 2], [2, 1.5]]);
    const steps = r.chance(0.8) ? r.pick(RHY[tier]) : freeRhythm(r, density);
    const shape = r.weighted([['arch', 3], ['valley', 1.5], ['rise', 1.5], ['fall', 2], ['wave', 2]]);
    const n = steps.length;
    let prev = 0;
    return steps.map((s, i) => {
      const nx = i + 1 < n ? steps[i + 1] : 16;
      const len = Math.max(1, (nx - s) * (i === n - 1 ? r.range(0.6, 1) : r.chance(0.2) ? 0.5 : r.range(0.75, 1)));
      let d = 0;
      if (i > 0) {
        const x = i / (n - 1);
        let dir = shape === 'arch' ? (x <= 0.5 ? 1 : -1) : shape === 'valley' ? (x <= 0.5 ? -1 : 1)
          : shape === 'rise' ? 1 : shape === 'fall' ? -1 : Math.floor(i / 2) % 2 ? -1 : 1;
        if (r.chance(0.18)) dir = -dir;
        d = Math.abs(prev) >= 3 ? -Math.sign(prev) : dir * r.weighted([[1, 6], [2, 3], [0, 0.8], [3, 0.7], [4, 0.35]]);
      }
      prev = d;
      return { s, len, d };
    });
  };
  // Свободный ритм: ноты чаще на долях
  function freeRhythm(r, density) {
    const k = Math.round(r.range(2.5, 4.2) + density * 3);
    const cand = [];
    for (let s = 0; s < 16; s++) cand.push([s, s % 4 === 0 ? 3 : s % 2 === 0 ? 2 : 0.8]);
    const on = new Set([r.pick([0, 0, 0, 2, 4])]);
    for (let g = 0; on.size < k && g < 100; g++) on.add(r.weighted(cand));
    return [...on].sort((a, b) => a - b);
  }

  MG.varyMotif = (r, m, how) => {
    const v = m.map(n => Object.assign({}, n));
    switch (how) {
      case 'tail': for (let i = Math.max(1, v.length - 2); i < v.length; i++) v[i].d = r.pick([-2, -1, 1, 2, 3]); break;
      case 'invert': for (const n of v) n.d = -n.d; break;
      case 'retro': { const ds = v.map(n => n.d).reverse(); v.forEach((n, i) => { n.d = i ? -ds[i - 1] : 0; }); break; }
      case 'rhythm': {
        const i = r.int(1, Math.max(1, v.length - 1));
        if (v[i]) {
          const ns = v[i].s + r.pick([-1, 1]);
          if (ns > v[i - 1].s && (i + 1 >= v.length || ns < v[i + 1].s) && ns < 16) v[i].s = ns;
        }
        break;
      }
      case 'ornament': {
        const i = r.int(1, Math.max(1, v.length - 1));
        if (v[i] && v[i].s - v[i - 1].s >= 2) {
          v.splice(i, 0, { s: v[i].s - 1, len: 1, d: v[i].d + r.pick([-1, 1]) });
          v[i + 1].d = -(v[i].d - v[i + 1].d);
        }
        break;
      }
    }
    for (let i = 0; i < v.length; i++) {
      const nx = i + 1 < v.length ? v[i + 1].s : 16;
      v[i].len = Math.min(v[i].len, Math.max(0.5, nx - v[i].s));
    }
    return v;
  };

  // Звук аккорда, ближайший к deg; при равенстве — в сторону хода dir, чтобы контур не ломался
  function snap(ch, deg, dir) {
    for (let k = 0; k <= 3; k++) {
      const a = dir > 0 ? deg + k : deg - k, b = dir > 0 ? deg - k : deg + k;
      if (MG.isChordDeg(ch, a)) return a;
      if (MG.isChordDeg(ch, b)) return b;
    }
    return deg;
  }
  const into = (deg, lo, hi) => { while (deg > hi) deg -= 7; while (deg < lo) deg += 7; return deg; };

  // Фраза на 4 такта по схеме вида A A' B A'' (у B свой мотив или обращённый A). Ноты на сильных долях
  // и долгие — из аккорда, быстрые на слабых могут быть проходящими. У края диапазона ход разворачивается,
  // а не прыгает на октаву. Второй такт кончается вопросом — долгой нотой аккорда, но не основным тоном,
  // последний — ответом на основном тоне. chords — по аккорду на такт или на каждые полтакта (8 штук).
  MG.phrase = (r, chords, motif, opts) => {
    const lo = opts.lo, hi = opts.hi;
    const B = r.chance(0.5) ? MG.motif(r, opts.density) : MG.varyMotif(r, motif, r.pick(['invert', 'retro']));
    const plan = r.pick([['A', 'A1', 'B', 'A2'], ['A', 'B', 'A1', 'B2'], ['A', 'A', 'B', 'A2'], ['A', 'A1', 'A', 'B2'], ['A', 'B', 'A', 'B2']]);
    const chAt = (bi, st) => (chords.length >= 8 ? chords[bi * 2 + (st >= 8 ? 1 : 0)] : chords[bi % chords.length]);
    let last = opts.start != null ? into(opts.start, lo, hi) : Math.round((lo + hi) / 2);
    let top = -Infinity;
    const bars = plan.map((p, bi) => {
      let m = p[0] === 'A' ? motif : B;
      if (p[1] === '1') m = MG.varyMotif(r, m, r.pick(['tail', 'rhythm', 'ornament']));
      if (p[1] === '2') m = MG.varyMotif(r, m, 'tail');
      let deg = last;
      const out = [];
      m.forEach((n, i) => {
        const ch = chAt(bi, n.s);
        if (i === 0) deg = snap(ch, last, 0);
        else {
          const d = deg + n.d > hi || deg + n.d < lo ? -n.d : n.d;
          deg += d;
          if (n.s % 4 === 0 || n.len >= 3) deg = snap(ch, deg, d);
        }
        deg = into(deg, lo, hi);
        top = Math.max(top, deg);
        out.push({ s: n.s, len: n.len, deg, vel: n.s % 4 === 0 ? 1 : 0.8 });
      });
      const L = out[out.length - 1];
      if (L && bi === 3) {
        L.deg = into(MG.nearestRootDeg(chAt(bi, L.s), L.deg), lo, hi);
        L.len = Math.max(L.len, 16 - L.s);
      } else if (L && bi === 1 && L.s >= 6) {
        const ch = chAt(bi, L.s);
        let d = snap(ch, L.deg, 0);
        if (mod7(d - ch.deg) === 0) d = snap(ch, d + (d + 2 <= hi ? 2 : -2), 0);
        L.deg = into(d, lo, hi);
        L.len = Math.max(L.len, Math.min(16 - L.s, 4));
      }
      if (out.length) last = out[out.length - 1].deg;
      return out;
    });
    // вершина фразы чуть громче
    for (const b of bars) for (const n of b) if (n.deg === top) n.vel = Math.min(1.1, n.vel + 0.1);
    return bars;
  };

  AK.MGen = MG;
})(window.AK);
