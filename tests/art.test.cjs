'use strict';
// node --test tests/art.test.cjs — the painting levels (levelgen.js → art and artLive, art.js): level 2 is a wall
// of bricks coloured like the painting under it; once the wall is down, the lights go up and the painting stays
// on show for a while. Level 3 is the same painting alive: its heads, made of bricks, spin or nod on their stems,
// and the canvas under each head turns with it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { game, frames } = require('./headless.cjs');

function level(seed, n) {
  const AK = game(seed), G = AK.G;
  G.newGame(seed, false, n);
  return { AK, G };
}
// Group of a brick (a head of the living painting: 'head0', 'head1'…): it is kept in the level's description
const grpOf = G => { const m = new Map(G.bricks.map((k, i) => [k, G.lv.bricks[i].grp])); return k => m.get(k); };

// The wall is a contrastier copy: brick and painting colours go up and down together, channel by channel
// (only skip(k) bricks are not: the heads of the living painting have colours of their own)
function followsPainting(AK, G, where, skip = () => false) {
  const a = G.lv.art, pairs = [];
  for (const k of G.bricks) {
    assert.ok(k.x > a.x && k.x < a.x + a.w && k.y > a.y && k.y < a.y + a.h, `${where}: brick at ${k.x.toFixed(0)},${k.y.toFixed(0)} is on the canvas`);
    if (k.kind !== 'normal' || skip(k)) continue;
    const u = (k.x - a.x) / a.w, v = (k.y - a.y) / a.h;
    pairs.push([k.color, AK.Art.avg(a.id, u - 0.03, v - 0.02, u + 0.03, v + 0.02)]);
  }
  for (let ch = 0; ch < 3; ch++) {
    const xs = pairs.map(p => p[0][ch]), ys = pairs.map(p => p[1][ch]), mean = q => q.reduce((s, x) => s + x, 0) / q.length;
    const mx = mean(xs), my = mean(ys);
    const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my))), sx = Math.sqrt(mean(xs.map(x => (x - mx) ** 2))), sy = Math.sqrt(mean(ys.map(y => (y - my) ** 2)));
    assert.ok(cov / (sx * sy) > 0.85, `${where}: channel ${ch} of the bricks follows the painting (r = ${(cov / (sx * sy)).toFixed(2)})`);
  }
}

test('level 2 is a painting: a wall over the canvas, each brick the colour of the painting under it', () => {
  for (const seed of [1, 7, 42]) {
    const { AK, G } = level(seed, 2);
    const a = G.lv.art, where = `seed ${seed}`;
    assert.equal(G.lv.gen, 'art', where);
    assert.ok(a && AK.Art.get(a.id), where + ': the level knows its painting');
    assert.ok(Math.abs(a.w / a.h - AK.Art.get(a.id).aspect) < 1e-6, where + ': the canvas keeps the proportions');
    assert.ok(G.bricks.length >= 200, `${where}: ${G.bricks.length} bricks`);
    assert.ok(G.bricks.every(k => k.kind !== 'steel' && k.kind !== 'armor'), where + ': nothing unbreakable hides the painting');
    assert.ok(G.bricks.every(k => !k.motion), where + ': nothing moves yet');
    followsPainting(AK, G, where);
    const special = G.bricks.filter(k => k.kind !== 'normal').length;
    assert.ok(special < G.bricks.length * 0.1, `${where}: only a few special bricks (${special})`);
  }
});

test('once the wall is down the lights go up, the painting is on show for a while, and then it comes alive', () => {
  const { G } = level(5, 2);
  frames(G, 1);
  for (const k of G.bricks) k.alive = false;
  assert.ok(frames(G, 0.5, () => G.state === 'clear'), 'level cleared');
  assert.equal(G.reveal < 0.5, true, 'the lights are only starting to go up');
  frames(G, 2);
  assert.equal(G.level, 2, 'still looking at the painting');
  assert.equal(G.reveal, 1, 'full light');
  assert.ok(frames(G, 5, () => G.level === 3), 'then the next level');
  assert.equal(G.lv.gen, 'artLive', 'the same painting, alive');
  assert.equal(G.reveal, 0);
  for (const k of G.bricks) k.alive = false;
  assert.ok(frames(G, 0.5, () => G.state === 'clear'), 'the living painting cleared');
  frames(G, 2.5);
  assert.equal(G.level, 3, 'it is on show too');
  assert.ok(frames(G, 5, () => G.level === 4), 'and then the boss');
  assert.ok(!G.lv.art, 'which is not a painting');
});

