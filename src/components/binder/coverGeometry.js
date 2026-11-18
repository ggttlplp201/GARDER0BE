import { BufferGeometry, Float32BufferAttribute } from 'three';

export const BACK_COVER_Z = -0.074;
export const COVER_JOIN = 0.08;
export const COVER_HALF_THICKNESS = 0.06;
const SEGMENTS = 48;

// The same hinge transform drives the board and both ends of the leather spine.
export function getCoverHinge(coverTop) {
  return {
    pivotZ: (coverTop + BACK_COVER_Z) / 2,
    offsetZ: -(coverTop - BACK_COVER_Z) / 2,
  };
}

function spineSection(u, angle, coverTop) {
  const { pivotZ, offsetZ } = getCoverHinge(coverTop);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const ax = COVER_JOIN, az = BACK_COVER_Z;
  const bx = -COVER_JOIN * cos + offsetZ * sin;
  const bz = pivotZ + COVER_JOIN * sin + offsetZ * cos;
  const handle = 2 * COVER_JOIN / 3 + (coverTop - BACK_COVER_Z) * 0.5 * Math.sin(angle / 2);
  const c1x = ax - handle, c1z = az;
  const c2x = bx + handle * cos, c2z = bz - handle * sin;
  const v = 1 - u;
  const x = v ** 3 * ax + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u ** 3 * bx;
  const z = v ** 3 * az + 3 * v * v * u * c1z + 3 * v * u * u * c2z + u ** 3 * bz;
  const dx = 3 * v * v * (c1x - ax) + 6 * v * u * (c2x - c1x) + 3 * u * u * (bx - c2x);
  const dz = 3 * v * v * (c1z - az) + 6 * v * u * (c2z - c1z) + 3 * u * u * (bz - c2z);
  const length = Math.hypot(dx, dz);
  return { x, z, nx: -dz / length, nz: dx / length };
}

export function createSpineGeometry(height) {
  const geometry = new BufferGeometry();
  const stripVertices = (SEGMENTS + 1) * 2;
  const count = stripVertices * 4 + 8;
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(count * 2), 2));
  const indices = [];
  // Outer leather, inner lining, upper cap, lower cap. Each strip has its
  // own vertices so the sealed cap edges keep a sharp, clean material seam.
  for (let strip = 0; strip < 4; strip++) {
    const start = indices.length;
    for (let i = 0; i < SEGMENTS; i++) {
      const a = strip * stripVertices + i * 2;
      indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    geometry.addGroup(start, indices.length - start, strip === 1 ? 1 : 0);
  }
  // These two ends overlap the boards, completing a closed solid shell.
  for (let end = 0; end < 2; end++) {
    const a = stripVertices * 4 + end * 4;
    const start = indices.length;
    if (end === 0) indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    else indices.push(a, a + 2, a + 1, a, a + 3, a + 2);
    geometry.addGroup(start, 6, 0);
  }
  geometry.setIndex(indices);
  geometry.userData.spineHeight = height - 0.08;
  updateSpineGeometry(geometry, 0, 0.335);
  return geometry;
}

export function updateSpineGeometry(geometry, angle, coverTop) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const halfHeight = geometry.userData.spineHeight / 2;
  const stripVertices = (SEGMENTS + 1) * 2;
  let arc = 0;
  let previous;
  for (let i = 0; i <= SEGMENTS; i++) {
    const s = spineSection(i / SEGMENTS, angle, coverTop);
    if (previous) arc += Math.hypot(s.x - previous.x, s.z - previous.z);
    previous = s;
    const outer = [s.x + s.nx * COVER_HALF_THICKNESS, s.z + s.nz * COVER_HALF_THICKNESS];
    const inner = [s.x - s.nx * COVER_HALF_THICKNESS, s.z - s.nz * COVER_HALF_THICKNESS];
    const vertices = [
      [outer[0], -halfHeight, outer[1]], [outer[0], halfHeight, outer[1]],
      [inner[0], halfHeight, inner[1]], [inner[0], -halfHeight, inner[1]],
      [outer[0], halfHeight, outer[1]], [inner[0], halfHeight, inner[1]],
      [inner[0], -halfHeight, inner[1]], [outer[0], -halfHeight, outer[1]],
    ];
    for (let strip = 0; strip < 4; strip++) {
      for (let edge = 0; edge < 2; edge++) {
        const index = strip * stripVertices + i * 2 + edge;
        position.setXYZ(index, ...vertices[strip * 2 + edge]);
        uv.setXY(index, arc / 3.02, strip < 2 ? edge : edge * 0.12 / 4.18);
      }
    }
    if (i === 0 || i === SEGMENTS) {
      const start = stripVertices * 4 + (i === 0 ? 0 : 4);
      const ends = [vertices[0], vertices[1], vertices[2], vertices[3]];
      ends.forEach((point, index) => {
        position.setXYZ(start + index, ...point);
        uv.setXY(start + index, index < 2 ? 0 : 0.12 / 3.02, index === 0 || index === 3 ? 0 : 1);
      });
    }
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}
