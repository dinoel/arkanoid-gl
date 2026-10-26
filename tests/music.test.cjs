'use strict';
// node --test tests/music.test.cjs — composer and light-show contracts, no browser dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const tonal = ['bass', 'pad', 'stab', 'pluck', 'lead'];
const drums = ['kick', 'snare', 'hat', 'perc', 'crash', 'impact', 'tom', 'shaker'];

function rig(style = 'synthwave', seed = 1234, intensity = 0.5) {
  const calls = [], timers = new Set(), c = { currentTime: 0 };
  const sandbox = { window: {}, console, document: { hidden: false },
    setInterval: fn => { timers.add(fn); return fn; }, clearInterval: fn => timers.delete(fn) };
  vm.createContext(sandbox);
  const load = file => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), sandbox, { filename: file });
  load('util.js'); load('music-gen.js');
  const AK = sandbox.window.AK;
  const synth = {};
  for (const name of [...tonal, ...drums, 'init', 'setTempo', 'expression', 'gate', 'stop', 'dip', 'sweep', 'lpPath',
    'setLp', 'hpReset', 'hpSweep', 'throw', 'swell', 'riser', 'downlift']) {
    synth[name] = (...args) => { if (tonal.includes(name) || drums.includes(name)) calls.push({ name, args }); };
  }
  AK.MSynth = synth; AK.A = { playing: true, musicOn: true };
  load('music.js');
  const M = AK.Music;
  M.set('style', style); M.setIntensity(intensity); M.newSong(seed); M.init(c);
  const tick = () => { for (const f of timers) f(); };
  const render = (until, onCue = () => {}) => {
    while (c.currentTime < until) {
      c.currentTime = Math.min(until, c.currentTime + 0.025);
      tick(); M.lights(c.currentTime, onCue);
    }
  };
  return { AK, M, calls, c, render, tick, timers, load };
}

test('seed reproduces composition and actual note timestamps for all six styles', () => {
  for (const style of rig().M.styles) {
    const a = rig(style, 808), b = rig(style, 808);
    a.render(40); b.render(40);
    assert.equal(JSON.stringify(a.calls), JSON.stringify(b.calls), style);
    assert.ok(a.calls.some(e => e.name === 'lead'), `${style}: theme enters`);
    assert.ok(a.calls.some(e => e.name === 'bass'), `${style}: bass enters`);
  }
});

test('every scheduled instrument has exactly one matching light cue at its audible time', () => {
  const q = rig('dnb', 42, 0.85), cues = [];
  q.M.queue('drop');
  q.render(22, (name, v, m, d) => {
    if (name !== 'chord') cues.push({ name, v, m: m && Array.isArray(m) ? Array.from(m) : m, d });
  });
  const expected = q.calls.filter(e => e.args[0] <= q.c.currentTime).sort((a, b) => a.args[0] - b.args[0]).map(({ name, args: a }) => ({
    name: name === 'tom' ? 'perc' : name === 'shaker' ? 'hat' : name,
    v: tonal.includes(name) ? a[3] : a[1],
    m: tonal.includes(name) ? (Array.isArray(a[1]) ? Array.from(a[1]) : a[1]) : undefined,
    d: tonal.includes(name) ? a[2] : undefined,
  }));
  // Cues within a frame can arrive in scheduling order (e.g. a swung hat and a chord).
  const stable = a => a.map(x => JSON.stringify(x)).sort();
  assert.deepEqual(stable(cues), stable(expected));
  const future = rig('chip'); future.tick();
  const early = []; future.M.lights(0, (...e) => early.push(e));
  assert.equal(early.length, 0, 'lookahead must not flash early');
});

test('all sections, modes and seeds produce finite notes, legal durations and a continuous clock', () => {
  for (const [i, style] of rig().M.styles.entries()) for (let seed = 1; seed <= 5; seed++) {
    const q = rig(style, seed, seed / 5);
    q.M.set('mode', q.M.modes[(i + seed) % q.M.modes.length]);
    q.M.newSong(seed);
    let beat = -1;
    for (const section of q.M.sections) {
      q.M.queue(section);
      q.render(q.c.currentTime + 12, (name, v, m, d) => {
        assert.ok(Number.isFinite(v) && v >= 0, name);
        if (m !== undefined) for (const n of Array.isArray(m) ? m : [m]) assert.ok(Number.isFinite(n) && n >= 20 && n <= 115, `${name}: ${n}`);
        if (d !== undefined) assert.ok(Number.isFinite(d) && d > 0 && d < 20, `${name}: ${d}`);
      });
      const clock = q.M.clock(q.c.currentTime);
      assert.ok(clock && clock.beat > beat, `${style} ${section}`); beat = clock.beat;
    }
  }
});

