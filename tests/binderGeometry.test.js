import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_WIDTH, PAGE_HEIGHT, CARD_COLUMNS, samplePage, applyPageDeformation,
  getPageStackLayout, pageTurnBaseZ,
} from '../src/components/binder/pageGeometry.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('portfolio leaf has exact flat endpoints and a continuous hinge', () => {
  for (let i = 0; i <= 40; i += 1) {
    const x = PAGE_WIDTH * i / 40;
    assert.deepEqual(samplePage(x, 0.7, 0, 0.12), { x, y: 0.7, z: 0.12, nx: 0, ny: 0, nz: 1 });
    assert.deepEqual(samplePage(x, 0.7, 1, 0.12), { x: -x, y: 0.7, z: 0.12, nx: 0, ny: 0, nz: -1 });
    const hinge = samplePage(0, -PAGE_HEIGHT / 2, i / 40, 0.12);
    close(hinge.x, 0);
    close(hinge.z, 0.12);
    close(hinge.y, -PAGE_HEIGHT / 2);
  }
});

test('every intermediate leaf clears its support plane and cannot self-intersect', () => {
  for (let frame = 1; frame < 100; frame += 1) {
    const p = frame / 100;
    let previousHeight = -Infinity;
    for (let point = 0; point <= 140; point += 1) {
      const sample = samplePage(PAGE_WIDTH * point / 140, 0, p, 0.21);
      for (const value of Object.values(sample)) assert.ok(Number.isFinite(value));
      assert.ok(sample.z >= 0.21 - 1e-12);
      // Strictly ordered height makes any cross-section self-intersection impossible.
      assert.ok(sample.z > previousHeight);
      previousHeight = sample.z;
      close(Math.hypot(sample.nx, sample.ny, sample.nz), 1);
      // All surfaces with thickness <= 0.02 clear a stack at z=0.20.
      assert.ok(sample.z - Math.abs(sample.nz) * 0.01 >= 0.20 - 1e-12);
    }
  }
});

test('forward and reverse turns share the same geometric path', () => {
  for (let frame = 0; frame <= 60; frame += 1) {
    for (let point = 0; point <= 30; point += 1) {
      const x = PAGE_WIDTH * point / 30;
      const first = samplePage(x, 0.5, frame / 60, 0.1);
      const second = samplePage(x, 0.5, 1 - frame / 60, 0.1);
      close(first.x, -second.x);
      close(first.z, second.z);
      close(first.nx, second.nx);
      close(first.nz, -second.nz);
    }
  }
});

test('cards remain planar and the leaf keeps its physical arc length', () => {
  for (const p of [0.03, 0.17, 0.37, 0.5, 0.71, 0.93]) {
    for (const [start, end] of CARD_COLUMNS) {
      const left = samplePage(start, 0, p);
      const right = samplePage(end, 0, p);
      const middle = samplePage((start + end) / 2, 0, p);
      close(middle.x, (left.x + right.x) / 2);
      close(middle.z, (left.z + right.z) / 2);
      close(left.nx, right.nx);
      close(left.nz, right.nz);
      close(Math.hypot(right.x - left.x, right.z - left.z), end - start);
    }
    let length = 0;
    let previous = samplePage(0, 0, p);
    for (let i = 1; i <= 1400; i += 1) {
      const point = samplePage(PAGE_WIDTH * i / 1400, 0, p);
      length += Math.hypot(point.x - previous.x, point.z - previous.z);
      previous = point;
    }
    close(length, PAGE_WIDTH, 2e-6);
  }
});

function attribute(values) {
  return {
    array: Float32Array.from(values), count: values.length / 3,
    setXYZ(index, x, y, z) { this.array.set([x, y, z], index * 3); },
  };
}

