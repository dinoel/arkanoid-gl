'use strict';
// Цветомузыка: прожекторы на стенах играют музыку светом.
// Цвет — от нот: у каждой высоты свой оттенок по квинтовому кругу, как у Скрябина (до — красный, соль —
// оранжевый, ре — жёлтый, ля — зелёный…). Смена аккорда перекрашивает весь зал, мелодия переливается.
// У прожекторов роли, свет от разных ролей складывается, как настоящий свет:
//  • все — неяркая заливка цветом аккорда, чтобы было из чего вспыхивать;
//  • нижние два ряда — бас и бочка: горят цветом ноты баса, бочка бьёт по ним вспышкой;
//  • верхние ряды — малый барабан: вспышка цветом, противоположным аккорду;
//  • арпеджио — бегущий огонь: каждая нота зажигает следующий прожектор по кругу своим цветом;
//  • мелодия — верхние прожекторы и первый ряд: светят цветом ноты, верхние поворачиваются за её высотой;
//  • тарелки — короткие искры на случайных прожекторах; крэш и удар в начале секции — белая вспышка всех.
// Лучи танцуют фигурами: веер в одну точку, крест, дождь, гребёнка по низу поля, решётка поперёк, все
// на мяч. Фигура меняется к сильной доле: в дропе каждый такт, в спокойных частях реже, в конце нарастания —
// каждую долю; последний такт нарастания мигает восьмыми и гаснет перед дропом. На каждую долю лучи кивают.
// Без музыки — прежнее медленное покачивание своими цветами.
(function (AK) {
  const { U } = AK;
  const { clamp } = U;
  const W = 720, FL = 16, FR = 704, FT = 72, FB = 870; // поле; FB — низ, куда светят фигуры
  const WHITE = [1, 1, 1];

  const hue = m => ((((Math.round(m) % 12) + 12) % 12) * 7 % 12) / 12;
  const noteCol = (m, s = 1, l = 0.55) => U.hsl(hue(m), s, l);
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const wrap = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

  // Фигуры: куда светит прожектор q (точка на поле). n — число прожекторов, q.ri — номер по кругу.
  const FIGS = [
    () => [W / 2, 620],                                                                           // веер
    q => (q.side ? [q.side > 0 ? FR - 90 : FL + 90, Math.min(q.y + 300, FB)] : [q.x < W / 2 ? FR - 60 : FL + 60, FB]), // крест
    q => (q.side ? [q.x + q.side * 150, FB] : [q.x, FB]),                                          // дождь
    (q, n) => [FL + 40 + (q.ri / (n - 1)) * (FR - FL - 80), FB],                                   // гребёнка
    q => (q.side ? [q.side > 0 ? FR : FL, q.y + 60] : [q.x < W / 2 ? FL + 20 : FR - 20, FT + 260]), // решётка
    (q, n, g) => { const b = g.balls[0]; return b ? [b.x, b.y] : [W / 2, 620]; },                  // на мяч
  ];
  const BALL_FIG = 5;
  const LIM = 1.3; // насколько луч может отклониться от перпендикуляра к своей стене, рад

  const S = {
    t: 0, drive: 0, spots: null, n: 0, ci: 0, u: -1, fig: 0,
    chord: [0.6, 0.6, 0.7], chordT: [0.6, 0.6, 0.7], chordH: 0,
    bass: { e: 0, hold: 0, c: WHITE }, lead: { e: 0, hold: 0, c: WHITE, m: 67, mt: 67 },
    kick: 0, snare: 0, stab: 0, pad: 0, flash: 0,
    chase: new Float32Array(16), chaseC: [], spark: new Float32Array(16),
  };

  // Новый набор прожекторов (новый уровень): номер по кругу — левая стена снизу вверх, верх слева направо,
  // правая стена сверху вниз; перпендикуляр к своей стене
  function setup(spots) {
    const key = q => (q.side === 1 ? 3 - q.row : q.side === 0 ? (q.x < W / 2 ? 4 : 5) : 6 + q.row);
    spots.slice().sort((a, b) => key(a) - key(b)).forEach((q, i) => { q.ri = i; });
    for (const q of spots) {
      q.norm = q.side === 1 ? 0 : q.side === -1 ? Math.PI : Math.PI / 2;
      q.af = q.a = q.ang; q.c = q.col.slice(); q.e = 1;
      S.chaseC[q.ri] = WHITE;
    }
    S.spots = spots; S.n = spots.length;
  }

  function onNote(now, name, v, m, d) {
    switch (name) {
      case 'kick': S.kick = Math.max(S.kick, v); break;
      case 'snare': S.snare = Math.max(S.snare, v); break;
      case 'hat': case 'perc': { const i = (Math.random() * S.n) | 0; S.spark[i] = Math.max(S.spark[i], 0.5 * v); break; }
      case 'crash': case 'impact': S.flash = Math.max(S.flash, v); break;
      case 'pad': S.pad = Math.max(S.pad, v); break;
      case 'stab': S.stab = Math.max(S.stab, 0.8 * v); break;
      case 'chord': S.chordT = noteCol(m, 0.85); S.chordH = hue(m); break;
      case 'bass': S.bass.e = Math.max(S.bass.e, v); S.bass.hold = now + d; S.bass.c = noteCol(m); break;
      case 'lead': {
        const L = S.lead;
        L.e = Math.max(L.e, v); L.hold = now + d; L.c = noteCol(m, 1, 0.6); L.mt = m;
        break;
      }
      case 'pluck': S.ci = (S.ci + 1) % S.n; S.chase[S.ci] = v; S.chaseC[S.ci] = noteCol(m, 1, 0.6); break;
    }
  }

  // Угол, под которым прожектор q смотрит на точку (px, py), — не дальше LIM от перпендикуляра к стене
  const aim = (q, p) => q.norm + clamp(wrap(Math.atan2(p[1] - q.y, p[0] - q.x) - q.norm), -LIM, LIM);

  AK.Show = {
    // Раз в кадр: считает каждому прожектору угол q.a, цвет q.c и яркость q.e. t — время игры, с.
    update(g, t) {
      const dt = clamp(t - S.t, 0, 0.1);
      S.t = t;
      if (S.spots !== g.spots) setup(g.spots);
      const A = AK.A, M = AK.Music;
      const now = A.ready && A.playing && A.musicOn ? A.now() : -1;
      const clk = now >= 0 ? M.clock(now) : null;
      const f = k => Math.exp(-dt * k);
      S.kick *= f(9); S.snare *= f(8); S.stab *= f(6); S.pad *= f(0.8); S.flash *= f(2.5);
      for (let i = 0; i < S.n; i++) { S.chase[i] *= f(6); S.spark[i] *= f(16); }
      S.bass.e *= f(now < S.bass.hold ? 1.2 : 7);
      S.lead.e *= f(now < S.lead.hold ? 0.8 : 5);
      S.lead.m += (S.lead.mt - S.lead.m) * (1 - f(14));
      S.chord = mix(S.chord, S.chordT, 1 - f(5));
      if (now >= 0) M.lights(now, (name, v, m, d) => onNote(now, name, v, m, d));
      S.drive += ((clk ? 1 : 0) - S.drive) * (1 - f(2));
      const D = S.drive;

      // фигура и такт
      const e = clk ? clk.e : 0.5, beat = clk ? clk.beat : 0;
      let strobe = 1, whiten = 0, follow = 12, nod = 0;
      if (clk) {
        const lastBars = clk.type === 'build' && clk.bar >= clk.len - 2;
        const per = lastBars && clk.bar === clk.len - 1 ? 1 : lastBars ? 2 : e >= 0.9 ? 4 : e >= 0.5 ? 8 : 16;
        const u = Math.floor((beat + 0.25) / per); // смена фигуры начинается чуть раньше доли и приходит на неё
        if (u !== S.u) {
          S.u = u;
          let k = (S.fig + 1 + Math.floor(U.hash(u, 17, 3) * (FIGS.length - 1))) % FIGS.length;
          if (k === BALL_FIG && e < 0.75) k = (k + 1) % FIGS.length;
          S.fig = k;
        }
        if (e < 0.4) follow = 3; // в тихих частях лучи переходят медленно
        nod = 0.07 * e * Math.exp(-(beat - Math.floor(beat)) * 9);
        if (clk.type === 'build' && clk.bar === clk.len - 1) {
          const st = (beat * 4) % 16;
          if (st >= 14) strobe = 0.08; // тишина перед дропом — темнота
          else { strobe = (beat * 2) % 1 < 0.5 ? 1.3 : 0.25; whiten = 0.5; }
        }
      }

      const wash = 0.22 + 0.2 * e + 0.3 * S.pad;
      const kickC = mix(S.bass.c, WHITE, 0.3), snareC = U.hsl(S.chordH + 0.5, 1, 0.6), sparkC = mix(S.chord, WHITE, 0.6);
      const leadOff = clamp((S.lead.m - 67) / 12, -1, 1) * 0.45 * Math.min(1, S.lead.e * 2);
      for (const q of S.spots) {
        // движение; верхние прожекторы ещё и поворачиваются за высотой мелодии (выше нота — ближе к центру)
        const idle = q.ang + q.amp * Math.sin(t * q.fr + q.ph);
        const target = clk ? aim(q, FIGS[S.fig](q, S.n, g)) : idle;
        q.af += (target - q.af) * (1 - f(clk ? follow : 25));
        let a = q.af + nod * q.side;
        if (q.row < 0) a -= leadOff * (q.x < W / 2 ? 1 : -1);
        q.a = idle + (a - idle) * D;

        // свет — сумма ролей
        let r = 0, gg = 0, b = 0;
        const add = (k, col) => { r += k * col[0]; gg += k * col[1]; b += k * col[2]; };
        add(wash, S.chord);
        if (q.row >= 2) { add(0.85 * S.bass.e, S.bass.c); add(S.kick, kickC); }
        else add(0.9 * S.snare, snareC);
        if (q.row <= 0) add(0.95 * S.lead.e, S.lead.c);
        add(1.1 * S.chase[q.ri], S.chaseC[q.ri]);
        add(S.spark[q.ri], sparkC);
        add(0.5 * S.stab, S.chord);
        add(1.3 * S.flash, WHITE);
        let em = Math.max(r, gg, b, 1e-3);
        const col = mix([r / em, gg / em, b / em], WHITE, whiten);
        em = Math.min(em * strobe, 2.2);
        q.e = 1 + (em - 1) * D;
        q.c = mix(q.col, col, D);
      }
    },
  };
})(window.AK);