test('mute/pause/new song discard stale cues and preserve bounded scheduling on resume', () => {
  const q = rig(); q.render(1);
  q.AK.A.musicOn = false; q.tick();
  assert.equal(q.M.clock(q.c.currentTime), null);
  const stale = []; q.M.lights(100, (...a) => stale.push(a)); assert.equal(stale.length, 0);
  const n = q.calls.length; q.render(10); assert.equal(q.calls.length, n);
  q.AK.A.musicOn = true; q.render(10.3);
  assert.ok(q.calls.length > n && q.calls.slice(n).every(e => e.args[0] >= 10));
  q.M.newSong(2); const old = []; q.M.lights(10.3, (...a) => old.push(a)); assert.equal(old.length, 0);
  q.AK.A.playing = false; q.tick(); assert.equal(q.M.clock(10.3), null);
  q.AK.A.playing = true; q.render(11); assert.ok(q.M.clock(11));
  q.c.currentTime = 100; const before = q.calls.length; q.tick();
  assert.ok(q.calls.slice(before).every(e => e.args[0] >= 100), 'no burst of late notes after a stall');
});

test('game events resolve at the next bar and intensity changes arrangement within one bar', () => {
  const q = rig('synthwave', 19, 0.1);
  q.M.queue('drop'); q.render(4);
  const quiet = q.M.state().intensity;
  q.M.setIntensity(1); q.render(7);
  assert.ok(q.M.state().intensity > quiet + 0.35);
  q.M.event('lose'); q.render(10); assert.equal(q.M.state().section, 'break');
  q.M.event('clear'); q.render(13); assert.equal(q.M.state().section, 'build');
});

test('high game intensity audibly adds rhythmic activity and brings the build forward', () => {
  const low = rig('synthwave', 77, 0.1), high = rig('synthwave', 77, 1);
  for (const q of [low, high]) { q.M.set('evolve', 0); q.M.set('modulate', 0); q.M.queue('groove'); q.render(8); }
  const activity = q => q.calls.filter(e => ['hat', 'perc', 'shaker', 'pluck'].includes(e.name)).length;
  assert.ok(activity(high) > activity(low), `${activity(high)} > ${activity(low)}`);
  high.render(12); low.render(12);
  assert.ok(['build', 'drop'].includes(high.M.state().section) || high.M.state().next === 'build');
  assert.equal(low.M.state().section, 'groove');
});

test('manual harmonic changes publish their new colour before the next bar', () => {
  const q = rig(); q.render(0.7); q.M.set('key', 9);
  const notes = []; q.render(1.2, (name, v, m) => { if (name === 'chord') notes.push(m); });
  assert.ok(notes.length > 0, 'new chord colour must accompany the changed notes');
});

test('harmonic voicings stay in range and hooks repeat on repeated harmony', () => {
  const { AK } = rig(), G = AK.MGen;
  for (const mode of Object.keys(G.MODES)) for (let seed = 0; seed < 50; seed++) {
    const r = AK.U.rng(seed), motif = G.motif(r, 0.6), ch = { deg: 0, ext: 'triad' };
    const phrase = G.phrase(r, [ch, ch, ch, ch], motif, { lo: 0, hi: 10, density: 0.6 });
    assert.equal(JSON.stringify(phrase[0].map(n => [n.s, n.deg])), JSON.stringify(phrase[2].map(n => [n.s, n.deg])));
    let prev = null;
    for (const chord of G.progression(r, 8, [['triad', 1], ['seven', 1], ['add9', 1]], mode)) {
      prev = G.voice(G.chordMidis(60, mode, chord), prev, 53, 77);
      assert.ok(prev.every(n => n >= 53 && n <= 77));
    }
  }
});

test('invalid controls cannot stop the scheduler; reinitialization has one timer', () => {
  const q = rig();
  q.M.set('bpm', -1); assert.equal(q.M.state().bpm, 60);
  q.M.set('bpm', Infinity); q.M.setIntensity(NaN); q.M.set('mode', 'invalid');
  q.M.init(q.c); assert.equal(q.timers.size, 1);
  q.render(3); assert.ok(q.calls.length > 0);
});
