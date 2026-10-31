'use strict';
// node --test tests/art.test.cjs — the painting level (levelgen.js → art, art.js): level 3 is a wall of bricks
// coloured like the painting under it; once the wall is down, the lights go up and the painting stays on show
// for a while before the next level.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { game, frames } = require('./headless.cjs');

function level3(seed) {
  const AK = game(seed), G = AK.G;
  G.newGame(seed, false, 3);
  return { AK, G };
}

test('level 3 is a painting: a wall over the canvas, each brick the colour of the painting under it', () => {
  for (const seed of [1, 7, 42]) {
    const { AK, G } = level3(seed);
    const a = G.lv.art, where = `seed ${seed}`;
    assert.equal(G.lv.gen, 'art', where);
    assert.ok(a && AK.Art.get(a.id), where + ': the level knows its painting');
    assert.ok(Math.abs(a.w / a.h - AK.Art.get(a.id).aspect) < 1e-6, where + ': the canvas keeps the proportions');
    assert.ok(G.bricks.length >= 200, `${where}: ${G.bricks.length} bricks`);
    assert.ok(G.bricks.every(k => k.kind !== 'steel' && k.kind !== 'armor'), where + ': nothing unbreakable hides the painting');
    // the wall is a contrastier copy: brick and painting colours go up and down together, channel by channel
    const pairs = [];
    for (const k of G.bricks) {
      assert.ok(k.x > a.x && k.x < a.x + a.w && k.y > a.y && k.y < a.y + a.h, `${where}: brick at ${k.x.toFixed(0)},${k.y.toFixed(0)} is on the canvas`);
      if (k.kind !== 'normal') continue;
      const u = (k.x - a.x) / a.w, v = (k.y - a.y) / a.h;
      pairs.push([k.color, AK.Art.avg(a.id, u - 0.03, v - 0.02, u + 0.03, v + 0.02)]);
    }
    for (let ch = 0; ch < 3; ch++) {
      const xs = pairs.map(p => p[0][ch]), ys = pairs.map(p => p[1][ch]), mean = q => q.reduce((s, x) => s + x, 0) / q.length;
      const mx = mean(xs), my = mean(ys);
      const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my))), sx = Math.sqrt(mean(xs.map(x => (x - mx) ** 2))), sy = Math.sqrt(mean(ys.map(y => (y - my) ** 2)));
      assert.ok(cov / (sx * sy) > 0.85, `${where}: channel ${ch} of the bricks follows the painting (r = ${(cov / (sx * sy)).toFixed(2)})`);
    }
    const special = G.bricks.filter(k => k.kind !== 'normal').length;
    assert.ok(special < G.bricks.length * 0.1, `${where}: only a few special bricks (${special})`);
  }
});

test('once the wall is down the lights go up, and the painting is on show longer than a usual pause', () => {
  const { G } = level3(5);
  frames(G, 1);
  for (const k of G.bricks) k.alive = false;
  assert.ok(frames(G, 0.5, () => G.state === 'clear'), 'level cleared');
  assert.equal(G.reveal < 0.5, true, 'the lights are only starting to go up');
  frames(G, 2);
  assert.equal(G.level, 3, 'still looking at the painting');
  assert.equal(G.reveal, 1, 'full light');
  assert.ok(frames(G, 5, () => G.level === 4), 'then the next level');
  assert.ok(!G.lv.art, 'which is not a painting');
  assert.equal(G.reveal, 0);
});
