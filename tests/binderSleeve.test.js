import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleSleeveHeight } from '../src/components/binder/sleeveGeometry.js';
import { getPageStackLayout } from '../src/components/binder/pageGeometry.js';

const seeds = [-12, -1, 0, 1, 2, 8, 18, 107];

test('pocket welds stay attached while the upper opening and lip remain free', () => {
  for (const seed of seeds) {
    for (let step = 0; step <= 64; step++) {
      const t = step / 64;
      assert.equal(sampleSleeveHeight(0, t, seed), 0);
      assert.equal(sampleSleeveHeight(1, t, seed), 0);
      assert.equal(sampleSleeveHeight(t, 0, seed), 0);
      assert.equal(sampleSleeveHeight(0, t, seed, true), 0);
      assert.equal(sampleSleeveHeight(1, t, seed, true), 0);
    }
    assert.ok(sampleSleeveHeight(0.5, 1, seed) > 0.1, 'upper pocket opening is sealed shut');
    assert.ok(sampleSleeveHeight(0.5, 1, seed, true) > 0.4, 'free lip has no visible lift');
    assert.ok(sampleSleeveHeight(0.5, 0.75, seed, true) > sampleSleeveHeight(0.5, 1, seed, true), 'lip does not curl back at its free edge');
  }
});

test('sculpted film stays within adaptive stack clearance for large and small binders', () => {
  for (const count of [1, 3, 20, 250, 5000]) {
    const { step, surface, bulge, lipRise } = getPageStackLayout(count);
    for (const seed of seeds) {
      for (const lip of [false, true]) {
        for (let row = 0; row <= 36; row++) for (let col = 0; col <= 32; col++) {
          const height = sampleSleeveHeight(col / 32, row / 36, seed, lip);
          assert.ok(Number.isFinite(height) && height >= 0 && height <= 1, `invalid film displacement: ${height}`);
          const occupiedHalfThickness = surface + height * (lip ? lipRise : bulge);
          assert.ok(occupiedHalfThickness <= step * 0.42 + 1e-12, 'film consumes neighboring page clearance');
        }
      }
    }
  }
});

test('pockets have distinct asymmetric stress fields without coarse mesh creases', () => {
  for (const lip of [false, true]) {
    const fields = [];
    for (let seed = 0; seed < 18; seed++) {
      const field = [];
      let asymmetry = 0;
      for (let row = 0; row <= 18; row++) for (let col = 0; col <= 16; col++) {
        const u = col / 16, v = row / 18;
        const height = sampleSleeveHeight(u, v, seed, lip);
        field.push(height);
        asymmetry += Math.abs(height - sampleSleeveHeight(1 - u, v, seed, lip));
        if (col > 0 && col < 16) {
          const curvature = sampleSleeveHeight(u - 1 / 16, v, seed, lip)
            - 2 * height + sampleSleeveHeight(u + 1 / 16, v, seed, lip);
          assert.ok(Math.abs(curvature) < 0.065, 'film has an abrupt lateral crease');
        }
        if (row > 0 && row < 18) {
          const curvature = sampleSleeveHeight(u, v - 1 / 18, seed, lip)
            - 2 * height + sampleSleeveHeight(u, v + 1 / 18, seed, lip);
          assert.ok(Math.abs(curvature) < 0.065, 'film has an abrupt vertical crease');
        }
      }
      assert.ok(asymmetry / field.length > 0.001, 'pocket field is mirror-symmetric');
      fields.push(field);
    }
    for (let i = 1; i < fields.length; i++) {
      const difference = fields[i].reduce((sum, value, index) => sum + Math.abs(value - fields[i - 1][index]), 0);
      assert.ok(difference / fields[i].length > 0.005, 'different pocket seeds repeat the same field');
    }
  }
});
