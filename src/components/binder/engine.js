import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBinderMaterials } from './materials.js';
import { sampleSleeveHeight } from './sleeveGeometry.js';
import { createSpineGeometry, updateSpineGeometry, getCoverHinge, BACK_COVER_Z } from './coverGeometry.js';
import { PAGE_WIDTH, PAGE_HEIGHT, samplePage, getPageStackLayout, pageTurnBaseZ } from './pageGeometry.js';

const COVER_WIDTH = 3.02;
const COVER_HEIGHT = 4.18;
const smooth = t => t * t * (3 - 2 * t);
const clamp = t => Math.max(0, Math.min(1, t));

// The renderer owns its GPU resources. React only owns controls and item data.
export function createBinder(host, callbacks = {}) {
  let renderer;
  let materials;
  let environment;
  const allocations = new Set();
  const geometries = new Set();
  const textures = new Set();
  const leaves = new Set();
  let disposed = false;
  let raf = 0;
  let resizeObserver;
  let motionQuery;
  let removeListeners = () => {};
  let renderFrame;
  let ready = false;
  let animation = null;
  let items = [];
  let spread = 0;
  let pageCount = 2;
  let openness = 0;
  let open = false;
  let leftLeaf;
  let rightLeaf;
  let turningLeaf;
  let underLeaf;
  let step = 0.04;
  let coverTop = 0.3;
  const scene = new THREE.Scene();
  const book = new THREE.Group();
  scene.add(book);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const target = new THREE.Vector2();
  const tilt = new THREE.Vector2();
  let pointerStart = null;
  let hiddenId = null;
  let zoomFactor = 1;
  const pan = new THREE.Vector2();   // camera offset in world units (only when zoomed in)
  let camHalfH = 3, camHalfW = 4;
  const disposableMaterial = material => { allocations.add(material); return material; };
  const ownGeometry = geometry => { geometries.add(geometry); return geometry; };
  const ownTexture = texture => { textures.add(texture); return texture; };
  const invalidate = () => { if (!disposed && !raf) raf = requestAnimationFrame(now => renderFrame(now)); };
  const state = () => callbacks.onState?.({ open, busy: !!animation, spread, pageCount });

  function disposeLeaf(leaf) {
    if (!leaf) return;
    book.remove(leaf.group);
    leaf.alive = false;
    leaf.geometry.forEach(g => { geometries.delete(g); g.dispose(); });
    leaf.material.forEach(m => { allocations.delete(m); m.dispose(); });
    leaf.texture.forEach(t => { textures.delete(t); t.dispose(); });
    leaves.delete(leaf);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
    removeListeners();
    for (const leaf of [...leaves]) disposeLeaf(leaf);
    geometries.forEach(g => g.dispose());
    allocations.forEach(m => m.dispose());
    textures.forEach(t => t.dispose());
    materials?.dispose();
    environment?.dispose();
    renderer?.dispose();
    renderer?.domElement.remove();
  }

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.cssText = 'display:block; width:100%; height:100%; touch-action:pan-y;';
    host.appendChild(renderer.domElement);
    materials = createBinderMaterials(renderer);
    materials.plastic.side = THREE.FrontSide;
    materials.weld.side = THREE.FrontSide;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environment = pmrem.fromScene(room, 0.06);
    room.dispose();
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    scene.environmentRotation.set(0.5, 0.3, 0.2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555c6a, 0.8));
    const key = new THREE.DirectionalLight(0xfff8eb, 2.4);
    key.position.set(-3, 5, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.1, far: 20 });
    key.shadow.normalBias = 0.012;
    key.shadow.bias = -0.00012;
    key.shadow.radius = 5;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce8ff, 0.7);
    fill.position.set(5, -2, 5);
    scene.add(fill);
    const floor = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(200, 200)), disposableMaterial(new THREE.ShadowMaterial({ opacity: 0.11 })));
    floor.position.z = -0.158;
    floor.receiveShadow = true;
    scene.add(floor);

    const coverGeometry = ownGeometry(new RoundedBoxGeometry(COVER_WIDTH, COVER_HEIGHT, 0.12, 6, 0.055));
    function makeCover(front) {
      const group = new THREE.Group();
      const direction = front ? -1 : 1;
      const cover = new THREE.Mesh(coverGeometry, materials.leather);
      cover.position.x = direction * COVER_WIDTH / 2;
      cover.castShadow = true;
      cover.receiveShadow = true;
      cover.userData.cover = true;
      group.add(cover);
      const lining = new THREE.Mesh(ownGeometry(new RoundedBoxGeometry(COVER_WIDTH - 0.09, COVER_HEIGHT - 0.1, 0.013, 4, 0.025)), materials.lining);
      lining.position.set(cover.position.x, 0, 0.065);
      group.add(lining);
      // Individual stitches follow the perimeter; each has actual rounded volume.
      const stitchGeometry = ownGeometry(new THREE.CapsuleGeometry(0.0028, 0.021, 2, 3));
      const countX = 66, countY = 94;
      const stitches = new THREE.InstancedMesh(stitchGeometry, materials.thread, (countX + countY) * 4);
      const dummy = new THREE.Object3D();
      let i = 0;
      for (const z of [-0.061, 0.074]) {
        for (const ySign of [-1, 1]) for (let j = 0; j < countX; j++) {
          dummy.position.set(cover.position.x - COVER_WIDTH / 2 + 0.095 + j / (countX - 1) * (COVER_WIDTH - 0.19), ySign * (COVER_HEIGHT / 2 - 0.075), z);
          dummy.rotation.z = Math.PI / 2;
          dummy.updateMatrix(); stitches.setMatrixAt(i++, dummy.matrix);
        }
        for (const xSign of [-1, 1]) for (let j = 0; j < countY; j++) {
          dummy.position.set(cover.position.x + xSign * (COVER_WIDTH / 2 - 0.075), -COVER_HEIGHT / 2 + 0.11 + j / (countY - 1) * (COVER_HEIGHT - 0.22), z);
          dummy.rotation.z = 0;
          dummy.updateMatrix(); stitches.setMatrixAt(i++, dummy.matrix);
        }
      }
      group.add(stitches);
      return group;
    }
    const backCover = makeCover(false);
    backCover.position.set(0, 0, BACK_COVER_Z);
    book.add(backCover);
    const coverPivot = new THREE.Group();
    const frontCover = makeCover(true);
    coverPivot.add(frontCover);
    book.add(coverPivot);
    const spineGeometry = ownGeometry(createSpineGeometry(COVER_HEIGHT));
    const spine = new THREE.Mesh(spineGeometry, [materials.leather, materials.lining]);
    spine.castShadow = true;
    spine.receiveShadow = true;
    book.add(spine);

    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = 1536; logoCanvas.height = 512;
    const logoContext = logoCanvas.getContext('2d');
    logoContext.textAlign = 'center';
    logoContext.fillStyle = '#08090a';
    logoContext.font = '600 114px Arial, sans-serif';
    logoContext.letterSpacing = '15px';
    logoContext.fillText('GARDER0BE', 768, 235);
    logoContext.font = '28px monospace';
    logoContext.letterSpacing = '8px';
    logoContext.fillText('VOL. 01', 768, 340);
    const logoMap = ownTexture(new THREE.CanvasTexture(logoCanvas));
    logoMap.colorSpace = THREE.SRGBColorSpace;
    const logoMaterial = disposableMaterial(new THREE.MeshStandardMaterial({ map: logoMap, transparent: true, roughness: 0.76, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    const logo = new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(2.2, 0.74)), logoMaterial);
    logo.rotation.y = Math.PI;
    logo.position.set(-COVER_WIDTH / 2, 0.2, -0.061);
    frontCover.add(logo);
    // Closure band sits around the outside cover, above its leather shell.
    const band = new THREE.Mesh(ownGeometry(new RoundedBoxGeometry(0.115, COVER_HEIGHT + 0.008, 0.02, 3, 0.008)), materials.edge);
    band.position.set(-2.66, 0, -0.07);
    frontCover.add(band);

    const deck = new THREE.Group();
    book.add(deck);
    const deckGeometry = ownGeometry(new THREE.BoxGeometry(PAGE_WIDTH, PAGE_HEIGHT, 0.012));
    const deckMaterial = disposableMaterial(new THREE.MeshStandardMaterial({ color: '#242728', roughness: 0.63 }));
    const deckSlices = Array.from({ length: 12 }, (_, i) => {
      const mesh = new THREE.Mesh(deckGeometry, deckMaterial);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.left = i < 6;
      mesh.userData.depth = i % 6;
      deck.add(mesh); return mesh;
    });

    function canvasTexture(canvas) {
      const texture = ownTexture(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return texture;
    }
    const MONO = "'JetBrains Mono', ui-monospace, monospace", SANS = "'Inter Tight', Arial, sans-serif";
    const PEARL = ['#ffffff', 'hsl(330 85% 90%)', '#ffffff', 'hsl(185 85% 88%)', '#f4fbff', 'hsl(55 90% 88%)', '#ffffff', 'hsl(265 85% 91%)'];
    const CW = 384, CH = 570;
    const LAB = { x: 24, y: 26, w: 336, h: 106 }, CARD = { x: 36, y: 146, w: 312, h: 396 };
    const rrp = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
    const pearlGrad = (c, x0, y0, x1, y1, reps) => {
      const g = c.createLinearGradient(x0, y0, x1, y1), n = PEARL.length * reps;
      for (let i = 0; i <= n; i++) g.addColorStop(i / n, PEARL[i % PEARL.length]);
      return g;
    };
    // Clear acrylic case: molded frosted frame, label + card wells, edge highlights. Mostly transparent.
    let caseTex = null, caseMats = null;
    function caseTexture() {
      if (caseTex) return caseTex;
      const cv = document.createElement('canvas'); cv.width = CW * 2; cv.height = CH * 2;
      const c = cv.getContext('2d'); c.scale(2, 2);
      c.fillStyle = 'rgba(232,240,246,.06)'; rrp(c, 0, 0, CW, CH, 26); c.fill();
      c.beginPath(); c.roundRect(0, 0, CW, CH, 26); c.roundRect(12, 12, CW - 24, CH - 24, 16);
      c.fillStyle = 'rgba(226,234,241,.5)'; c.fill('evenodd');
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(85,100,114,.3)';
      rrp(c, LAB.x - 5, LAB.y - 5, LAB.w + 10, LAB.h + 10, 8); c.stroke();
      rrp(c, CARD.x - 7, CARD.y - 7, CARD.w + 14, CARD.h + 14, 10); c.stroke();
      c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.7)';
      rrp(c, LAB.x - 3.5, LAB.y - 3.5, LAB.w + 7, LAB.h + 7, 7); c.stroke();
      rrp(c, CARD.x - 5.5, CARD.y - 5.5, CARD.w + 11, CARD.h + 11, 9); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(80,95,108,.4)'; rrp(c, 12, 12, CW - 24, CH - 24, 16); c.stroke();
      c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.85)'; rrp(c, 13.5, 13.5, CW - 27, CH - 27, 15); c.stroke();
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.95)'; rrp(c, 2, 2, CW - 4, CH - 4, 24); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(55,70,84,.6)'; rrp(c, .75, .75, CW - 1.5, CH - 1.5, 25.5); c.stroke();
      caseTex = canvasTexture(cv);
      return caseTex;
    }
    function caseMaterials() {
      if (caseMats) return caseMats;
      caseMats = {
        rim: disposableMaterial(new THREE.MeshPhysicalMaterial({ map: caseTexture(), color: '#bfc3c6', transparent: true, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.1, depthWrite: false, side: THREE.DoubleSide })),
        // Black + additive = pure reflection: glossy plastic over the card without dimming it.
        gloss: disposableMaterial(new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.05, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.03, specularIntensity: 0.5, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
      };
      return caseMats;
    }
    // Paper is near-white under a 2.4 key + hemi + env, which clipped to flat white and
    // washed out the label. INSERT_TONE pulls the insert's albedo down (cards only).
    const INSERT_TONE = '#a4a4a4';
    function insertMaterial(map, mask) {
      return new THREE.MeshPhysicalMaterial({ map, color: INSERT_TONE, roughness: 0.48, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.35, iridescence: 1, iridescenceMap: mask, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 560], specularIntensity: 0.4, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide });
    }
    // Paper insert: grading label + the card itself, transparent around them so the case reads as separate.
    function cardTexture(item, index, leaf) {
      const K = 2;
      const canvas = document.createElement('canvas'); canvas.width = CW * K; canvas.height = CH * K;
      const ctx = canvas.getContext('2d'); ctx.scale(K, K);
      const maskCanvas = document.createElement('canvas'); maskCanvas.width = CW / 2; maskCanvas.height = CH / 2;
      const m = maskCanvas.getContext('2d'); m.scale(.5, .5);
      const texture = canvasTexture(canvas); leaf.texture.push(texture);
      const mask = ownTexture(new THREE.CanvasTexture(maskCanvas)); mask.colorSpace = THREE.NoColorSpace; leaf.texture.push(mask);
      const trim = (str, width) => {
        let s = String(str || ''); const full = s;
        while (s.length && ctx.measureText(s).width > width) s = s.slice(0, -1);
        return s === full ? s : `${s.slice(0, -1)}…`;
      };
      function paint(image) {
        ctx.clearRect(0, 0, CW, CH);
        ctx.letterSpacing = '0px'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        const { x: lx, y: ly, w: lw, h: lh } = LAB, div = lx + lw - 86;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1.5;
        ctx.fillStyle = '#fff'; rrp(ctx, lx, ly, lw, lh, 5); ctx.fill(); ctx.restore();
        ctx.lineWidth = 2; ctx.strokeStyle = '#000'; rrp(ctx, lx + 1, ly + 1, lw - 2, lh - 2, 4.5); ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.18)'; rrp(ctx, lx + 5, ly + 5, lw - 10, lh - 10, 3); ctx.stroke();
        ctx.fillStyle = '#000'; ctx.fillRect(div, ly + 11, 1.5, lh - 22);
        ctx.font = `700 13px ${MONO}`; ctx.letterSpacing = '2.6px'; ctx.fillText('GARDER0BE', lx + 13, ly + 26);
        const gw = ctx.measureText('GARDER0BE').width;
        ctx.font = `400 13px ${MONO}`; ctx.letterSpacing = '1.2px'; ctx.fillStyle = '#666'; ctx.fillText(`№ ${item.cat || String(index + 1).padStart(3, '0')}`, lx + 21 + gw, ly + 26);
        ctx.font = `500 13px ${MONO}`; ctx.letterSpacing = '1.8px'; ctx.fillStyle = '#555'; ctx.fillText(trim(String(item.brand || '—').toUpperCase(), div - lx - 26), lx + 13, ly + 47);
        ctx.font = `700 21px ${SANS}`; ctx.letterSpacing = '-0.2px'; ctx.fillStyle = '#000'; ctx.fillText(trim(item.name || 'Untitled', div - lx - 26), lx + 13, ly + 72);
        let bx = lx + 13;
        for (let i = 0; i < 30; i++) { const w = (i * 7 + index * 3) % 5 === 0 ? 2.6 : 1.2; if ((i * 13 + index) % 4) ctx.fillRect(bx, ly + 82, w, 12); bx += w + 1.6; }
        ctx.font = `400 9.5px ${MONO}`; ctx.letterSpacing = '.8px'; ctx.fillStyle = '#555'; ctx.fillText(item.serial || String(48120731 + (item.id || index) * 7919), bx + 7, ly + 92); // app passes `serial` (ids are uuids)
        const sx = div - 52, sy = ly + 79;
        ctx.fillStyle = pearlGrad(ctx, sx, sy, sx + 44, sy + 18, 1); rrp(ctx, sx, sy, 42, 17, 8.5); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.stroke();
        const cx = div + (lx + lw - div) / 2;
        ctx.textAlign = 'center';
        ctx.font = `400 11px ${MONO}`; ctx.letterSpacing = '1.6px'; ctx.fillStyle = '#666'; ctx.fillText('ACQ.', cx, ly + 36);
        ctx.font = `700 22px ${SANS}`; ctx.letterSpacing = '-0.3px'; ctx.fillStyle = '#000'; ctx.fillText(item.acqDay || '—', cx, ly + 64);
        ctx.font = `700 13px ${MONO}`; ctx.letterSpacing = '1.4px'; ctx.fillText(item.acqYear || '', cx, ly + 86);
        ctx.textAlign = 'left';
        const { x: x0, y: y0, w: cw, h: ch } = CARD;
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 7; ctx.shadowOffsetY = 2.5;
        ctx.fillStyle = '#fff'; rrp(ctx, x0, y0, cw, ch, 7); ctx.fill(); ctx.restore();
        const px = x0 + 10, py = y0 + 10, pw = cw - 20, ph = ch - 64;
        ctx.save(); rrp(ctx, x0, y0, cw, ch, 7); ctx.clip();
        ctx.fillStyle = '#f0f0f0'; ctx.fillRect(px, py, pw, ph);
        if (image) {
          const s = Math.min(pw * .84 / image.naturalWidth, ph * .84 / image.naturalHeight);
          ctx.drawImage(image, px + pw / 2 - image.naturalWidth * s / 2, py + ph / 2 - image.naturalHeight * s / 2, image.naturalWidth * s, image.naturalHeight * s);
        } else {
          ctx.textAlign = 'center'; ctx.font = `400 12px ${MONO}`; ctx.letterSpacing = '2.4px'; ctx.fillStyle = '#aaa';
          ctx.fillText('NO PHOTO', px + pw / 2, py + ph / 2 + 4); ctx.textAlign = 'left';
        }
        ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.strokeRect(px, py, pw, ph);
        ctx.font = `400 13px ${MONO}`; ctx.letterSpacing = '.8px'; ctx.fillStyle = '#999';
        ctx.fillText(trim(item.meta || [item.type, item.condition].filter(Boolean).join(' · ').toUpperCase(), pw - 70), px, y0 + ch - 22);
        ctx.textAlign = 'right'; ctx.fillText(String(item.size || ''), px + pw, y0 + ch - 22); ctx.textAlign = 'left';
        ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .24;
        ctx.fillStyle = pearlGrad(ctx, x0, y0, x0 + cw * .75, y0 + ch, 3); ctx.fillRect(x0, y0, cw, ch);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.restore();
        ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; rrp(ctx, x0 + 1.25, y0 + 1.25, cw - 2.5, ch - 2.5, 6); ctx.stroke();
        m.fillStyle = '#000'; m.fillRect(0, 0, CW, CH);
        m.fillStyle = '#d0d0d0'; rrp(m, x0, y0, cw, ch, 7); m.fill();
        m.fillStyle = '#909090'; m.fillRect(px, py, pw, ph);
        m.fillStyle = '#fff'; rrp(m, sx, sy, 42, 17, 8.5); m.fill();
        texture.needsUpdate = true; mask.needsUpdate = true;
        invalidate();
      }
      paint(null);
      let url = item.image_url;
      try { const parsed = JSON.parse(url); if (Array.isArray(parsed)) url = parsed[0]; } catch { /* single URL */ }
      if (typeof url === 'string' && url) {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => { if (!disposed && leaf.alive) paint(image); };
        image.src = url;
      }
      return { map: texture, mask };
    }

    function patch(leaf, { x, y, w, h, material, side = 1, offset = 0, bulge = 0, segments = 1, item = null, mirror = false, seed = 0, lip = false }) {
      const geometry = ownGeometry(new THREE.PlaneGeometry(w, h, segments, bulge ? (lip ? 6 : 18) : 1));
      const rest = geometry.attributes.position.array.slice();
      const uv = geometry.attributes.uv;
      for (let i = 0; i < rest.length; i += 3) {
        rest[i] += x; rest[i + 1] += y;
        const u = uv.getX(i / 3), v = uv.getY(i / 3);
        rest[i + 2] = offset + bulge * sampleSleeveHeight(u, v, seed, lip);
        if (material === materials.plastic) uv.setXY(i / 3, u * w / 0.794 + seed * 0.371, v * h / 1.14 + seed * 0.619);
        if (material === materials.weld) uv.setXY(i / 3, h > w ? u : v, (h > w ? v * h : u * w) / 0.032);
        if (mirror) uv.setX(i / 3, 1 - uv.getX(i / 3));
      }
      if (side < 0) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 2]] = [indices[i + 2], indices[i]];
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = !material.transparent;
      mesh.receiveShadow = !material.transparent;
      mesh.userData.item = item;
      if (item && item.id === hiddenId) mesh.visible = false;
      mesh.userData.surface = { rest, side };
      mesh.frustumCulled = false;
      leaf.group.add(mesh); leaf.geometry.push(geometry); leaf.patches.push(mesh);
      return mesh;
    }
    // Empty pocket: a small "+" printed on the backing, clickable to add an item.
    let addMat = null;
    function addMaterial() {
      if (addMat) return addMat;
      const c = document.createElement('canvas'); c.width = 148; c.height = 220;
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(196,201,196,.7)'; g.lineWidth = 3; g.lineCap = 'round';
      const cx = 74, cy = 110, r = 13;
      g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
      addMat = disposableMaterial(new THREE.MeshBasicMaterial({ map: canvasTexture(c), transparent: true, depthWrite: false }));
      return addMat;
    }
    function createLeaf(frontPage, backPage) {
      const leaf = { group: new THREE.Group(), patches: [], geometry: [], texture: [], material: [], alive: true, progress: 0, z: 0 };
      leaves.add(leaf); book.add(leaf.group);
      const backing = disposableMaterial(new THREE.MeshStandardMaterial({ color: '#242827', roughness: 0.78, side: THREE.DoubleSide }));
      leaf.material.push(backing);
      patch(leaf, { x: PAGE_WIDTH / 2, y: 0, w: PAGE_WIDTH, h: PAGE_HEIGHT, material: backing, segments: 96 });
      for (const [page, side] of [[frontPage, 1], [backPage, -1]]) {
        // Three heat-welded edges hold the film; its curled top edge stays open.
        const { surface, bulge, lipRise } = getPageStackLayout(pageCount / 2, spread);
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
          const x = 0.57 + col * 0.88;
          const y = 1.25 - row * 1.25;
          const itemIndex = page * 9 + row * 3 + (side > 0 ? col : 2 - col);
          const item = page >= 0 && page < pageCount ? items[itemIndex] : null;
          if (item) {
            const { map, mask } = cardTexture(item, itemIndex, leaf);
            const material = disposableMaterial(insertMaterial(map, mask));
            leaf.material.push(material);
            const cm = caseMaterials(), box = { x, y: y - 0.012, w: 0.742, h: 1.10, side, item, mirror: side < 0 };
            patch(leaf, { ...box, material, offset: side * surface * 0.5 });
            patch(leaf, { ...box, material: cm.rim, offset: side * surface * 0.72 });
            patch(leaf, { ...box, material: cm.gloss, offset: side * surface * 0.74 });
          } else if (page >= 0 && page < pageCount && callbacks.onAdd) {
            const plus = patch(leaf, { x, y: y - 0.012, w: 0.742, h: 1.10, material: addMaterial(), side, offset: side * surface * 0.5 });
            plus.userData.add = true;
          }
          const seed = (page + 2) * 11 + row * 3 + col;
          patch(leaf, { x, y: y - 0.015, w: 0.794, h: 1.14, material: materials.plastic, side, offset: side * surface, bulge: side * bulge, segments: 16, seed });
          for (const sx of [-1, 1]) {
            patch(leaf, { x: x + sx * 0.402, y: y - 0.005, w: 0.012, h: 1.18, material: materials.weld, side, offset: side * surface });
            patch(leaf, { x: x + sx * 0.414, y: y - 0.005, w: 0.002, h: 1.18, material: materials.weld, side, offset: side * surface });
          }
          patch(leaf, { x, y: y - 0.59, w: 0.818, h: 0.012, material: materials.weld, side, offset: side * surface, segments: 8 });
          // A narrow curled strip joins the free top of the main film.
          patch(leaf, { x, y: y + 0.569, w: 0.794, h: 0.028, material: materials.plastic, side, offset: side * surface, bulge: side * lipRise, segments: 16, seed, lip: true });
        }
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 32;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b5b9b4'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
        ctx.fillText(page >= 0 && page < pageCount ? `GARDER0BE  /  ${String(page + 1).padStart(2, '0')}` : 'GARDER0BE', 128, 22);
        const map = canvasTexture(canvas); leaf.texture.push(map);
        const material = disposableMaterial(new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false })); leaf.material.push(material);
        patch(leaf, { x: PAGE_WIDTH / 2, y: -1.91, w: 0.75, h: 0.09, material, side, offset: side * surface, mirror: side < 0 });
      }
      // Batch welded edges and plastic into shared draws, retaining pickable cards.
      for (const material of [materials.plastic, materials.weld]) {
        const patches = leaf.patches.filter(mesh => mesh.material === material);
        if (!patches.length) continue;
        const geometry = ownGeometry(mergeGeometries(patches.map(mesh => mesh.geometry)));
        const rest = new Float32Array(patches.reduce((n, mesh) => n + mesh.userData.surface.rest.length, 0));
        const sides = new Float32Array(rest.length / 3);
        let offset = 0;
        for (const mesh of patches) {
          rest.set(mesh.userData.surface.rest, offset);
          sides.fill(mesh.userData.surface.side, offset / 3, (offset + mesh.userData.surface.rest.length) / 3);
          offset += mesh.userData.surface.rest.length;
          leaf.group.remove(mesh);
          leaf.patches.splice(leaf.patches.indexOf(mesh), 1);
          leaf.geometry.splice(leaf.geometry.indexOf(mesh.geometry), 1);
          geometries.delete(mesh.geometry); mesh.geometry.dispose();
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.userData.surface = { rest, sides, side: 1 };
        leaf.group.add(mesh); leaf.geometry.push(geometry); leaf.patches.push(mesh);
      }
      return leaf;
    }
    function deform(leaf, progress, z) {
      if (!leaf) return;
      leaf.progress = progress; leaf.z = z;
      // One cross-section cache is shared by every patch on both faces.
      const samples = new Map();
      for (const mesh of leaf.patches) {
        const { rest, side, sides } = mesh.userData.surface;
        const position = mesh.geometry.attributes.position;
        const normal = mesh.geometry.attributes.normal;
        for (let i = 0; i < rest.length; i += 3) {
          const x = rest[i];
          let s = samples.get(x);
          if (!s) { s = samplePage(x, 0, progress, z); samples.set(x, s); }
          const offset = rest[i + 2];
          position.setXYZ(i / 3, s.x + s.nx * offset, rest[i + 1], s.z + s.nz * offset);
          const face = sides ? sides[i / 3] : side;
          normal.setXYZ(i / 3, s.nx * face, 0, s.nz * face);
        }
        position.needsUpdate = true; normal.needsUpdate = true;
        // Film bowing and curled lips must also bend their lighting normals.
        if (mesh.material === materials.plastic || mesh.material === materials.weld) mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
    }
    function heights(s = spread) {
      return getPageStackLayout(pageCount / 2, s);
    }
    function pose() {
      const coverPhase = smooth(clamp(openness / 0.61));
      const sheetPhase = smooth(clamp((openness - 0.64) / 0.36));
      const hinge = getCoverHinge(coverTop);
      coverPivot.position.z = hinge.pivotZ;
      frontCover.position.z = hinge.offsetZ;
      coverPivot.rotation.y = Math.PI * (1 - coverPhase);
      updateSpineGeometry(spineGeometry, coverPivot.rotation.y, coverTop);
      book.position.x = -COVER_WIDTH / 2 * (1 - coverPhase);
      book.rotation.z = -0.035 * (1 - coverPhase) + tilt.x * 0.016;
      book.rotation.x = tilt.y * 0.022;
      const h = heights();
      if (!turningLeaf) {
        deform(leftLeaf, sheetPhase, pageTurnBaseZ(h.closed, h.left, sheetPhase, step));
        deform(rightLeaf, 0, h.right);
      }
      // Mid-turn, the side receiving the under-leaf already sits at the next
      // spread's height; its deck must follow, or the slab's top lands exactly on
      // that leaf and z-fights with its cards.
      const turnAnim = animation && animation.kind === 'page' ? animation : null;
      const hNext = turnAnim ? heights(turnAnim.next) : h;
      for (const mesh of deckSlices) {
        const left = mesh.userData.left;
        const ahead = turnAnim && (left ? turnAnim.dir < 0 : turnAnim.dir > 0);
        const s = ahead ? turnAnim.next : spread, hs = ahead ? hNext : h;
        const count = left ? s : pageCount / 2 - s - 1;
        const depth = mesh.userData.depth;
        mesh.visible = depth < Math.min(6, count) && (sheetPhase === 1 || !left);
        mesh.scale.z = hs.deckThickness / 0.012;
        const side = left ? -1 : 1;
        mesh.position.set(side * PAGE_WIDTH / 2, 0, (left ? hs.left : hs.right) - (depth + 1) * step);
      }
    }
    function rebuild() {
      for (const leaf of [...leaves]) disposeLeaf(leaf);
      turningLeaf = underLeaf = null;
      leftLeaf = createLeaf(-1, spread * 2);
      rightLeaf = createLeaf(spread * 2 + 1, -1);
      pose(); invalidate(); state();
    }
    function setItems(nextItems) {
      if (disposed) return;
      animation = null;
      items = Array.isArray(nextItems) ? nextItems : [];
      pageCount = items.length ? Math.max(2, Math.ceil(items.length / 18) * 2) : 6;
      spread = Math.min(spread, pageCount / 2 - 1);
      const layout = heights();
      step = layout.step;
      coverTop = layout.coverTop;
      openness = open ? 1 : 0;
      rebuild();
    }
    function toggle() {
      if (disposed || animation) return;
      const to = open ? 0 : 1;
      open = !!to;
      animation = { kind: 'cover', start: performance.now(), duration: motionQuery.matches ? 0 : 1350, from: openness, to };
      state(); invalidate();
    }
    function turn(direction) {
      if (disposed || animation || !open) return;
      const dir = direction > 0 ? 1 : -1;
      const next = spread + dir;
      if (next < 0 || next >= pageCount / 2) return;
      const start = heights(); const end = heights(next);
      if (dir > 0) {
        disposeLeaf(rightLeaf); rightLeaf = null;
        turningLeaf = createLeaf(spread * 2 + 1, spread * 2 + 2);
        underLeaf = createLeaf(next * 2 + 1, -1);
        deform(underLeaf, 0, end.right);
      } else {
        disposeLeaf(leftLeaf); leftLeaf = null;
        turningLeaf = createLeaf(next * 2 + 1, next * 2 + 2);
        underLeaf = createLeaf(-1, next * 2);
        deform(underLeaf, 1, end.left);
      }
      animation = { kind: 'page', start: performance.now(), duration: motionQuery.matches ? 0 : 1050, dir, next, fromZ: dir > 0 ? start.right : start.left, toZ: dir > 0 ? end.left : end.right };
      // Pose the new leaf before its first paint, including the reverse direction.
      deform(turningLeaf, dir > 0 ? 0 : 1, animation.fromZ);
      pose(); state(); invalidate();
    }
    // Pan only as far as the open book (~8.6 × 4.2 world units) overflows the view.
    function clampPan() {
      const mx = Math.max(0, 4.6 - camHalfW), my = Math.max(0, 2.4 - camHalfH * 0.95);
      pan.set(Math.max(-mx, Math.min(mx, pan.x)), Math.max(-my, Math.min(my, pan.y)));
    }
    function resize() {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const fitW = 8.4 / camera.aspect / (2 * Math.tan(THREE.MathUtils.degToRad(17)));
      const fitH = 6.2 / (2 * Math.tan(THREE.MathUtils.degToRad(17)));
      const distance = Math.max(11, fitW, fitH) * zoomFactor;
      camHalfH = distance * Math.tan(THREE.MathUtils.degToRad(17));
      camHalfW = camHalfH * camera.aspect;
      clampPan();
      camera.position.set(pan.x, -distance * 0.29 + pan.y, distance * 0.957);
      camera.lookAt(pan.x, pan.y, 0.32);
      camera.updateProjectionMatrix();
      invalidate();
    }
    function hit(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects([book], true).find(result => result.object.userData.item || result.object.userData.add || result.object.userData.cover);
    }
    // Zoom: one path for wheel, pinch and the toolbar buttons. Lower factor = closer.
    const touches = new Map();
    let pinchDist = 0, pinched = false;
    function applyZoom(factor) {
      const next = Math.max(0.55, Math.min(1.8, factor));
      if (next === zoomFactor) return;
      zoomFactor = next;
      // Zoomed in: the canvas owns one-finger drags (pan) instead of page scroll.
      renderer.domElement.style.touchAction = canPan() ? 'none' : 'pan-y';
      resize();
      callbacks.onZoom?.(Math.round(100 / zoomFactor));
    }
    const canPan = () => zoomFactor < 0.99;
    let drag = null;
    function panBy(dx, dy) {
      const wpp = 2 * camHalfH / Math.max(1, host.clientHeight);
      pan.x -= dx * wpp; pan.y += dy * wpp;
      resize();
    }
    // Returns true when the move was consumed by a pan drag.
    function dragMove(event) {
      if (!drag || drag.id !== event.pointerId || !canPan() || animation) return false;
      if (!drag.panning && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 6) {
        drag.panning = true; pointerStart = null;
        renderer.domElement.style.cursor = 'grabbing';
      }
      if (drag.panning) panBy(event.clientX - drag.x, event.clientY - drag.y);
      drag.x = event.clientX; drag.y = event.clientY;
      return drag.panning;
    }
    const touchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    function onPointerMove(event) {
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 1) { dragMove(event); return; }
        if (touches.size >= 2) {
          const d = touchDist();
          if (pinchDist > 0 && d > 0) applyZoom(zoomFactor * pinchDist / d);
          pinchDist = d;
        }
        return;
      }
      if (dragMove(event)) return;
      if (event.pointerType !== 'mouse' || motionQuery.matches) return;
      const rect = renderer.domElement.getBoundingClientRect();
      target.set(clamp((event.clientX - rect.left) / rect.width) - 0.5, clamp((event.clientY - rect.top) / rect.height) - 0.5);
      const over = open && hit(event)?.object.userData;
      renderer.domElement.style.cursor = !animation && (!open || over?.item || over?.add) ? 'pointer' : canPan() ? 'grab' : 'default';
      invalidate();
    }
    function onWheel(event) {
      event.preventDefault();
      applyZoom(zoomFactor * Math.exp(event.deltaY * 0.0012));
    }
    function onPointerLeave() { target.set(0, 0); invalidate(); }
    function onPointerDown(event) {
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size >= 2) { pinched = true; pointerStart = null; drag = null; pinchDist = touchDist(); return; }
      }
      if (event.isPrimary && event.button === 0) {
        pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
        drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x: event.clientX, y: event.clientY, panning: false };
        if (canPan()) { try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* not capturable */ } }
      }
    }
    function releaseTouch(event) {
      touches.delete(event.pointerId);
      if (touches.size < 2) pinchDist = 0;
      if (!touches.size && pinched) { pinched = false; return true; }
      return pinched;
    }
    function onPointerUp(event) {
      // A pinch never counts as a tap or a page swipe.
      if (releaseTouch(event)) { pointerStart = null; drag = null; return; }
      if (drag?.id === event.pointerId) {
        const panned = drag.panning; drag = null;
        if (panned) { pointerStart = null; renderer.domElement.style.cursor = canPan() ? 'grab' : 'default'; return; }
      }
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
      pointerStart = null;
      if (animation) return;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 45 && open) { turn(dx < 0 ? 1 : -1); return; }
      if (Math.hypot(dx, dy) > 8) return;
      const picked = hit(event)?.object;
      if (!open && picked) toggle();
      else if (open && picked?.userData.item) callbacks.onItem?.(picked.userData.item, rectFor(picked.userData.item.id));
      else if (open && picked?.userData.add) callbacks.onAdd?.();
    }
    function onPointerCancel(event) { releaseTouch(event); pointerStart = null; drag = null; }
    function onContextLost(event) { event.preventDefault(); callbacks.onError?.(new Error('WebGL context lost')); }
    function onMotionChange() { target.set(0, 0); invalidate(); }
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const events = { pointermove: onPointerMove, pointerleave: onPointerLeave, pointerdown: onPointerDown, pointerup: onPointerUp, pointercancel: onPointerCancel, webglcontextlost: onContextLost, wheel: onWheel };
    for (const [name, fn] of Object.entries(events)) renderer.domElement.addEventListener(name, fn, name === 'wheel' ? { passive: false } : undefined);
    motionQuery.addEventListener('change', onMotionChange);
    removeListeners = () => {
      for (const [name, fn] of Object.entries(events)) renderer.domElement.removeEventListener(name, fn);
      motionQuery.removeEventListener('change', onMotionChange);
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host);
    resize();
    renderFrame = function frame(now) {
      raf = 0;
      if (disposed) return;
      const easing = 0.16;
      tilt.lerp(target, easing);
      if (animation) {
        const a = animation;
        const t = a.duration ? clamp((now - a.start) / a.duration) : 1;
        const p = smooth(t);
        if (a.kind === 'cover') {
          openness = THREE.MathUtils.lerp(a.from, a.to, p);
          pose();
        } else {
          const progress = a.dir > 0 ? p : 1 - p;
          // Stack heights are exact at both endpoints; the hinge lifts during transit.
          const z = pageTurnBaseZ(a.fromZ, a.toZ, p, step);
          deform(turningLeaf, progress, z);
        }
        if (t === 1) {
          animation = null;
          if (a.kind === 'page') { spread = a.next; rebuild(); }
          else { openness = a.to; pose(); state(); }
        }
      } else if (tilt.distanceTo(target) > 0.0001) pose();
      renderer.render(scene, camera);
      if (!ready) { ready = true; callbacks.onReady?.(); }
      if (animation || tilt.distanceTo(target) > 0.0001) invalidate();
    };
    function cardMesh(id) {
      for (const leaf of leaves) for (const mesh of leaf.patches) if (mesh.userData.item && mesh.userData.item.id === id) return mesh;
      return null;
    }
    function rectFor(id) {
      const mesh = cardMesh(id); if (!mesh) return null;
      scene.updateMatrixWorld(true);
      mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox, r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        v.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
        const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    }
    function setHidden(id) {
      hiddenId = id;
      for (const leaf of leaves) for (const mesh of leaf.patches) if (mesh.userData.item) mesh.visible = mesh.userData.item.id !== id;
      invalidate();
    }
    // Stand-alone renderer for the pulled-out card: same insert + case materials, real case depth.
    function createInspector(ihost, item) {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.0;
      r.domElement.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; display:block;';
      ihost.appendChild(r.domElement);
      const sc = new THREE.Scene();
      const pm = new THREE.PMREMGenerator(r); const room = new RoomEnvironment();
      const env = pm.fromScene(room, 0.06); room.dispose(); pm.dispose();
      sc.environment = env.texture; sc.environmentIntensity = 0.8;
      sc.add(new THREE.HemisphereLight(0xffffff, 0x555c6a, 0.8));
      const k1 = new THREE.DirectionalLight(0xfff8eb, 2.4); k1.position.set(-3, 5, 8); sc.add(k1);
      const k2 = new THREE.DirectionalLight(0xdce8ff, 0.7); k2.position.set(5, -2, 5); sc.add(k2);
      const FOV = 30, DIST = 10;
      const cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100); cam.position.set(0, 0, DIST);
      const W = 0.742, H = 1.10, T = 0.056, B = 0.006, R = 0.05, IN = 0.007;
      const own = [];
      const keep = x => { own.push(x); return x; };
      const fake = { texture: [], alive: true };
      const { map, mask } = cardTexture(item, Math.max(0, items.indexOf(item)), fake);
      const cm = caseMaterials();
      const g = new THREE.Group(); sc.add(g);
      const plane = keep(new THREE.PlaneGeometry(W, H));
      const front = new THREE.Mesh(plane, keep(insertMaterial(map, mask)));
      front.material.side = THREE.FrontSide; front.position.z = IN; g.add(front);
      // insert back: blank label back + card back, no text
      const bc = document.createElement('canvas'); bc.width = CW * 2; bc.height = CH * 2;
      const c = bc.getContext('2d'); c.scale(2, 2);
      c.save(); c.shadowColor = 'rgba(0,0,0,.2)'; c.shadowBlur = 4; c.shadowOffsetY = 1.5;
      c.fillStyle = '#fafaf8'; rrp(c, LAB.x, LAB.y, LAB.w, LAB.h, 5); c.fill(); c.restore();
      c.lineWidth = 2; c.strokeStyle = '#000'; rrp(c, LAB.x + 1, LAB.y + 1, LAB.w - 2, LAB.h - 2, 4.5); c.stroke();
      c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.18)'; rrp(c, LAB.x + 5, LAB.y + 5, LAB.w - 10, LAB.h - 10, 3); c.stroke();
      c.save(); c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 7; c.shadowOffsetY = 2.5;
      c.fillStyle = '#fff'; rrp(c, CARD.x, CARD.y, CARD.w, CARD.h, 7); c.fill(); c.restore();
      c.save(); rrp(c, CARD.x, CARD.y, CARD.w, CARD.h, 7); c.clip();
      c.fillStyle = '#f0f0f0'; rrp(c, CARD.x + 10, CARD.y + 10, CARD.w - 20, CARD.h - 20, 4); c.fill();
      c.lineWidth = 1.5; c.strokeStyle = '#000'; c.stroke();
      c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.18)'; rrp(c, CARD.x + 18, CARD.y + 18, CARD.w - 36, CARD.h - 36, 2); c.stroke();
      c.globalCompositeOperation = 'multiply'; c.globalAlpha = .28;
      c.fillStyle = pearlGrad(c, CARD.x, CARD.y, CARD.x + CARD.w * .75, CARD.y + CARD.h, 3); c.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
      c.restore();
      c.lineWidth = 2.5; c.strokeStyle = '#111'; rrp(c, CARD.x + 1.25, CARD.y + 1.25, CARD.w - 2.5, CARD.h - 2.5, 6); c.stroke();
      const bmap = keep(new THREE.CanvasTexture(bc)); bmap.colorSpace = THREE.SRGBColorSpace; bmap.anisotropy = 8;
      const back = new THREE.Mesh(plane, keep(new THREE.MeshPhysicalMaterial({ map: bmap, roughness: 0.48, clearcoat: 0.2, clearcoatRoughness: 0.35, iridescence: .5, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 560], specularIntensity: 0.55, transparent: true, alphaTest: 0.01 })));
      back.rotation.y = Math.PI; back.position.z = -IN; g.add(back);
      // case shell
      const sw = W - 2 * B, sh = H - 2 * B, sr = R - B, shape = new THREE.Shape();
      shape.moveTo(-sw / 2 + sr, -sh / 2);
      shape.lineTo(sw / 2 - sr, -sh / 2); shape.absarc(sw / 2 - sr, -sh / 2 + sr, sr, -Math.PI / 2, 0);
      shape.lineTo(sw / 2, sh / 2 - sr); shape.absarc(sw / 2 - sr, sh / 2 - sr, sr, 0, Math.PI / 2);
      shape.lineTo(-sw / 2 + sr, sh / 2); shape.absarc(-sw / 2 + sr, sh / 2 - sr, sr, Math.PI / 2, Math.PI);
      shape.lineTo(-sw / 2, -sh / 2 + sr); shape.absarc(-sw / 2 + sr, -sh / 2 + sr, sr, Math.PI, Math.PI * 1.5);
      const bg = keep(new THREE.ExtrudeGeometry(shape, { depth: T - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 3, curveSegments: 14 }));
      bg.translate(0, 0, -(T - 2 * B) / 2);
      const tint = new THREE.Mesh(bg, keep(new THREE.MeshPhysicalMaterial({ color: '#e2eaf0', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })));
      tint.renderOrder = 1; g.add(tint);
      const gloss = new THREE.Mesh(bg, cm.gloss); gloss.renderOrder = 3; g.add(gloss);
      const rimF = new THREE.Mesh(plane, cm.rim); rimF.position.z = T / 2 + 0.0008; rimF.renderOrder = 2; g.add(rimF);
      const rimB = new THREE.Mesh(plane, cm.rim); rimB.position.z = -(T / 2 + 0.0008); rimB.rotation.y = Math.PI; rimB.renderOrder = 2; g.add(rimB);
      const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
      let last = null;
      function size() {
        const w = Math.max(1, ihost.clientWidth), h = Math.max(1, ihost.clientHeight);
        r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
        return { wpp: 2 * DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) / h };
      }
      let dims = size();
      const onR = () => { dims = size(); if (last) setPose(last); };
      window.addEventListener('resize', onR);
      function setPose(p) {
        last = p;
        const { wpp } = dims, d = Math.PI / 180;
        g.position.set(p.x * wpp, -(p.y - 28) * wpp, 0);
        g.scale.setScalar(152 * p.s * wpp / W);
        g.rotation.set(-p.rx * d, p.ry * d, 0, 'XYZ');
        r.render(sc, cam);
      }
      function hit(cx, cy) {
        const b = r.domElement.getBoundingClientRect();
        ptr.set((cx - b.left) / b.width * 2 - 1, -(cy - b.top) / b.height * 2 + 1);
        ray.setFromCamera(ptr, cam);
        return ray.intersectObject(tint, false).length > 0;
      }
      function disposeI() {
        window.removeEventListener('resize', onR);
        own.forEach(x => x.dispose());
        fake.texture.forEach(t => { textures.delete(t); t.dispose(); });
        env.dispose(); r.dispose(); r.domElement.remove();
      }
      return { setPose, hit, dispose: disposeI };
    }
    const zoomBy = mult => applyZoom(zoomFactor / mult);
    const resetZoom = () => { pan.set(0, 0); applyZoom(1); resize(); };
    return { setItems, toggle, turn, dispose, rectFor, setHidden, createInspector, zoomBy, resetZoom };
  } catch (error) {
    dispose();
    throw error;
  }
}