test('deformation reuses immutable rest data and keeps both skins separated', () => {
  const positions = attribute([0.2, -0.5, 0, 0.8, 0.5, 0]);
  const normals = attribute([0, 0, 1, 0, 0, 1]);
  const geometry = {
    userData: {}, getAttribute: (name) => name === 'position' ? positions : normals,
  };
  applyPageDeformation(geometry, 0.23, 0.1, 0.004);
  const firstPass = Array.from(positions.array);
  applyPageDeformation(geometry, 0.76, 0.1, 0.004);
  applyPageDeformation(geometry, 0.23, 0.1, 0.004);
  assert.deepEqual(Array.from(positions.array), firstPass);
  applyPageDeformation(geometry, 0.23, 0.1, -0.004);
  for (let i = 0; i < positions.count; i += 1) {
    const index = i * 3;
    const separation = Math.hypot(firstPass[index] - positions.array[index], firstPass[index + 2] - positions.array[index + 2]);
    close(separation, 0.008, 1e-7);
  }
  applyPageDeformation(geometry, 0, 0, 0);
  assert.deepEqual(Array.from(positions.array), Array.from(geometry.userData.pageRestPositions));
  assert.ok(positions.needsUpdate && normals.needsUpdate);
});


test('deck spacing contains both plastic skins for small and large collections', () => {
  for (const total of [1, 2, 4, 9, 20, 60, 200, 1000]) {
    const layout = getPageStackLayout(total);
    const skin = layout.surface + Math.max(layout.bulge, layout.lipRise);
    assert.ok(layout.step - 2 * skin > 0, `plastic collision at ${total} spreads`);
    assert.ok(layout.deckThickness < layout.step);
    assert.ok(layout.closed - skin > layout.right + skin);
    // Cover lining and stitches project at most 0.077 into the closed book.
    assert.ok(layout.coverTop - 0.077 > layout.closed + skin);
  }
});

function assertLeafClearsDecks(progress, baseZ, layout, leftDeck, rightDeck) {
  const skin = layout.surface + Math.max(layout.bulge, layout.lipRise);
  for (let i = 1; i <= 50; i += 1) {
    const x = PAGE_WIDTH * i / 50;
    const sample = samplePage(x, 0, progress, baseZ);
    // Backing spans the full sheet; pocket film starts after the binding margin.
    for (const offset of x < 0.15 ? [0] : [-skin, 0, skin]) {
      const px = sample.x + sample.nx * offset;
      const pz = sample.z + sample.nz * offset;
      if (Math.abs(px) < 1e-9) continue; // The common binding is outside either deck.
      const support = px < 0 ? leftDeck : rightDeck;
      assert.ok(pz > support + skin, `leaf clips deck: p=${progress}, x=${x}, z=${pz}, support=${support + skin}`);
    }
  }
}

test('forward and reverse page turns clear uneven stacks throughout the turn', () => {
  for (const total of [2, 4, 9, 20, 60, 200]) {
    for (const spread of new Set([0, Math.floor((total - 2) / 2), total - 2])) {
      const start = getPageStackLayout(total, spread);
      const end = getPageStackLayout(total, spread + 1);
      for (let frame = 0; frame <= 80; frame += 1) {
        const p = frame / 80;
        const forwardZ = pageTurnBaseZ(start.right, end.left, p, start.step);
        const reverseZ = pageTurnBaseZ(end.left, start.right, 1 - p, start.step);
        close(forwardZ, reverseZ);
        assertLeafClearsDecks(p, forwardZ, start, start.left, end.right);
      }
    }
  }
});

test('opening and closing the first sheet clears the stationary right deck', () => {
  for (const total of [1, 2, 9, 20, 60, 200]) {
    for (const spread of new Set([0, Math.floor((total - 1) / 2), total - 1])) {
      const layout = getPageStackLayout(total, spread);
      for (let frame = 0; frame <= 80; frame += 1) {
        const p = frame / 80;
        const baseZ = pageTurnBaseZ(layout.closed, layout.left, p, layout.step);
        // Left stack is stored beneath the unfolding sheet; right stack stays put.
        assertLeafClearsDecks(p, baseZ, layout, layout.left - layout.step, layout.right);
      }
    }
  }
});
