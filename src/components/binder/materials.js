import * as THREE from 'three';

const TAU = Math.PI * 2;

function randomAt(x, y, seed = 0) {
  let value = Math.imul(x ^ (seed * 374761393), 668265263) ^ Math.imul(y, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(min, max, value) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return t * t * (3 - 2 * t);
}

function canvasImage(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  return { canvas, context, image: context.createImageData(width, height) };
}

function pixel(image, index, red, green = red, blue = red) {
  const offset = index * 4;
  image.data[offset] = red;
  image.data[offset + 1] = green;
  image.data[offset + 2] = blue;
  image.data[offset + 3] = 255;
}

/** Generate tangent-space normals, including wrapped derivatives at tile borders. */
function normalImage(heights, width, height, strength) {
  const output = canvasImage(width, height);
  for (let y = 0; y < height; y += 1) {
    const above = ((y + height - 1) % height) * width;
    const below = ((y + 1) % height) * width;
    for (let x = 0; x < width; x += 1) {
      const left = y * width + (x + width - 1) % width;
      const right = y * width + (x + 1) % width;
      const dx = (heights[left] - heights[right]) * strength;
      const dy = (heights[below + x] - heights[above + x]) * strength;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      pixel(output.image, y * width + x,
        (dx * inverseLength * 0.5 + 0.5) * 255,
        (dy * inverseLength * 0.5 + 0.5) * 255,
        (inverseLength * 0.5 + 0.5) * 255);
    }
  }
  return output;
}

function leatherImages() {
  // One tile spans a cover, so the grain stays small at portfolio scale.
  const width = 768;
  const height = 1024;
  const columns = 96;
  const rows = 136;
  const albedo = canvasImage(width, height);
  const roughness = canvasImage(width, height);
  const heights = new Float32Array(width * height);
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    return [0.12 + randomAt(x, y, 1) * 0.76, 0.12 + randomAt(x, y, 2) * 0.76, randomAt(x, y, 3)];
  });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      // Domain warping breaks up the regularity of a plain cellular pattern.
      const px = u * columns + 0.22 * Math.sin(v * TAU * 7 + Math.sin(u * TAU * 4));
      const py = v * rows + 0.19 * Math.sin(u * TAU * 9 + Math.cos(v * TAU * 5));
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      let first = Infinity;
      let second = Infinity;
      let cellShade = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const cx = ix + ox;
          const cy = iy + oy;
          const cell = cells[((cy + rows) % rows) * columns + (cx + columns) % columns];
          const dx = (cx + cell[0] - px) * 1.06;
          const dy = cy + cell[1] - py;
          const distance = dx * dx + dy * dy;
          if (distance < first) {
            second = first;
            first = distance;
            cellShade = cell[2];
          } else if (distance < second) {
            second = distance;
          }
        }
      }
      const border = Math.sqrt(second) - Math.sqrt(first);
      const pebble = smoothstep(0.012, 0.27, border);
      const grain = randomAt(x, y, 4) - 0.5;
      const pores = randomAt(x >> 1, y >> 1, 5) - 0.5;
      const index = y * width + x;
      heights[index] = pebble * (0.72 + cellShade * 0.16) + grain * 0.045 + pores * 0.055;
      const color = 19 + cellShade * 2.2 + pebble * 0.8 + grain * 0.8;
      pixel(albedo.image, index, color, color + 0.4, color + 0.6);
      pixel(roughness.image, index, 230 + (1 - pebble) * 14 + pores * 6 - cellShade * 4);
    }
  }
  return { albedo, roughness, normal: normalImage(heights, width, height, 2.2) };
}

function sleeveImages() {
  const width = 512;
  const height = 512;
  const heights = new Float32Array(width * height);
  const roughness = canvasImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const index = y * width + x;
      const grain = randomAt(x, y, 12) - 0.5;
      const wrinkle = Math.sin(u * TAU * 2 + Math.sin(v * TAU) * 0.7) * 0.14
        + Math.sin((u * 3 + v * 2) * TAU + Math.sin(v * TAU * 3) * 0.4) * 0.025;
      // Sparse, fine polishing marks interrupt reflections without frosting the film.
      const scratch = Math.pow(Math.max(0, Math.sin(u * TAU * 113 + Math.sin(v * TAU * 2) * 2)), 30)
        * Math.pow(Math.max(0, Math.sin(v * TAU * 3 + 1)), 6);
      heights[index] = wrinkle + grain * 0.0015 + scratch * 0.012;
      pixel(roughness.image, index, 192 + wrinkle * 14 + grain * 6 + scratch * 24);
    }
  }
  return { normal: normalImage(heights, width, height, 5.5), roughness };
}

