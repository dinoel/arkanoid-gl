'use strict';
// node --test tests/boss.test.cjs — bosses in a headless game (demo player, no audio, UI or water): assembly,
// bricks kept on the skeleton, flight and dives, damage from the ball, defeat.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { game, frames: run } = require('./headless.cjs');
const W = 720, WALL = 16, T = 72, PADDLE_Y = 900;
const LAP = [4, 8, 12, 16];            // serpent, jelly, manta, gorgon; the next lap is tougher
const LAP2 = LAP.map(l => l + 16);

function bossLevel(level, seed = 7) {
  const AK = game(level), G = AK.G;
  G.newGame(seed, true, level);
  assert.ok(G.boss, `level ${level} is a boss level`);
  return { AK, G, bs: G.boss, frames: (secs, each) => run(G, secs, each) };
}

// Every brick of the boss stands where the skeleton put it, and its collision polygon is right there too
function onSkeleton(AK, bs, where) {
  const buf = new Float32Array(64);
  for (const k of bs.parts) {
    if (!k.alive || k.ghost) continue;
    assert.ok(Number.isFinite(k.x + k.y + k.ang), `${where}: ${k.boss} brick pose is finite`);
    assert.ok(Math.abs(k.x - k.tx) < 1e-6 && Math.abs(k.y - k.ty) < 1e-6,
      `${where}: ${k.boss} brick at (${k.x.toFixed(1)}, ${k.y.toFixed(1)}), skeleton wants (${k.tx.toFixed(1)}, ${k.ty.toFixed(1)})`);
    const v = AK.P.transform(k.local, k.x, k.y, k.ang, buf.subarray(0, k.local.length));
    for (let i = 0; i < v.length; i++) assert.ok(Math.abs(v[i] - k.world[i]) < 1e-3, `${where}: ${k.boss} collision polygon follows the brick`);
  }
}

const hpOf = bs => bs.parts.reduce((s, k) => s + (k.alive && k.kind !== 'steel' ? Math.max(0, k.hp) : 0), 0);

test('every boss assembles from its bricks in the field', () => {
  for (const level of [...LAP, ...LAP2]) {
    const { AK, G, bs, frames } = bossLevel(level);
    frames(3);
    const where = `L${level} ${bs.name}`;
    assert.ok(bs.born, where + ' is assembled');
    assert.ok(bs.core.alive, where + ' heart is alive');
    const alive = bs.parts.filter(k => k.alive);
    assert.ok(alive.every(k => !k.ghost), where + ': every brick has landed');
    onSkeleton(AK, bs, where);
    const xs = alive.map(k => k.x), ys = alive.map(k => k.y);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    assert.ok(size > 100, `${where}: bricks spread over ${size.toFixed(0)} px, not piled up`);
    for (const k of alive) {
      assert.ok(k.x > WALL && k.x < W - WALL && k.y > T && k.y < PADDLE_Y, `${where}: ${k.boss} brick inside the field`);
    }
    assert.equal(G.bricks, bs.parts, where + ': the level is the boss');
  }
});

test('bosses keep their shape while they fly around and dive at the paddle', () => {
  for (const level of LAP) {
    const { AK, bs, frames } = bossLevel(level);
    frames(3);
    const where = `L${level} ${bs.name}`;
    const x0 = bs.core.x, y0 = bs.core.y;
    let moved = 0, dived = false, low = y0;
    frames(20, () => {
      if (bs.dying) return true;
      onSkeleton(AK, bs, where);
      moved = Math.max(moved, Math.hypot(bs.core.x - x0, bs.core.y - y0));
      if (bs.diving) dived = true;
      low = Math.max(low, bs.core.y);
      return dived && low - y0 > 80 && moved > 80;
    });
    assert.ok(moved > 80, `${where} flies around: moved ${moved.toFixed(0)} px`);
    assert.ok(dived, where + ' dives');
    assert.ok(low - y0 > 80, `${where} comes down in a dive: ${(low - y0).toFixed(0)} px`);
  }
});

test('the ball damages a boss', () => {
  for (const level of LAP) {
    const { G, bs, frames } = bossLevel(level);
    frames(3);
    const where = `L${level} ${bs.name}`;
    const hp0 = hpOf(bs);
    // from below at the heart and around it: whatever is hit first takes the damage
    let hit = false;
    for (const dx of [0, -40, 40, -80, 80]) {
      const b = G.balls[0];
      b.stuck = false; G.state = 'play';
      b.x = bs.core.x + dx; b.y = Math.min(bs.core.y + 110, PADDLE_Y - 80); b.vx = 0; b.vy = -650;
      if (frames(0.6, () => hpOf(bs) < hp0)) { hit = true; break; }
    }
    assert.ok(hit, `${where} loses health when the ball hits it`);
  }
});

test('a boss falls apart when its heart is destroyed and the level is cleared', () => {
  for (const level of LAP) {
    const { G, bs, frames } = bossLevel(level);
    frames(3);
    const where = `L${level} ${bs.name}`;
    bs.api.destroy(bs.core, true);
    assert.ok(frames(10, () => G.state === 'clear'), where + ': level cleared');
    assert.ok(bs.dying, where + ' is defeated');
    assert.ok(bs.parts.every(k => !k.alive || k.kind === 'steel'), where + ': every brick is gone');
  }
});
