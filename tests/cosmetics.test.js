import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COSMETICS, FRAMES, NAME_EFFECTS, CATALOG_IDS } from '../src/lib/cosmetics.js';

const EXPECTED = {
  thin_line: ['frame', 0, 0], dashed_ring: ['frame', 150, 0],
  ice_crystal: ['frame', 450, 5], crimson_flame: ['frame', 650, 5],
  gold_laurel: ['frame', 800, 10], onyx_halo: ['frame', 950, 10],
  royal_crown: ['frame', 1300, 15], angel_wings: ['frame', 1500, 20],
  silver_shine: ['name_effect', 300, 0], gold_shine: ['name_effect', 500, 8],
  rainbow_shine: ['name_effect', 900, 12],
};

test('every catalog id has matching def (parity with cosmetic_defs seed)', () => {
  for (const [id, [type, price, min]] of Object.entries(EXPECTED)) {
    const c = COSMETICS[id];
    assert.ok(c, `missing ${id}`);
    assert.equal(c.type, type);
    assert.equal(c.price, price);
    assert.equal(c.minLevel, min);
  }
  assert.deepEqual([...CATALOG_IDS].sort(), Object.keys(EXPECTED).sort());
});

test('frames render, effects have a class', () => {
  for (const f of FRAMES) assert.equal(typeof f.renderFrame, 'function');
  for (const e of NAME_EFFECTS) assert.equal(typeof e.nameEffectClass, 'string');
});
