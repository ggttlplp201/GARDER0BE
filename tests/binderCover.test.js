import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpineGeometry, updateSpineGeometry, BACK_COVER_Z, COVER_JOIN, COVER_HALF_THICKNESS } from '../src/components/binder/coverGeometry.js';

function nearestCrossSectionVertex(geometry, point) {
  const positions = geometry.getAttribute('position');
  let distance = Infinity;
  for (let i = 0; i < positions.count; i++) {
    distance = Math.min(distance, Math.hypot(positions.getX(i) - point.x, positions.getZ(i) - point.z));
  }
  return distance;
}

test('spine meets both cover skins throughout opening, including the closed top cover', () => {
  const geometry = createSpineGeometry(4.18);
  try {
    updateSpineGeometry(geometry, Math.PI, 0.335);
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.z >= 0.335 + COVER_HALF_THICKNESS - 1e-6, 'closed spine stops below front cover');
    for (const coverTop of [0.255, 0.335, 0.455]) {
      for (let frame = 0; frame <= 40; frame++) {
        const angle = Math.PI * frame / 40;
        updateSpineGeometry(geometry, angle, coverTop);
        const pivotZ = (coverTop + BACK_COVER_Z) / 2;
        const offsetZ = -(coverTop - BACK_COVER_Z) / 2;
        for (const skin of [-COVER_HALF_THICKNESS, COVER_HALF_THICKNESS]) {
          const rear = { x: COVER_JOIN, z: BACK_COVER_Z + skin };
          const front = {
            x: -COVER_JOIN * Math.cos(angle) + (offsetZ + skin) * Math.sin(angle),
            z: pivotZ + COVER_JOIN * Math.sin(angle) + (offsetZ + skin) * Math.cos(angle),
          };
          assert.ok(nearestCrossSectionVertex(geometry, rear) < 1e-6, 'rear leather seam has a gap');
          assert.ok(nearestCrossSectionVertex(geometry, front) < 1e-6, `front leather seam has a gap at angle ${angle}, height ${coverTop}`);
        }
      }
    }
  } finally { geometry.dispose(); }
});

test('spine shell has sealed top and bottom caps with no open mesh boundaries', () => {
  const geometry = createSpineGeometry(4.18);
  try {
    for (const angle of [0, 0.1, Math.PI / 2, Math.PI - 0.1, Math.PI]) {
      updateSpineGeometry(geometry, angle, 0.335);
      const positions = geometry.getAttribute('position');
      const index = geometry.index.array;
      const key = i => [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => v.toFixed(6)).join(',');
      const edges = new Map();
      for (let i = 0; i < index.length; i += 3) {
        const triangle = [index[i], index[i + 1], index[i + 2]].map(key);
        assert.equal(new Set(triangle).size, 3, 'collapsed triangle in spine shell');
        for (let edge = 0; edge < 3; edge++) {
          const pair = [triangle[edge], triangle[(edge + 1) % 3]].sort().join('|');
          edges.set(pair, (edges.get(pair) || 0) + 1);
        }
      }
      assert.ok([...edges.values()].every(count => count === 2), `open spine boundary at angle ${angle}`);
      for (const value of geometry.getAttribute('normal').array) assert.ok(Number.isFinite(value));
    }
  } finally { geometry.dispose(); }
});
