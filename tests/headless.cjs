'use strict';
// Game logic without a browser for node --test: physics, levels, bosses, water and the game itself; audio and UI
// are stubs. Math.random is seeded, so a run plays out the same every time.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function game(seed = 1, { water = false } = {}) {
  let s = seed >>> 0;
  const math = Object.create(null);
  for (const k of Object.getOwnPropertyNames(Math)) math[k] = Math[k];
  math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sandbox = { window: {}, console, Math: math };
  vm.createContext(sandbox);
  const load = file => vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', file), 'utf8'), sandbox, { filename: file });
  load('util.js'); load('physics.js');
  const AK = sandbox.window.AK;
  AK.A = { newSong() {}, magnet() {}, playing: false };
  AK.UI = { banner() {}, gameOver() {} };
  for (const file of ['levelgen.js', 'boss.js', 'water.js', 'seabed.js', 'fish.js', 'fish-top.js', 'game.js']) load(file);
  AK.Water.on = water; // the water sim is most of the cost; off unless the test needs it
  return AK;
}

// Runs the game for secs at 60 fps; each() after every frame, true stops early. Returns whether it stopped.
function frames(G, secs, each) {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    G.update(1 / 60);
    if (each && each()) return true;
  }
  return false;
}

module.exports = { game, frames };
