/**
 * An inextensible portfolio leaf. X is distance from the binding; Y runs along it.
 * Integrating a unit tangent preserves sheet length instead of stretching a
 * rotated plane. Card columns remain planar; bending lives in the empty gutters.
 */
export const PAGE_WIDTH = 2.78;
export const PAGE_HEIGHT = 3.9;
export const CARD_COLUMNS = Object.freeze([
  Object.freeze([0.18, 0.96]),
  Object.freeze([1.06, 1.84]),
  Object.freeze([1.94, 2.72]),
]);

const FLEX_REGIONS = [
  [0, 0.18, 0.48],
  [0.96, 1.06, 0.22],
  [1.84, 1.94, 0.22],
  [2.72, PAGE_WIDTH, 0.08],
];
const BREAKS = [0, 0.18, 0.96, 1.06, 1.84, 1.94, 2.72, PAGE_WIDTH];
// Eight-point Gauss-Legendre quadrature is stable across the narrow gutters.
const QUADRATURE = [
  [-0.9602898564975363, 0.1012285362903763],
  [-0.7966664774136267, 0.2223810344533745],
  [-0.525532409916329, 0.3137066458778873],
  [-0.1834346424956498, 0.362683783378362],
  [0.1834346424956498, 0.362683783378362],
  [0.525532409916329, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745],
  [0.9602898564975363, 0.1012285362903763],
];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Shared dimensions keep even very large collections physically separated. */
export function getPageStackLayout(total, spread = 0) {
  const count = Math.max(1, Math.floor(total));
  const index = clamp(spread, 0, count - 1);
  const step = Math.min(0.04, 0.28 / (count + 1));
  const closed = 0.055 + (count + 1) * step;
  return {
    step,
    left: 0.055 + (index + 1) * step,
    right: 0.055 + (count - index) * step,
    closed,
    coverTop: closed + 0.12,
    surface: step * 0.3,
    bulge: Math.min(0.005, step * 0.1),
    lipRise: Math.min(0.006, step * 0.12),
    deckThickness: Math.min(0.012, step * 0.5),
  };
}

/**
 * Keep the hinge above the departure deck in the first half and the arrival
 * deck in the second. On either half, concavity of sin guarantees clearance
 * when the peak lift is at least half the height difference. Also use this for
 * the first sheet unfolding after the cover opens, and for its reverse path.
 */
export function pageTurnBaseZ(fromZ, toZ, progress, step) {
  const p = clamp(progress, 0, 1);
  if (p === 0) return fromZ;
  if (p === 1) return toZ;
  const lift = Math.max(0.12, Math.abs(toZ - fromZ) * 0.5 + step);
  return fromZ + (toZ - fromZ) * p + lift * Math.sin(Math.PI * p);
}
const smootherstep = (value) => value ** 3 * (value * (value * 6 - 15) + 10);

function flexAt(x) {
  let flex = 0;
  for (const [start, end, weight] of FLEX_REGIONS) {
    flex += weight * smootherstep(clamp((x - start) / (end - start), 0, 1));
  }
  return flex * 2 - 1;
}

function tangentAngle(x, progress) {
  // Bend reverses during settling, giving exact forward/backward symmetry.
  // Since 0.34 < 0.5, every interior angle is strictly between 0 and PI:
  // the surface rises monotonically away from the hinge and cannot fold over.
  return Math.PI * progress + 0.34 * Math.sin(2 * Math.PI * progress) * flexAt(x);
}

/**
 * Sample a leaf at an undeformed X coordinate in world units (not a UV).
 * baseZ is the leaf's neutral plane, above the stack plus half its thickness.
 * The same field must be used for the sleeve, welds, cards and reverse face.
 */
export function samplePage(x, y, progress, baseZ = 0) {
  const u = clamp(x, 0, PAGE_WIDTH);
  const p = clamp(progress, 0, 1);
  if (p === 0) return { x: u, y, z: baseZ, nx: 0, ny: 0, nz: 1 };
  if (p === 1) return { x: -u, y, z: baseZ, nx: 0, ny: 0, nz: -1 };
  if (p === 0.5) return { x: 0, y, z: baseZ + u, nx: -1, ny: 0, nz: 0 };

  let mappedX = 0;
  let height = 0;
  for (let i = 0; i < BREAKS.length - 1 && BREAKS[i] < u; i += 1) {
    const start = BREAKS[i];
    const end = Math.min(u, BREAKS[i + 1]);
    const mid = (start + end) * 0.5;
    const half = (end - start) * 0.5;
    if (i % 2 === 1) {
      const angle = tangentAngle(mid, p);
      mappedX += (end - start) * Math.cos(angle);
      height += (end - start) * Math.sin(angle);
    } else {
      for (const [node, weight] of QUADRATURE) {
        const angle = tangentAngle(mid + half * node, p);
        mappedX += half * weight * Math.cos(angle);
        height += half * weight * Math.sin(angle);
      }
    }
  }
  const angle = tangentAngle(u, p);
  return {
    x: mappedX,
    y,
    z: baseZ + height,
    nx: -Math.sin(angle),
    ny: 0,
    nz: Math.cos(angle),
  };
}

/**
 * Deform a BufferGeometry without importing Three.js. Create/translate geometry
 * into sheet-local XY first. Rest positions and normals are captured once;
 * repeated frames never feed an already-deformed position back into the solver.
 * Rest Z and surfaceOffset are measured along the moving sheet normal.
 */
export function applyPageDeformation(geometry, progress, baseZ = 0, surfaceOffset = 0) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  geometry.userData ??= {};
  const data = geometry.userData;
  data.pageRestPositions ??= Float32Array.from(positions.array);
  if (normals) data.pageRestNormals ??= Float32Array.from(normals.array);
  const rest = data.pageRestPositions;
  const restNormals = data.pageRestNormals;
  const samples = new Map();

  for (let i = 0; i < positions.count; i += 1) {
    const index = i * 3;
    const x = rest[index];
    let point = samples.get(x);
    if (!point) {
      point = samplePage(x, 0, progress, baseZ);
      samples.set(x, point);
    }
    const offset = rest[index + 2] + surfaceOffset;
    positions.setXYZ(i, point.x + point.nx * offset, rest[index + 1], point.z + point.nz * offset);
    if (normals && restNormals) {
      const nx = restNormals[index];
      const ny = restNormals[index + 1];
      const nz = restNormals[index + 2];
      normals.setXYZ(i, nx * point.nz + nz * point.nx, ny, -nx * point.nx + nz * point.nz);
    }
  }
  positions.needsUpdate = true;
  if (normals) normals.needsUpdate = true;
  geometry.computeBoundingSphere?.();
  return geometry;
}
