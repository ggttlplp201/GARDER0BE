import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const CONCRETE_TILE = 3;
const FLOOR_TILE = 2.5;
const CEILING_TILE = 3;
let areaLightUniformsReady = false;

function checkAborted(signal) {
  if (signal?.aborted) throw new DOMException('Museum room creation was cancelled.', 'AbortError');
}

function canvas(size) {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  return element;
}

function textureFromCanvas(element, colorSpace, anisotropy) {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

// Keep the source's concrete markings, but separate surface color from height
// and roughness. Dark marks in a photograph are not millimeter-deep crevices.
function concreteMaps(image, { size, color, contrast, roughness, anisotropy, normalImage, roughnessImage }) {
  const source = canvas(size);
  const context = source.getContext('2d');
  if (image) context.drawImage(image, 0, 0, size, size);
  else {
    context.fillStyle = '#808080';
    context.fillRect(0, 0, size, size);
  }
  const pixels = context.getImageData(0, 0, size, size);
  const height = canvas(size);
  const heightContext = height.getContext('2d');
  const heightPixels = heightContext.createImageData(size, size);
  const rough = canvas(size);
  const roughContext = rough.getContext('2d');
  const roughPixels = roughContext.createImageData(size, size);
  const count = size * size;
  let mean = 0;
  for (let index = 0; index < pixels.data.length; index += 4) {
    mean += pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722;
  }
  mean /= count;
  for (let index = 0; index < pixels.data.length; index += 4) {
    const luminance = pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722;
    const detail = luminance - mean;
    for (let channel = 0; channel < 3; channel++) {
      pixels.data[index + channel] = color[channel] + detail * contrast;
      heightPixels.data[index + channel] = 128 + detail * 0.65;
      roughPixels.data[index + channel] = roughness + detail * 0.18;
    }
    heightPixels.data[index + 3] = 255;
    roughPixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  heightContext.putImageData(heightPixels, 0, 0);
  roughContext.putImageData(roughPixels, 0, 0);
  const maps = {
    map: textureFromCanvas(source, THREE.SRGBColorSpace, anisotropy),
    roughnessMap: textureFromCanvas(rough, THREE.NoColorSpace, anisotropy),
  };
  if (normalImage) {
    const normal = canvas(size);
    normal.getContext('2d').drawImage(normalImage, 0, 0, size, size);
    maps.normalMap = textureFromCanvas(normal, THREE.NoColorSpace, anisotropy);
  } else {
    maps.bumpMap = textureFromCanvas(height, THREE.NoColorSpace, anisotropy);
  }
  if (roughnessImage) {
    roughContext.drawImage(roughnessImage, 0, 0, size, size);
    maps.roughnessMap.needsUpdate = true;
  }
  return maps;
}

function ceilingTexture(size, anisotropy) {
  const source = canvas(size);
  const context = source.getContext('2d');
  // Individual luminous panels retain visible, non-emitting joints in HDR.
  const cell = size / 6;
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const value = 244 + ((x * 7 + y * 3) % 5);
      context.fillStyle = `rgb(${value}, ${value}, ${value - 2})`;
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  context.strokeStyle = '#535752';
  context.lineWidth = size / 250;
  for (let index = 0; index <= 6; index++) {
    const offset = index * cell;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, size);
    context.moveTo(0, offset);
    context.lineTo(size, offset);
    context.stroke();
  }
  return textureFromCanvas(source, THREE.SRGBColorSpace, anisotropy);
}

function stops(length, bothEnds = true) {
  const values = [0, length, length / 2];
  for (const distance of [0.025, 0.09, 0.25, 0.65]) {
    if (distance < length / 2) {
      values.push(length - distance);
      if (bothEnds) values.push(distance);
    }
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

// More vertices are placed at contacts, not along the length of the corridor.
// Even very large wardrobes therefore keep the same small geometry budget.
function surfaceGeometry(width, height, tile, shade, xStops = stops(width), yStops = stops(height)) {
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  for (const y of yStops) {
    for (const x of xStops) {
      positions.push(x - width / 2, y - height / 2, 0);
      uvs.push(x / tile, y / tile);
      const value = shade ? shade(x, y) : 1;
      colors.push(value, value, value);
    }
  }
  const columns = xStops.length;
  for (let row = 0; row < yStops.length - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function contact(distance, reach, strength) {
  return 1 - strength * Math.exp(-distance / reach);
}

function makeEnvironment(renderer, layout, ceilingMap) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#777d7d');
  const width = layout.wallX * 2;
  const height = layout.ceilY - layout.floorY;
  const depth = 18;
  const geometries = [];
  const materials = [];
  const addPlane = (w, h, position, rotation, color, map = null) => {
    const geometry = surfaceGeometry(w, h, CEILING_TILE, null, [0, w], [0, h]);
    const material = new THREE.MeshBasicMaterial({ color, map, toneMapped: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    scene.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    return material;
  };
  const centerY = (layout.ceilY + layout.floorY) / 2;
  addPlane(depth, height, [-layout.wallX, centerY, 0], [0, Math.PI / 2, 0], '#7c8282');
  addPlane(depth, height, [layout.wallX, centerY, 0], [0, -Math.PI / 2, 0], '#7c8282');
  addPlane(width, depth, [0, layout.floorY, 0], [-Math.PI / 2, 0, 0], '#777b7a');
  const emitter = addPlane(width, depth, [0, layout.ceilY, 0], [Math.PI / 2, 0, 0], '#ffffff', ceilingMap);
  emitter.color.setRGB(1.8, 1.8, 1.74, THREE.LinearSRGBColorSpace);
  addPlane(width, height, [0, centerY, -depth / 2], [0, 0, 0], '#777d7d');
  addPlane(width, height, [0, centerY, depth / 2], [0, Math.PI, 0], '#777d7d');
  const generator = new THREE.PMREMGenerator(renderer);
  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipLevel = renderer.getActiveMipmapLevel();
  const previousToneMapping = renderer.toneMapping;
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  try {
    return generator.fromScene(scene, 0.025, 0.025, 30, { size: layout.mobile ? 64 : 128 });
  } finally {
    // PMREM restores these on success; retain that guarantee if a device
    // rejects an environment framebuffer and we fall back to direct light.
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipLevel);
    renderer.toneMapping = previousToneMapping;
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXrEnabled;
    generator.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}

export async function createRoom({ layout, roomDepth, renderer, invalidate, signal }) {
  checkAborted(signal);
  if (!areaLightUniformsReady) {
    RectAreaLightUniformsLib.init();
    areaLightUniformsReady = true;
  }
  const loader = new THREE.ImageLoader();
  const images = await Promise.all(['wall', 'floor'].flatMap(surface => (
    ['albedo', 'normal', 'roughness'].map(map => loader.loadAsync(`/textures/museum/concrete-${surface}-${map}.jpg`).catch(() => null))
  )));
  // A filter, resize, or unmount can supersede the room while images load.
  // Do not touch the old renderer or allocate GPU resources after that point.
  checkAborted(signal);
  const anisotropy = Math.min(layout.mobile ? 2 : 4, renderer.capabilities.getMaxAnisotropy());
  const size = layout.mobile ? 512 : 1024;
  const wallMaps = concreteMaps(images[0], {
    size: layout.mobile ? 512 : 2048, color: [84, 84, 81], contrast: 0.85, roughness: 237, anisotropy,
    normalImage: images[1], roughnessImage: images[2],
  });
  const floorMaps = concreteMaps(images[3], {
    size, color: [70, 70, 67], contrast: 0.8, roughness: 222, anisotropy,
    normalImage: images[4], roughnessImage: images[5],
  });
  const ceilingMap = ceilingTexture(size, anisotropy);
  const textures = [...Object.values(wallMaps), ...Object.values(floorMaps), ceilingMap];
  const group = new THREE.Group();
  group.name = 'museum-room';
  const wallMaterial = new THREE.MeshStandardMaterial({
    ...wallMaps, roughness: 0.95, metalness: 0, bumpScale: 0.012,
    vertexColors: true, envMapIntensity: 0.2, normalScale: new THREE.Vector2(0.45, 0.45),
  });
  const floorMaterial = new THREE.MeshPhysicalMaterial({
    ...floorMaps, roughness: 0.64, metalness: 0, bumpScale: 0.006, specularIntensity: 0.6,
    vertexColors: true, envMapIntensity: 0.24, normalScale: new THREE.Vector2(0.2, 0.2),
  });
  // A directly visible emitter keeps its panel detail. RectAreaLight below
  // provides its illumination; an emissive-looking mesh alone cannot do that.
  const ceilingMaterial = new THREE.MeshBasicMaterial({
    map: ceilingMap, color: '#ffffff', toneMapped: false,
  });
  ceilingMaterial.color.setRGB(1.8, 1.8, 1.73, THREE.LinearSRGBColorSpace);
  const geometries = [];
  const addSurface = (name, geometry, material, position, rotation) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.receiveShadow = material !== ceilingMaterial;
    group.add(mesh);
    geometries.push(geometry);
    return mesh;
  };
  const width = layout.wallX * 2;
  const height = layout.ceilY - layout.floorY;
  const centerY = (layout.ceilY + layout.floorY) / 2;
  // Tall viewports can see above/below the entrance plane. Continue the
  // architecture behind the camera, so the corridor always fills the view.
  const frontExtension = 5;
  const surfaceDepth = roomDepth + frontExtension;
  const centerZ = (frontExtension - roomDepth) / 2;

  for (const side of [-1, 1]) {
    const geometry = surfaceGeometry(surfaceDepth, height, CONCRETE_TILE, (x, y) => {
      const rearDistance = side === -1 ? surfaceDepth - x : x;
      return contact(y, 0.16, 0.2) * contact(rearDistance, 0.2, 0.14);
    });
    addSurface(side === -1 ? 'museum-left-wall' : 'museum-right-wall', geometry, wallMaterial,
      [side * layout.wallX, centerY, centerZ], [0, side * -Math.PI / 2, 0]);
  }
  const floorGeometry = surfaceGeometry(width, surfaceDepth, FLOOR_TILE, (x, y) => (
    contact(Math.min(x, width - x), 0.13, 0.24) * contact(surfaceDepth - y, 0.18, 0.2)
  ));
  addSurface('museum-floor', floorGeometry, floorMaterial,
    [0, layout.floorY, centerZ], [-Math.PI / 2, 0, 0]);
  const ceilingGeometry = surfaceGeometry(width, surfaceDepth, CEILING_TILE, null, [0, width], [0, surfaceDepth]);
  addSurface('museum-ceiling', ceilingGeometry, ceilingMaterial,
    [0, layout.ceilY, centerZ], [Math.PI / 2, 0, 0]);
  const rearGeometry = surfaceGeometry(width, height, CONCRETE_TILE, (x, y) => (
    contact(Math.min(x, width - x), 0.2, 0.14) * contact(y, 0.16, 0.2)
  ));
  addSurface('museum-back-wall', rearGeometry, wallMaterial,
    [0, centerY, -roomDepth], [0, 0, 0]);

  // One continuous area source matches the luminous ceiling, without point
  // lights or exhibit spot pools. RectAreaLight does not cast shadow maps;
  // the vertex contact shading is deliberately a restrained static adjunct.
  const ceilingLight = new THREE.RectAreaLight('#fffef9', 3.2, width * 0.98, surfaceDepth);
  ceilingLight.name = 'museum-ceiling-light';
  ceilingLight.position.set(0, layout.ceilY - 0.018, centerZ);
  ceilingLight.rotation.x = -Math.PI / 2;
  group.add(ceilingLight);
  // The diffuser's perimeter washes the top of the concrete, like the
  // concealed luminous edge in the architectural reference.
  for (const side of [-1, 1]) {
    const edgeLight = new THREE.RectAreaLight('#fff9eb', 2.2, surfaceDepth, 0.07);
    edgeLight.position.set(side * (layout.wallX - 0.08), layout.ceilY - 0.05, centerZ);
    edgeLight.rotation.y = -side * Math.PI / 2;
    group.add(edgeLight);
  }
  const fillLight = new THREE.HemisphereLight('#f6f7f5', '#858d8c', 0.3);
  fillLight.name = 'museum-bounce-fill';
  group.add(fillLight);

  let environmentTarget = null;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const geometry of geometries) geometry.dispose();
    wallMaterial.dispose();
    floorMaterial.dispose();
    ceilingMaterial.dispose();
    for (const texture of textures) texture.dispose();
    environmentTarget?.dispose();
    group.clear();
  }
  try {
    checkAborted(signal);
    environmentTarget = makeEnvironment(renderer, layout, ceilingMap);
    checkAborted(signal);
    wallMaterial.envMap = environmentTarget.texture;
    floorMaterial.envMap = environmentTarget.texture;
  } catch (error) {
    if (error.name === 'AbortError') {
      dispose();
      throw error;
    }
    console.warn('[Museum] Environment reflection setup failed.', error);
  }
  group.userData.materials = { wall: wallMaterial, floor: floorMaterial, ceiling: ceilingMaterial };
  group.userData.lighting = { ceiling: ceilingLight, fill: fillLight };
  invalidate?.();
  return {
    group,
    environment: environmentTarget?.texture || null,
    // Room lighting is anchored to the architecture, never to the viewer.
    updateCamera() {},
    dispose,
  };
}
