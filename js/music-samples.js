'use strict';
// Записанные инструменты: живые ударные, пианино, маримба, вибрафон, калимба и тенор-саксофон из Versilian
// Community Sample Library (CC0, список файлов — audio/README.md). Набор грузится в фоне, когда понадобился
// стилю (want); пока он не готов (ready), music-synth.js играет синтезом. Ноты записаны через 2–4 полутона:
// нужная получается ускорением ближайшей, а корни измерены по спектру — у пианино верхние ноты чуть завышены,
// как у настоящего, а у кенийской калимбы свой, не темперированный строй.
(function (AK) {
  const Smp = {};
  const base = typeof document !== 'undefined' && document.currentScript ? new URL('../audio/', document.currentScript.src).href : 'audio/';
  // Ноты: имя файла → корень (MIDI, с центами)
  const NOTES = {
    piano: { A1: 44.87, Cs2: 48.98, F2: 52.99, A2: 57.01, Cs3: 61.01, F3: 65.01, A3: 69.02, Cs4: 73.05, F4: 77.04, A4: 81.03, Cs5: 85.13, F5: 89.13, A5: 93.14 },
    marimba: { F1: 40.99, C2: 48.02, G2: 55, B2: 59.03, F3: 65, C4: 72.04, G4: 78.98, B4: 83, F5: 88.98, C6: 96.01 },
    vibes: { F2: 53.01, A2: 57, C3: 60, E3: 64, G3: 67, B3: 71, D4: 74, F4: 77, A4: 81, C5: 84, E5: 88 },
    kalimba: { B2: 58.92, Cs3: 61.2, Ds3: 63.09, Fs3: 66.17, Gs3: 68.44, B3: 71.18, Cs4: 73.2, Ds4: 75.27, Fs4: 78.36, A4: 80.64, B4: 83.52 },
    sax: { Gs1: 43.99, C2: 48, E2: 51.99, Gs2: 56, C3: 60, E3: 64, Gs3: 68, C4: 72, E4: 75.98, Gs4: 80, C5: 84 },
  };
  // Ударные: слои по громкости (тихий, громкий), в слое — дубли, они идут по очереди
  const DRUMS = {
    closed: [['hat-c1', 'hat-c2'], ['hat-c3', 'hat-c4']], open: [['hat-o1', 'hat-o2']],
    snare: [['snare1', 'snare2'], ['snare3', 'snare4']], rim: [['rim1', 'rim2']], clap: [['clap1', 'clap2', 'clap3', 'clap4']],
    shaker: [['shaker1', 'shaker2', 'shaker3', 'shaker4']], tom: [['tom1'], ['tom2']], crash: [['crash1'], ['crash2']],
    tumba: [['tumba']], conga: [['conga']], quinto: [['quinto']], slap: [['slap']],
  };
  const FILES = { drums: [...new Set(Object.values(DRUMS).flat(2))] };
  for (const k in NOTES) FILES[k] = Object.keys(NOTES[k]);

  let ctx = null;
  const sets = {};      // набор → 'wait' (ждёт звука) | 'load' | 'ready' | 'fail'
  const buf = {};       // 'набор/имя' → { buf, off }: off — где начинается звук (MP3 может добавить тишину)
  const turn = {};      // очередь дублей
  const notes = {};     // набор → [[корень, запись]] по возрастанию

  function onset(b) {
    const d = b.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < peak * 0.02) i++;
    return Math.max(0, i - b.sampleRate * 0.0005) / b.sampleRate;
  }
  async function load(name) {
    sets[name] = 'load';
    try {
      await Promise.all(FILES[name].map(async f => {
        const res = await fetch(base + name + '/' + f + '.mp3');
        if (!res.ok) throw new Error(res.status + ' ' + f);
        const data = await res.arrayBuffer();
        const b = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
        buf[name + '/' + f] = { buf: b, off: onset(b) };
      }));
      if (NOTES[name]) notes[name] = Object.entries(NOTES[name]).map(([f, m]) => [m, buf[name + '/' + f]]).sort((a, b) => a[0] - b[0]);
      sets[name] = 'ready';
    } catch (e) {
      sets[name] = 'fail'; // так и останется синтез
      if (typeof console !== 'undefined') console.warn('samples:', name, e.message);
    }
  }

  // Звук включён: грузим то, что уже просили. Записи не привязаны к контексту — новому достаются готовые
  Smp.init = function (c) {
    ctx = c;
    for (const k in sets) if (sets[k] === 'wait') load(k);
  };
  // Набор понадобится (имя набора или инструмента: piano, vibes, …, drums); незнакомые имена — мимо
  Smp.want = function (name) {
    if (!FILES[name] || sets[name]) return;
    if (ctx) load(name);
    else sets[name] = 'wait';
  };
  Smp.ready = name => sets[name] === 'ready';
  Smp.has = name => !!FILES[name];

  // Удар из группы DRUMS громкостью vel: { buf, off }
  Smp.drum = function (group, vel) {
    const layers = DRUMS[group], takes = layers[vel < 0.6 || layers.length < 2 ? 0 : 1];
    const k = group + (takes === layers[0] ? 0 : 1), n = (turn[k] = ((turn[k] || 0) + 1) % takes.length);
    return buf['drums/' + takes[n]];
  };
  // Нота midi: ближайшая запись и во сколько её ускорить: { buf, off, rate }
  Smp.note = function (name, midi) {
    const list = notes[name];
    let best = list[0];
    for (const it of list) if (Math.abs(it[0] - midi) < Math.abs(best[0] - midi)) best = it;
    return { buf: best[1].buf, off: best[1].off, rate: Math.pow(2, (midi - best[0]) / 12) };
  };

  AK.MSamples = Smp;
})(window.AK);
