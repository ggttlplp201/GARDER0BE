import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRoom } from './room.js';
import { createFrame } from './frames.js';
import { getLayout, getPlacements, getRoomDepth, PERSPECTIVE, WORLD_SCALE } from './layout.js';

const FORWARD_RENDER_DISTANCE = 35;

export function createMuseum(container, callbacks) {
  const startupCleanup = [];
  try {
    const engine = initializeMuseum(container, callbacks, startupCleanup);
    startupCleanup.length = 0;
    return engine;
  } catch (error) {
    // A constructor can fail before the wrapper receives a disposable engine.
    // Release every completed allocation/listener before entering CSS fallback.
    for (const cleanup of startupCleanup.reverse()) {
      try { cleanup(); } catch {}
    }
    throw error;
  }
}

function initializeMuseum(container, callbacks, startupCleanup) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  startupCleanup.push(() => {
    try { renderer.dispose(); } finally { renderer.domElement.remove(); }
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.className = 'museum-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#939796');
  const camera = new THREE.PerspectiveCamera(45, 1, 0.03, 250);
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  let composerOwnsTarget = false;
  startupCleanup.push(() => { if (!composerOwnsTarget) target.dispose(); });
  const composer = new EffectComposer(renderer, target);
  composerOwnsTarget = true;
  startupCleanup.push(() => composer.dispose());
  const renderPass = new RenderPass(scene, camera);
  startupCleanup.push(() => renderPass.dispose());
  const aoPass = new GTAOPass(scene, camera, 1, 1);
  startupCleanup.push(() => aoPass.dispose());
  aoPass.blendIntensity = 0.4;
  aoPass.updateGtaoMaterial({ radius: 0.12, thickness: 0.025, distanceExponent: 1.5, distanceFallOff: 1, samples: 8 });
  aoPass.updatePdMaterial({ radius: 4, samples: 8 });
  const outputPass = new OutputPass();
  startupCleanup.push(() => outputPass.dispose());
  composer.addPass(renderPass);
  composer.addPass(aoPass);
  composer.addPass(outputPass);
  // Analytic wall shadows belong in the beauty pass, not the depth/normal
  // pass: an override material would turn their transparent cards opaque.
  const renderAO = aoPass.render.bind(aoPass);
  aoPass.render = (...args) => {
    const hidden = [];
    scene.traverse(object => {
      if (object.isMesh && object.visible && (object.name === 'museum-ceiling' || (object.material.transparent && !object.material.depthWrite))) {
        object.visible = false;
        hidden.push(object);
      }
    });
    try { renderAO(...args); } finally { hidden.forEach(object => { object.visible = true; }); }
  };
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;
  let disposed = false;
  let generation = 0;
  let buildController = null;
  let dirty = true;
  let width = 0;
  let height = 0;
  let layout = getLayout(container.clientWidth || window.innerWidth);
  let items = [];
  let itemsSignature = null;
  let itemIdsSignature = null;
  let placements = [];
  let frames = [];
  let room = null;
  let roomDepth = getRoomDepth(0, layout);
  let travel = layout.cameraStart;
  let targetTravel = travel;
  let hovered = null;
  let focused = null;
  let touch = null;
  const activeTouchPointers = new Set();
  let lastTouchAt = -Infinity;
  let momentum = 0;
  let previousNow = performance.now();
  let raf = 0;
  startupCleanup.push(() => cancelAnimationFrame(raf));
  let lastProgress = '';
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(2, 2);
  const pickables = new Map();

  function invalidate() { dirty = true; }
  function clampTravel(value) {
    return Math.max(layout.cameraStart, Math.min(roomDepth - 200 * WORLD_SCALE, value));
  }
  function clearContent() {
    scene.environment = null;
    if (room) { scene.remove(room.group); room.dispose(); room = null; }
    frames.forEach(frame => { scene.remove(frame.group); frame.dispose(); });
    frames = [];
    pickables.clear();
  }
  async function rebuild() {
    const currentGeneration = ++generation;
    buildController?.abort();
    buildController = new AbortController();
    const signal = buildController.signal;
    const buildLayout = layout;
    clearContent();
    hovered = null;
    focused = null;
    placements = getPlacements(items, buildLayout);
    const buildPlacements = placements;
    roomDepth = getRoomDepth(items.length, buildLayout);
    travel = clampTravel(travel);
    targetTravel = clampTravel(targetTravel);
    camera.far = Math.max(100, roomDepth + 20);
    camera.updateProjectionMatrix();
    try {
      const nextRoom = await createRoom({ layout: buildLayout, roomDepth, renderer, invalidate, signal });
      if (disposed || currentGeneration !== generation) { nextRoom.dispose(); return; }
      room = nextRoom;
      scene.add(room.group);
      scene.environment = room.environment;
      scene.environmentIntensity = 0.6;
      for (const placement of buildPlacements) {
        const frame = createFrame({ ...placement, layout: buildLayout, renderer, invalidate });
        frames.push(frame);
        scene.add(frame.group);
        pickables.set(frame.pickTarget, placement);
      }
      lastProgress = '';
      invalidate();
      callbacks.onReady?.();
    } catch (error) {
      if (!disposed && currentGeneration === generation && error.name !== 'AbortError') {
        clearContent();
        callbacks.onError?.(error);
      }
    }
  }
  function resize() {
    const nextWidth = Math.max(1, container.clientWidth);
    const nextHeight = Math.max(1, container.clientHeight);
    if (nextWidth === width && nextHeight === height) return;
    const nextLayout = getLayout(nextWidth);
    const geometryChanged = layout.mobile !== nextLayout.mobile || layout.wallX !== nextLayout.wallX;
    width = nextWidth;
    height = nextHeight;
    layout = nextLayout;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, layout.mobile ? 1.25 : 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    aoPass.enabled = !layout.mobile;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(height / (2 * PERSPECTIVE)));
    camera.aspect = width / height;
    camera.setViewOffset(width, height, 0, height * 0.08, width, height);
    camera.position.y = height * 0.08 * WORLD_SCALE;
    camera.updateProjectionMatrix();
    travel = clampTravel(travel);
    targetTravel = clampTravel(targetTravel);
    if (geometryChanged && generation > 0) void rebuild();
    invalidate();
  }
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const visible = [...pickables.keys()].filter(mesh => {
      let parent = mesh;
      while (parent) { if (!parent.visible) return false; parent = parent.parent; }
      return true;
    });
    return raycaster.intersectObjects(visible, false)[0]?.object || null;
  }
  function onPointerMove(event) {
    focused = null;
    if (touch && event.pointerId === touch.id) {
      const dy = touch.y - event.clientY;
      touch.y = event.clientY;
      touch.moved ||= Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) > 6;
      if (activeTouchPointers.size > 1) { momentum = 0; return; }
      momentum = dy * 1.5 * WORLD_SCALE;
      targetTravel = clampTravel(targetTravel + momentum);
      invalidate();
      return;
    }
    if (activeTouchPointers.has(event.pointerId) || event.pointerType === 'touch' || layout.mobile) return;
    hovered = pick(event.clientX, event.clientY);
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
    invalidate();
  }
  function onPointerDown(event) {
    if (focused) { focused = null; invalidate(); }
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    activeTouchPointers.add(event.pointerId);
    renderer.domElement.setPointerCapture(event.pointerId);
    momentum = 0;
    if (activeTouchPointers.size > 1) {
      if (touch) touch.moved = true;
      return;
    }
    if (touch) return;
    touch = { id: event.pointerId, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  }
  function onPointerUp(event) {
    if (!activeTouchPointers.delete(event.pointerId)) return;
    lastTouchAt = performance.now();
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (!touch || event.pointerId !== touch.id) return;
    const wasTap = !touch.moved && activeTouchPointers.size === 0
      && Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) <= 6;
    touch = null;
    if (reducedMotion || wasTap) momentum = 0;
    if (wasTap) {
      const hit = pick(event.clientX, event.clientY);
      if (hit) callbacks.onItem?.(pickables.get(hit).item);
    }
    invalidate();
  }
  function onClick(event) {
    // Safari can synthesize a MouseEvent click without pointerType after a tap.
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || performance.now() - lastTouchAt < 400) return;
    const hit = pick(event.clientX, event.clientY);
    if (hit) callbacks.onItem?.(pickables.get(hit).item);
  }
  function onPointerLeave() {
    focused = null;
    hovered = null;
    renderer.domElement.style.cursor = 'default';
    invalidate();
  }
  function onPointerCancel(event) {
    if (!activeTouchPointers.delete(event.pointerId)) return;
    lastTouchAt = performance.now();
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (touch?.id === event.pointerId) touch = null;
    momentum = 0;
  }
  function onWheel(event) {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    targetTravel = clampTravel(targetTravel + pixels * 0.8 * WORLD_SCALE);
    focused = null;
    momentum = 0;
    invalidate();
  }
  function onMotionChange(event) { reducedMotion = event.matches; invalidate(); }
  function onContextLost(event) {
    event.preventDefault();
    callbacks.onError?.(new Error('The graphics context was lost.'));
  }
  function animate(now) {
    if (disposed) return;
    raf = requestAnimationFrame(animate);
    const delta = Math.min((now - previousNow) / 1000, 0.05);
    previousNow = now;
    if (document.hidden || !room) return;
    if (!touch && Math.abs(momentum) > 0.001 && !reducedMotion) {
      momentum *= Math.pow(0.92, delta * 60);
      targetTravel = clampTravel(targetTravel + momentum * delta * 60);
      dirty = true;
    }
    const previousTravel = travel;
    travel = reducedMotion ? targetTravel : THREE.MathUtils.damp(travel, targetTravel, 16, delta);
    if (Math.abs(targetTravel - travel) < 0.0005) travel = targetTravel;
    dirty ||= previousTravel !== travel;
    camera.position.z = PERSPECTIVE * WORLD_SCALE - travel;
    room.updateCamera?.(camera.position.z);
    let nearest = null;
    frames.forEach((frame, index) => {
      const placement = placements[index];
      const visible = travel - placement.depth < layout.cullBehind
        && placement.depth - travel < FORWARD_RENDER_DISTANCE;
      if (frame.group.visible !== visible) { frame.group.visible = visible; dirty = true; }
      if (!visible && travel - placement.depth > 24) frame.releaseImages?.();
      if (visible) dirty = frame.update({ cameraZ: travel, hovered: frame.pickTarget === (focused || hovered), delta, reducedMotion, now }) || dirty;
      const distance = Math.abs(placement.depth - travel);
      if (!nearest || distance < nearest.dist) nearest = { ...placement, dist: distance };
    });
    const progress = Math.min(1, travel / Math.max(0.005, roomDepth - 200 * WORLD_SCALE));
    const progressKey = `${Math.round(progress * 100)}:${nearest?.item.id || ''}`;
    if (progressKey !== lastProgress) {
      lastProgress = progressKey;
      callbacks.onProgress?.({ progress, nearest });
    }
    if (dirty) {
      try { composer.render(delta); } catch (error) { callbacks.onError?.(error); }
      dirty = false;
    }
  }
  function listen(type, handler, options) {
    startupCleanup.push(() => renderer.domElement.removeEventListener(type, handler, options));
    renderer.domElement.addEventListener(type, handler, options);
  }
  listen('pointermove', onPointerMove);
  listen('pointerdown', onPointerDown);
  listen('pointerup', onPointerUp);
  listen('pointercancel', onPointerCancel);
  listen('pointerleave', onPointerLeave);
  listen('click', onClick);
  listen('wheel', onWheel, { passive: false });
  listen('webglcontextlost', onContextLost);
  startupCleanup.push(() => motionQuery.removeEventListener('change', onMotionChange));
  motionQuery.addEventListener('change', onMotionChange);
  const observer = new ResizeObserver(resize);
  startupCleanup.push(() => observer.disconnect());
  observer.observe(container);
  resize();
  raf = requestAnimationFrame(animate);
  return {
    setItems(nextItems) {
      // Filtering can produce a new array with exactly the same exhibits.
      // Keep a value snapshot so in-place label/image edits are also noticed.
      const signature = JSON.stringify(nextItems.map(item => [
        item.id, item.cat, item.brand, item.name, item.type, item.color, item.imageUrls,
      ]));
      const idsSignature = JSON.stringify(nextItems.map(item => item.id));
      if (idsSignature !== itemIdsSignature) {
        // New search results begin at the entrance, where the first match is visible.
        // Metadata-only edits keep the viewer's position in the collection.
        travel = targetTravel = layout.cameraStart;
        momentum = 0;
        if (touch) touch.moved = true;
      }
      itemIdsSignature = idsSignature;
      items = nextItems;
      if (signature === itemsSignature) {
        // Selection must still receive the newest item object and metadata.
        placements.forEach((placement, index) => { placement.item = items[index]; });
        return Promise.resolve();
      }
      itemsSignature = signature;
      return rebuild();
    },
    focusItem(id) {
      const index = placements.findIndex(placement => placement.item.id === id);
      if (index < 0) return;
      focused = frames[index]?.pickTarget || null;
      targetTravel = clampTravel(placements[index].depth);
      invalidate();
    },
    clearFocus() {
      if (!focused) return;
      focused = null;
      invalidate();
    },
    dispose() {
      disposed = true;
      activeTouchPointers.clear();
      touch = null;
      generation++;
      buildController?.abort();
      cancelAnimationFrame(raf);
      observer.disconnect();
      motionQuery.removeEventListener('change', onMotionChange);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      clearContent();
      renderPass.dispose();
      aoPass.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