function weldImages() {
  const width = 64, height = 64;
  const heights = new Float32Array(width * height);
  const roughness = canvasImage(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const ridge = Math.sin(Math.PI * u) ** 2;
    const impression = smoothstep(0.08, 0.22, v) * (1 - smoothstep(0.65, 0.86, v));
    heights[y * width + x] = ridge * (0.25 + impression * 0.35);
    pixel(roughness.image, y * width + x, 220 - ridge * impression * 50);
  }
  return { normal: normalImage(heights, width, height, 1.6), roughness };
}

function liningImage() {
  const output = canvasImage(256, 256);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const fiber = randomAt(x, y, 23) * 8 + randomAt(x >> 1, y, 24) * 5;
      pixel(output.image, y * 256 + x, 31 + fiber, 32 + fiber, 33 + fiber);
    }
  }
  return output;
}

/** Broad photographic softboxes give clear film a readable, restrained reflection. */
function filmEnvironment(renderer) {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color('#242629');
  const geometry = new THREE.PlaneGeometry(1, 1);
  const panels = [
    { position: [3.1, 3, 6], size: [3.2, 9], intensity: 3.5, roll: -0.25 },
    { position: [-4.5, 1, 4], size: [1.1, 7], intensity: 1.7, roll: 0.2 },
    { position: [0, -5, 3], size: [7, 2], intensity: 0.65, roll: 0 },
  ].map(({ position, size, intensity, roll }) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(intensity), side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(...position);
    panel.scale.set(size[0], size[1], 1);
    panel.lookAt(0, 0, 0);
    panel.rotateZ(roll);
    studio.add(panel);
    return panel;
  });
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(studio, 0.025);
  generator.dispose();
  geometry.dispose();
  panels.forEach(panel => panel.material.dispose());
  return environment;
}

/** All maps are generated locally; dispose once the scene has stopped rendering. */
export function createBinderMaterials(renderer) {
  const textures = [];
  const canvases = [];
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function texture(source, color = false, repeat = 1) {
    source.context.putImageData(source.image, 0, 0);
    const map = new THREE.CanvasTexture(source.canvas);
    map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(repeat, repeat);
    map.anisotropy = anisotropy;
    textures.push(map);
    canvases.push(source.canvas);
    return map;
  }

  const leatherMaps = leatherImages();
  const leatherNormal = texture(leatherMaps.normal);
  const plasticMaps = sleeveImages();
  const plasticNormal = texture(plasticMaps.normal);
  const plasticRoughness = texture(plasticMaps.roughness);
  const filmLighting = filmEnvironment(renderer);
  const weldMaps = weldImages();
  const materials = {
    leather: new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: texture(leatherMaps.albedo, true),
      normalMap: leatherNormal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: texture(leatherMaps.roughness),
      roughness: 0.65,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
      sheen: 0.07,
      sheenColor: '#68665f',
      sheenRoughness: 0.85,
      specularIntensity: 0.45,
      envMapIntensity: 0.85,
    }),
    lining: new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: texture(liningImage(), true, 3),
      roughness: 0.94,
      metalness: 0,
      sheen: 0.28,
      sheenColor: '#565955',
      sheenRoughness: 0.92,
      specularIntensity: 0.3,
    }),
    edge: new THREE.MeshStandardMaterial({ color: '#171817', roughness: 0.78, metalness: 0 }),
    thread: new THREE.MeshStandardMaterial({ color: '#77736a', roughness: 0.88, metalness: 0 }),
    plastic: new THREE.MeshPhysicalMaterial({
      // Optical transmission keeps dielectric reflections at full strength.
      // Zero thickness models thin film instead of a solid glass slab.
      color: '#ffffff',
      transmission: 1,
      thickness: 0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      metalness: 0,
      roughness: 0.19,
      roughnessMap: plasticRoughness,
      normalMap: plasticNormal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      envMap: filmLighting.texture,
      clearcoat: 0,
      ior: 1.49,
      // Softer than full-strength film so pocket reflections don't wash the cards out.
      specularIntensity: 0.5,
      envMapIntensity: 0.55,
    }),
    weld: new THREE.MeshPhysicalMaterial({
      color: '#aab4b5',
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      metalness: 0,
      roughness: 0.46,
      normalMap: texture(weldMaps.normal),
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: texture(weldMaps.roughness),
      clearcoat: 0.15,
      clearcoatRoughness: 0.28,
      ior: 1.49,
    }),
    paper: new THREE.MeshStandardMaterial({ color: '#deded9', roughness: 0.84, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ color: '#c3c7cb', roughness: 0.22, metalness: 1, envMapIntensity: 1.05 }),
  };
  let disposed = false;
  return {
    ...materials,
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(materials).forEach(material => material.dispose());
      textures.forEach(map => map.dispose());
      filmLighting.dispose();
      canvases.forEach(canvas => {
        canvas.width = 1;
        canvas.height = 1;
      });
    },
  };
}
