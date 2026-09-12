import * as THREE from 'three';

const PAPER = '#f5f4ef';
// Reduce the printed artwork by 0.6 stops without changing room illumination.
const ARTWORK_EXPOSURE = 2 ** -0.6;
const DISPLAY_FONT = '"Inter Tight", -apple-system, sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';
const IMAGE_RANGE = 18;
const RELEASE_RANGE = 24;
const CYCLE_RANGE = 7;
const CYCLE_DURATION = 2500;

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

function artworkBounds(width, height) {
  const margin = Math.round(width * 0.046);
  return {
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: Math.round(height * 0.79) - margin,
  };
}

function truncateText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length && context.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function titleLines(context, text, maxWidth) {
  const words = String(text).trim().split(/\s+/);
  const lines = [''];
  for (const word of words) {
    const last = lines.length - 1;
    const candidate = `${lines[last]}${lines[last] ? ' ' : ''}${word}`;
    if (last === 0 && lines[last] && context.measureText(candidate).width > maxWidth) {
      lines.push(word);
    } else {
      lines[last] = candidate;
    }
  }
  return lines.map(line => truncateText(context, line, maxWidth));
}

function paintArtwork(canvas, item, imageCanvas) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const bounds = artworkBounds(width, height);
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);

  if (imageCanvas) {
    context.drawImage(imageCanvas, bounds.x, bounds.y, bounds.width, bounds.height);
  } else {
    context.fillStyle = '#eeede8';
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    context.fillStyle = '#666860';
    context.font = `400 ${Math.round(width * 0.054)}px ${MONO_FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      truncateText(context, String(item.brand || 'GARDEROBE').toUpperCase(), bounds.width * 0.85),
      width / 2,
      bounds.y + bounds.height / 2,
    );
  }

  const labelTop = Math.round(height * 0.816);
  const labelX = Math.round(width * 0.062);
  const labelWidth = width - labelX * 2;
  context.fillStyle = '#cecec7';
  context.fillRect(labelX, labelTop, labelWidth, Math.max(1, width / 512));
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = '#696b64';
  context.font = `400 ${Math.round(width * 0.033)}px ${MONO_FONT}`;
  const category = [item.cat, item.brand].filter(Boolean).join(' · ');
  context.fillText(truncateText(context, `№ ${category}`, labelWidth), labelX, labelTop + height * 0.021);
  context.fillStyle = '#151715';
  const titleSize = Math.round(width * 0.053);
  context.font = `500 ${titleSize}px ${DISPLAY_FONT}`;
  titleLines(context, item.name || item.brand || 'Untitled', labelWidth).forEach((line, index) => {
    context.fillText(line, labelX, labelTop + height * 0.058 + index * titleSize * 1.17);
  });
}

function createShadowTexture() {
  const canvas = createCanvas(128, 192);
  const context = canvas.getContext('2d');
  context.shadowColor = 'rgba(0, 0, 0, 0.72)';
  context.shadowBlur = 10;
  context.fillStyle = 'rgba(0, 0, 0, 0.72)';
  context.fillRect(15, 15, 98, 162);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function railGeometry(points, thickness, bevel) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  points.slice(1).forEach(point => shape.lineTo(...point));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
}

/**
 * A wall-mounted physical frame. Distances use metres; cameraZ is the museum's
 * positive corridor travel coordinate and now is performance.now() in ms.
 */
export function createFrame({ item, side, depth, layout, renderer, invalidate = () => {} }) {
  const { wallX, frameCY, frameW: width, frameH: height, mobile } = layout;
  const group = new THREE.Group();
  group.name = `museum-frame-${item.id}`;
  const assembly = new THREE.Group();
  group.add(assembly);

  const railWidth = width * 0.055;
  const thickness = width * 0.044;
  const bevel = width * 0.0016;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const innerX = halfWidth - railWidth;
  const innerY = halfHeight - railWidth;
  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: '#0b0d0c', roughness: 0.7, metalness: 0.12, envMapIntensity: 0.2, specularIntensity: 0.3,
  });
  const backMaterial = new THREE.MeshStandardMaterial({
    color: '#080a09', roughness: 0.91, metalness: 0, envMapIntensity: 0.2,
  });
  const paperMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(PAPER).multiplyScalar(ARTWORK_EXPOSURE), roughness: 1, metalness: 0, specularIntensity: 0.05,
  });

  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness * 0.36), backMaterial);
  back.position.z = thickness * 0.2;
  back.castShadow = true;
  back.receiveShadow = true;
  assembly.add(back);

  const rails = [
    [[-halfWidth, halfHeight], [halfWidth, halfHeight], [innerX, innerY], [-innerX, innerY]],
    [[halfWidth, halfHeight], [halfWidth, -halfHeight], [innerX, -innerY], [innerX, innerY]],
    [[halfWidth, -halfHeight], [-halfWidth, -halfHeight], [-innerX, -innerY], [innerX, -innerY]],
    [[-halfWidth, -halfHeight], [-halfWidth, halfHeight], [-innerX, innerY], [-innerX, -innerY]],
  ];
  rails.forEach(points => {
    const rail = new THREE.Mesh(railGeometry(points, thickness, bevel), frameMaterial);
    rail.castShadow = true;
    rail.receiveShadow = true;
    assembly.add(rail);
  });

  // The thin black reveal between the rail and paper is an actual recess.
  const reveal = new THREE.Mesh(new THREE.PlaneGeometry(innerX * 2, innerY * 2), backMaterial);
  reveal.position.z = thickness * 0.58;
  reveal.receiveShadow = true;
  assembly.add(reveal);
  const paperWidth = innerX * 2 - width * 0.052;
  const paperHeight = innerY * 2 - width * 0.052;
  const pickTarget = new THREE.Mesh(new THREE.PlaneGeometry(paperWidth, paperHeight), paperMaterial);
  pickTarget.position.z = thickness * 0.66;
  pickTarget.receiveShadow = true;
  pickTarget.userData.itemId = item.id;
  assembly.add(pickTarget);

  const shadowTexture = createShadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    color: '#080b0b',
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.25, height * 1.18), shadowMaterial);
  shadow.rotation.y = -side * Math.PI / 2;
  shadow.position.set(side * (wallX - 0.004), frameCY - width * 0.018, -depth);
  group.add(shadow);

  const urls = [...new Set((item.imageUrls || []).filter(url => typeof url === 'string' && url))];
  let disposed = false;
  let texture = null;
  let canvas = null;
  let prefetched = null;
  let imageRequest = null;
  let prefetchRequest = null;
  let currentIndex = 0;
  let nextCycle = 0;
  let progress = 0;
  let currentResolution = 0;
  let generation = 0;
  // A deterministic offset keeps all frames from changing in one GPU upload.
  const cycleOffset = [...String(item.id || depth)].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0) % 1900;

  function abortRequest(request) {
    if (!request) return;
    request.onload = null;
    request.onerror = null;
    request.removeAttribute('src');
  }

  function clearImages() {
    generation += 1;
    abortRequest(imageRequest);
    abortRequest(prefetchRequest);
    imageRequest = null;
    prefetchRequest = null;
    releaseCanvas(prefetched?.canvas);
    prefetched = null;
    paperMaterial.map = null;
    paperMaterial.color.set(PAPER).multiplyScalar(ARTWORK_EXPOSURE);
    paperMaterial.needsUpdate = true;
    texture?.dispose();
    texture = null;
    releaseCanvas(canvas);
    canvas = null;
    currentResolution = 0;
  }

  function releaseImages() {
    if (!texture && !imageRequest && !prefetchRequest && !prefetched) return false;
    clearImages();
    nextCycle = 0;
    return true;
  }

  function applyImage(imageCanvas) {
    if (disposed || !canvas) return;
    paintArtwork(canvas, item, imageCanvas);
    texture.needsUpdate = true;
    invalidate();
  }

  function loadImage(index, prefetch = false) {
    if (!urls[index] || !canvas || disposed) return;
    const requestGeneration = generation;
    const requestedWidth = canvas.width;
    const requestedHeight = canvas.height;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    if (prefetch) prefetchRequest = image;
    else imageRequest = image;

    function finish(success) {
      if (disposed || requestGeneration !== generation) return;
      if (prefetch) prefetchRequest = null;
      else imageRequest = null;
      let artwork = null;
      if (success && image.naturalWidth && image.naturalHeight) {
        const bounds = artworkBounds(requestedWidth, requestedHeight);
        artwork = createCanvas(bounds.width, bounds.height);
        const context = artwork.getContext('2d');
        const scale = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
        const sourceWidth = bounds.width / scale;
        const sourceHeight = bounds.height / scale;
        try {
          context.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2,
            sourceWidth, sourceHeight, 0, 0, bounds.width, bounds.height);
          // A refused CORS image must never taint the WebGL upload canvas.
          context.getImageData(0, 0, 1, 1);
        } catch {
          releaseCanvas(artwork);
          artwork = null;
        }
      }
      abortRequest(image);
      if (prefetch) {
        releaseCanvas(prefetched?.canvas);
        prefetched = { index, canvas: artwork };
      } else {
        currentIndex = index;
        applyImage(artwork);
        releaseCanvas(artwork);
      }
    }

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = urls[index];
  }

  function ensureTexture(resolution) {
    if (currentResolution === resolution) return;
    clearImages();
    currentResolution = resolution;
    canvas = createCanvas(resolution, Math.round(resolution * paperHeight / paperWidth));
    paintArtwork(canvas, item, null);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.generateMipmaps = true;
    paperMaterial.color.setScalar(ARTWORK_EXPOSURE);
    paperMaterial.map = texture;
    paperMaterial.needsUpdate = true;
    loadImage(currentIndex);
  }

  function update({ cameraZ, hovered = false, delta = 0, reducedMotion = false, now = 0 }) {
    if (disposed) return false;
    const previousProgress = progress;
    const previousTexture = texture;
    const distance = Math.abs(depth - cameraZ);
    const target = mobile ? Math.max(0, 1 - distance / 1.6) : Number(hovered);
    const blend = reducedMotion ? 1 : 1 - Math.exp(-12 * Math.max(0, Math.min(delta, 0.1)));
    progress += (target - progress) * blend;
    if (Math.abs(target - progress) < 0.0001) progress = target;

    const turn = THREE.MathUtils.degToRad((mobile ? 62 : 60) * progress);
    const scale = 1 + (mobile ? 0.035 : 0.08) * progress;
    const separation = width * scale / 2 * Math.sin(turn) + (mobile ? 0.025 : 0.15) * progress;
    const lift = mobile ? 0 : 0.6 * progress;
    assembly.position.set(side * (wallX - 0.02 - separation), frameCY, -depth + lift);
    assembly.rotation.y = -side * (Math.PI / 2 - turn);
    assembly.scale.setScalar(scale);

    shadow.position.y = frameCY - width * 0.018 - separation * 0.14;
    shadow.position.z = -depth + lift;
    shadow.scale.set(Math.max(0.24, Math.cos(turn) * scale) + separation * 0.21, scale + separation * 0.12, 1);
    shadowMaterial.opacity = 0.36 / (1 + separation * 3.4);

    if (group.visible && distance < IMAGE_RANGE) {
      const resolution = !mobile && distance < 4.5 && renderer.getPixelRatio() > 1.25 ? 1024 : 512;
      // A little hysteresis avoids reallocating on either side of the near
      // boundary, while keeping high-resolution textures confined nearby.
      ensureTexture(currentResolution === 1024 && distance < 7 ? 1024 : resolution);
      if (!nextCycle) nextCycle = now + CYCLE_DURATION + cycleOffset;
      if (!reducedMotion && urls.length > 1 && distance < CYCLE_RANGE) {
        const nextIndex = (currentIndex + 1) % urls.length;
        if (!imageRequest && !prefetchRequest && !prefetched) loadImage(nextIndex, true);
        if (now >= nextCycle && prefetched?.index === nextIndex) {
          currentIndex = nextIndex;
          applyImage(prefetched.canvas);
          releaseCanvas(prefetched.canvas);
          prefetched = null;
          nextCycle = now + CYCLE_DURATION;
        }
      } else {
        nextCycle = now + CYCLE_DURATION + cycleOffset;
      }
    } else if (distance > RELEASE_RANGE && texture) {
      clearImages();
      nextCycle = 0;
    }
    return progress !== previousProgress || texture !== previousTexture;
  }

  // Give raycasting/rendering a correct transform before the first update.
  assembly.position.set(side * (wallX - 0.02), frameCY, -depth);
  assembly.rotation.y = -side * Math.PI / 2;

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearImages();
    const geometries = new Set();
    const materials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    shadowTexture.dispose();
    releaseCanvas(shadowTexture.image);
    group.removeFromParent();
    group.clear();
  }

  return { group, pickTarget, update, releaseImages, dispose };
}
