'use strict';
// node --test tests/fish.test.cjs — the fish and the seaweed in a headless game with water. Two fish always live
// under the paddle and mind their own business: the side-view one (fish.js) and the top-down one (fish-top.js).
// The fish bonus turns one of them gold, at random, and then, while the paddle runs away from the ball, that fish
// catches the ball and spits it back up for as long as its time lasts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { game, frames } = require('./headless.cjs');

function level1(seed = 3) {
  const AK = game(seed, { water: true }), G = AK.G;
  G.newGame(seed, false, 1);
  return { AK, G };
}
// the capsule lands right on the paddle and is picked up on the next step
function giveFish(G) {
  const p = G.paddle;
  G.powerups.push({ type: 'fish', x: p.x, y: p.y, vx: 0, vy: 0, a: 0, t: 0 });
  frames(G, 1 / 60);
}
// the paddle keeps to the far side of the field from the ball and never hits it
function dodge(G) {
  const b = G.balls[0];
  if (b) G.input.x = b.x < 360 ? 690 : 30;
}
const KINDS = ['side', 'top'];
const kind = f => ('yaw' in f ? 'side' : 'top');
const fishOf = (G, k) => G.fishes.find(f => kind(f) === k);
const goldOf = G => G.fishes.filter(f => f.left > 0);

test('both fish are always there: they swim around under water, but without the bonus they do not catch the ball', () => {
  const { AK, G } = level1();
  assert.equal(G.fishes.map(kind).sort().join(), 'side,top', 'a new game has both fish');
  const fishes = G.fishes.slice();
  assert.ok(fishes.every(f => f.left === 0), 'with no help time');
  G.input.fire = true;
  const st = fishes.map(f => ({ modes: new Set(), x0: f.x, x1: f.x }));
  let lost = 0;
  frames(G, 40, () => {
    dodge(G);
    fishes.forEach((f, i) => {
      st[i].modes.add(f.mode);
      st[i].x0 = Math.min(st[i].x0, f.x); st[i].x1 = Math.max(st[i].x1, f.x);
      assert.ok(f.y > AK.Water.shoreAt(f.x) + 3, `the ${kind(f)} fish stays under water: y ${f.y.toFixed(1)}`);
      assert.ok(!f.hold, `the ${kind(f)} fish never catches the ball`);
    });
    if (G.lives < 3) { lost++; G.lives = 3; } // промах стоит жизни; возвращаем её, чтобы смотреть дальше
  });
  assert.ok(lost > 0, 'a missed ball costs a life');
  fishes.forEach((f, i) => {
    assert.ok(st[i].modes.size >= 3, `the ${kind(f)} fish keeps busy: ${[...st[i].modes].join(', ')}`);
    assert.ok(st[i].x1 - st[i].x0 > 150, `and swims around: ${(st[i].x1 - st[i].x0).toFixed(0)} px`);
  });
  assert.ok(G.fishes.length === 2 && fishes.every(f => G.fishes.includes(f)), 'the same fish are still there');
});

test('the bonus turns one fish gold, at random; more bonuses add time to it, up to 50 s', () => {
  const picked = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const { G } = level1(seed);
    giveFish(G);
    const gold = goldOf(G);
    assert.equal(gold.length, 1, 'one fish turns gold');
    assert.equal(gold[0].left, 25, 'for 25 seconds');
    picked.add(kind(gold[0]));
    giveFish(G);
    giveFish(G);
    assert.deepEqual(goldOf(G), gold, 'the same fish gets the time, the other stays silver');
    assert.equal(gold[0].left, 50, 'no more than 50 s');
  }
  assert.deepEqual([...picked].sort(), ['side', 'top'], 'either fish may be the one');
});

for (const k of KINDS) {
  test(`the gold ${k} fish catches a ball the paddle missed and spits it back up`, () => {
    const { G } = level1();
    const f = fishOf(G, k);
    f.add();
    G.input.fire = true;
    frames(G, 1.5);
    assert.ok(f.gold > 0.95, 'it has turned gold');
    let caught = false, saved = false;
    frames(G, 30, () => {
      dodge(G);
      if (f.hold) caught = true;
      // выплюнутый мяч проходит ракетку снизу и летит вверх
      saved = caught && !f.hold && G.balls.some(b => b.vy < 0 && b.y < G.paddle.y - 40);
      return saved;
    });
    assert.ok(caught, 'the fish catches the ball');
    assert.ok(saved, 'and spits it up past the paddle');
    assert.equal(G.lives, 3, 'no life lost');
    assert.ok(G.fishes.every(o => o === f || !o.hold), 'the silver fish leaves the ball alone');
  });

  test(`the gold ${k} fish saves the ball again and again until its time runs out, then turns silver again`, () => {
    const { G } = level1();
    const f = fishOf(G, k);
    f.add();
    G.input.fire = true;
    let saves = 0, holding = false;
    const done = frames(G, 60, () => {
      dodge(G);
      if (f.hold && !holding) saves++;
      holding = !!f.hold;
      return f.left <= 0 && !f.hold;
    });
    assert.ok(done, 'the time runs out');
    assert.ok(saves > 3, `it saved the ball ${saves} times`);
    assert.equal(G.lives, 3, 'and meanwhile no life was lost');
    frames(G, 2, () => { dodge(G); });
    assert.ok(f.gold < 0.05, 'the fish is silver again');
    assert.ok(frames(G, 30, () => { dodge(G); return G.lives < 3; }), 'without the bonus a miss costs a life');
  });
}