test('level 3 brings the same painting to life: its heads, made of bricks, spin or nod, the rest stands still', () => {
  for (const seed of [1, 7, 42]) {
    const where = `seed ${seed}`;
    const { AK, G } = level(seed, 3), still = level(seed, 2).G.lv.art, a = G.lv.art, P = AK.P;
    assert.equal(G.lv.gen, 'artLive', where);
    assert.deepEqual([a.id, a.x, a.y, a.w, a.h], [still.id, still.x, still.y, still.w, still.h], where + ': the same painting in the same place');
    const grp = grpOf(G);
    followsPainting(AK, G, where, k => grp(k));
    assert.equal(a.heads.length, AK.Art.get(a.id).heads.length, where + ': every head of the painting is alive');
    const groups = a.heads.map((hd, i) => G.bricks.filter(k => grp(k) === 'head' + i));
    groups.forEach((ks, i) => assert.ok(ks.length >= 6, `${where}: head ${i} is ${ks.length} bricks`));
    assert.ok(G.bricks.filter(k => !grp(k)).every(k => !k.motion), where + ': the rest of the wall stands still');
    const spin = a.heads.filter(hd => hd.m.w !== 0), nod = a.heads.filter(hd => hd.m.w === 0 && hd.m.amp > 0);
    assert.ok(spin.length >= 8 && nod.length >= 4, `${where}: ${spin.length} heads spin, ${nod.length} nod`);
    assert.ok(new Set(spin.map(hd => Math.sign(hd.m.w))).size === 2, where + ': heads spin both ways');

    // Through the level each head turns as one, around its own centre or a point of its stem, by the angle the
    // canvas under it turns (draw.js turns the canvas by P.turn of the head's motion)
    const home = groups.map(ks => ks.map(k => [k.x, k.y, k.ang]));
    const t0 = G.levelTime;
    frames(G, 3);
    a.heads.forEach((hd, i) => {
      const d = P.turn(hd.m, G.levelTime) - P.turn(hd.m, t0), c = Math.cos(d), s = Math.sin(d), px = hd.m.cx, py = hd.m.cy;
      if (hd.m.w === 0) assert.ok(Math.abs(P.turn(hd.m, G.levelTime)) <= hd.m.amp + 1e-9 && hd.m.amp < 0.1, `${where}: head ${i} only nods`);
      else assert.ok(Math.abs(d) > 1, `${where}: head ${i} has turned by ${d.toFixed(2)}`);
      groups[i].forEach((k, j) => {
        const [x, y, ang] = home[i][j];
        const ex = px + (x - px) * c - (y - py) * s, ey = py + (x - px) * s + (y - py) * c;
        assert.ok(Math.hypot(k.x - ex, k.y - ey) < 1e-6 && Math.abs(k.ang - ang - d) < 1e-9, `${where}: brick ${j} of head ${i} turns with the head`);
      });
    });
  }
});

test('the sunflowers of the living painting are bright, warm and not all alike', () => {
  for (const seed of [1, 7]) {
    const where = `seed ${seed}`;
    const { G } = level(seed, 3), grp = grpOf(G), heads = G.bricks.filter(k => grp(k));
    for (const k of heads) {
      const [r, g, b] = k.color;
      assert.ok(Math.max(r, g) >= 0.45 && r >= b + 0.2, `${where}: a ${grp(k)} brick is ${k.color.map(v => v.toFixed(2))}, not bright and warm`);
      assert.ok(k.glow > 0, `${where}: heads glow a little by themselves`);
    }
    const looks = new Set(G.lv.art.heads.map(hd => hd.look));
    assert.ok(looks.size >= 4, `${where}: ${[...looks]}`);
    // the wall's bricks are lit, not glowing
    assert.ok(G.bricks.filter(k => !grp(k)).every(k => !k.glow), where);
  }
});

test('the heads of the living painting never run into each other or into the rest of the wall', () => {
  for (const seed of [3, 11]) {
    const where = `seed ${seed}`;
    const { AK, G } = level(seed, 3), a = G.lv.art, P = AK.P;
    // the circles the heads sweep are apart, so the generator had nothing to throw away
    for (let i = 0; i < a.heads.length; i++) {
      for (let j = i + 1; j < a.heads.length; j++) {
        const p = a.heads[i], q = a.heads[j];
        assert.ok(Math.hypot(p.cx - q.cx, p.cy - q.cy) >= p.sweep + q.sweep, `${where}: heads ${i} and ${j} are apart`);
      }
    }
    // and the bricks are: half a minute of the level, every 0.05 s. Pairs that might meet are found once: a brick
    // of a spinning head stays in a ring around its axis, one of a nodding head — near where it started.
    const grp = grpOf(G), moving = G.bricks.filter(k => k.motion), pairs = [];
    assert.ok(moving.length > 100, `${where}: ${moving.length} bricks move`);
    const reach = k => {
      const m = k.motion;
      if (!m) return { x: k.x, y: k.y, r0: 0, r1: k.rad };
      if (m.w === 0) return { x: k.x, y: k.y, r0: 0, r1: k.rad + m.r * m.amp };
      return { x: m.cx, y: m.cy, r0: Math.max(0, m.r - k.rad), r1: m.r + k.rad };
    };
    for (const m of moving) {
      const rm = reach(m);
      for (const k of G.bricks) {
        if (k === m || grp(k) === grp(m) || (k.motion && moving.indexOf(k) < moving.indexOf(m))) continue;
        const rk = reach(k), d = Math.hypot(rk.x - rm.x, rk.y - rm.y);
        if (d - rk.r1 < rm.r1 && d + rk.r1 > rm.r0 && d - rm.r1 < rk.r1 && d + rm.r1 > rk.r0) pairs.push([m, k]);
      }
    }
    assert.ok(pairs.length > 0, `${where}: nothing to check`);
    const wa = new Float32Array(64), wb = new Float32Array(64), oa = {}, ob = {};
    const at = (k, t, o) => k.motion ? P.pose(k.motion, k.bx, k.by, k.bang, t, o) : k;
    for (let t = 0; t < 30; t += 0.05) {
      for (const [m, k] of pairs) {
        const pm = at(m, t, oa), pk = at(k, t, ob);
        if (Math.hypot(pm.x - pk.x, pm.y - pk.y) >= m.rad + k.rad) continue;
        const vm = P.transform(m.local, pm.x, pm.y, pm.ang, wa.subarray(0, m.local.length));
        const vk = k.motion ? P.transform(k.local, pk.x, pk.y, pk.ang, wb.subarray(0, k.local.length)) : k.world;
        if (P.overlap(vm, vk, 0)) assert.fail(`${where}: ${grp(m)} runs into ${grp(k) || 'the wall'} at ${t.toFixed(2)} s`);
      }
    }
  }
});
