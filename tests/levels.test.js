import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpToReach, getLevelState } from '../src/lib/levels.js';

test('xpToReach matches the curve (parity with SQL xp_to_reach)', () => {
  assert.equal(xpToReach(1), 0);
  assert.equal(xpToReach(2), 200);   // level 1→2 costs 200
  assert.equal(xpToReach(3), 500);   // 2→3 costs 300
  assert.equal(xpToReach(4), 900);   // 3→4 costs 400
  assert.equal(xpToReach(20), 50 * 20 * 21 - 100); // 20900
});

test('getLevelState at exact boundaries', () => {
  assert.deepEqual(getLevelState(0),   { level: 1, xpIntoLevel: 0, xpForNextLevel: 200, pct: 0 });
  assert.deepEqual(getLevelState(199), { level: 1, xpIntoLevel: 199, xpForNextLevel: 200, pct: 100 });
  assert.deepEqual(getLevelState(200), { level: 2, xpIntoLevel: 0, xpForNextLevel: 300, pct: 0 });
  assert.deepEqual(getLevelState(500), { level: 3, xpIntoLevel: 0, xpForNextLevel: 400, pct: 0 });
});

test('getLevelState mid-level', () => {
  const s = getLevelState(350); // level 2 spans 200..500
  assert.equal(s.level, 2);
  assert.equal(s.xpIntoLevel, 150);
  assert.equal(s.xpForNextLevel, 300);
  assert.equal(s.pct, 50);
});