test('the time runs only while the ball is in play', () => {
  const { G } = level1();
  giveFish(G);
  const [f] = goldOf(G);
  frames(G, 2);
  assert.equal(G.state, 'serve');
  assert.equal(f.left, 25, 'the ball is still on the paddle');
  G.input.fire = true;
  frames(G, 2);
  assert.ok(Math.abs(f.left - 23) < 0.05, `two seconds of play: ${f.left.toFixed(2)} s left`);
});

test('the fish stay for the next level; a new game has plain fish', () => {
  const { G } = level1();
  giveFish(G);
  const [f] = goldOf(G), fishes = G.fishes.slice();
  G.skipLevel();
  assert.ok(G.fishes.every((o, i) => o === fishes[i]) && f.left === 25, 'the fish move on to the next level');
  G.newGame(5, false, 1);
  assert.ok(G.fishes.length === 2 && G.fishes.every(o => !fishes.includes(o) && o.left === 0),
    'a new game starts with new fish without the bonus');
});

// a shard of a broken brick falls from (x, y) straight down
function dropShard(G, x, y) {
  G.debris.push({
    local: [-4, -3, 4, -3, 4, 3, -4, 3], world: new Float32Array(8), x, y, vx: 0, vy: 320, a: 0, w: 2, r: 4, life: 3,
    color: [1, 0.5, 0.2], kind: 'normal', pts: 10, rest: 0, age: 0, caught: false, vol: 0.3,
  });
}

for (const k of KINDS) {
  test(`a shard splashing into the water next to the ${k} fish scares it away; the gold fish only flinches`, () => {
    const { AK, G } = level1();
    const f = fishOf(G, k), Wt = AK.Water;
    frames(G, 2);
    assert.ok(frames(G, 15, () => f.scare <= 0 && f.mode !== 'dart' && f.x > 160 && f.x < 560), 'the fish is calm');
    G.input.x = f.x < 360 ? 690 : 30; // ракетка в стороне — осколок её не заденет
    frames(G, 0.5);
    const sx = f.q[12];
    dropShard(G, sx, Wt.shoreAt(sx) - 15);
    let fled = false;
    frames(G, 0.5, () => (fled = f.mode === 'dart' && f.jolt > 0));
    assert.ok(fled, 'it darts away');
    frames(G, 1);
    assert.ok(Math.abs(f.x - sx) > 90, `and gets away from the splash: ${Math.abs(f.x - sx).toFixed(0)} px`);

    f.add();
    frames(G, 1.5);
    const gx = f.q[12];
    G.input.x = gx < 360 ? 690 : 30;
    frames(G, 0.3);
    dropShard(G, f.q[12], Wt.shoreAt(f.q[12]) - 15);
    let flinched = false;
    frames(G, 0.5, () => (flinched = f.jolt > 0.5));
    assert.ok(flinched, 'the gold fish flinches');
    assert.equal(f.mode, null, 'but does not leave its post');
  });
}

test('seaweed grows from the bottom, stays under water and rises with it', () => {
  const { AK, G } = level1();
  const Sb = AK.Seabed, Wt = AK.Water;
  assert.ok(Sb.fronds.length >= 10, `a garden is planted: ${Sb.fronds.length} plants`);
  const tall = () => Math.max(...Sb.fronds.map(fr => fr.y0 - Math.min(...fr.p.filter((_, i) => i % 2))));
  G.input.fire = true;
  frames(G, 3, () => { dodge(G); });
  const h0 = tall();
  Wt.levelT = 760; // вода поднимается, как от упавших осколков
  frames(G, 12, () => {
    dodge(G);
    for (const fr of Sb.fronds) {
      assert.ok(Math.abs(fr.p[0] - fr.x0) < 1e-3 && Math.abs(fr.p[1] - fr.y0) < 1e-3, 'the root stays put');
      for (let j = 1; j < fr.n; j++) {
        const x = fr.p[j * 2], y = fr.p[j * 2 + 1];
        assert.ok(Number.isFinite(x + y), 'nodes are finite');
        assert.ok(y >= Wt.shoreAt(x) + 2.9, `seaweed stays under water: ${y.toFixed(1)}`);
      }
    }
  });
  assert.ok(tall() > h0 + 40, `seaweed rises with the water: ${h0.toFixed(0)} → ${tall().toFixed(0)} px`);
  G.skipLevel();
  assert.ok(Sb.fronds.every(fr => fr.gen === Sb.fronds[0].gen), 'the next level plants a new garden');
});
