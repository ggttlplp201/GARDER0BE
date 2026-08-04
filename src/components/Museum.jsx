// Museum.jsx — Garderobe museum room view
import React, { useState, useRef, useMemo, useEffect, useCallback, memo } from 'react';

const FONT_DISPLAY = "'Inter Tight', -apple-system, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const INK = '#0a0a0a';

const RENDER_SCALE = 2;
const WALL_THICKNESS = 4;
const PERSPECTIVE = 900;
const BACK_PAD = 700;

// Fallback colors match each texture's average, so a segment whose texture
// tiles haven't rasterized yet (fast back-scroll) is indistinguishable
// instead of flashing a contrasting patch
const COLOR_WALL = '#5f6366';
const COLOR_FLOOR = '#676c6f';
const COLOR_CEILING = '#f5f5f5';
const WALL_BG = `url('/concrete-wall.jpg') repeat 0 0 / 600px 600px, ${COLOR_WALL}`;

// Plane segment lengths — must be multiples of the texture tile size
// (floor tiles at 500px, wall/ceiling at 600px) so segment seams land
// exactly on tile boundaries and the repeat stays continuous.
const FLOOR_SEG = 1000;
const WALL_SEG = 1200;

function planeSegments(total, seg) {
  const out = [];
  for (let off = 0; off < total; off += seg) {
    out.push({ off, len: Math.min(seg, total - off) });
  }
  return out;
}

// Responsive geometry — computed once per mount
function getLayout() {
  const W = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const mobile = W < 640;

  const wallX      = mobile ? Math.max(110, Math.floor(W * 0.37)) : 380;
  const floorY     = mobile ? 160  : 280;
  const ceilY      = mobile ? -200 : -360;
  const frameCY    = mobile ? -20  : -40;
  const frameW     = mobile ? 110  : 200;
  const frameH     = mobile ? 160  : 290;
  const frontGap   = mobile ? 360  : 380;
  const rowSpacing = mobile ? 300  : 460;
  const stagger    = mobile ? 150  : 230;

  // Camera deep enough that projected wall edge fills half-viewport
  const needed = Math.ceil(PERSPECTIVE * (1 - (wallX * 2 - 30) / W));
  const cameraStart = Math.max(mobile ? 200 : 430, needed);

  // Hide frames this far behind the camera: past the point where they have
  // fully exited the viewport (+150 slack for hover/tilt offsets), but always
  // before the perspective singularity at z = PERSPECTIVE where the projected
  // layer size explodes and Chrome thrashes re-rasterizing on back-scroll.
  const cullBehind = Math.min(
    PERSPECTIVE + frameW / 2 - (2 * wallX * PERSPECTIVE) / W + 150,
    PERSPECTIVE - 80,
  );

  return { wallX, floorY, ceilY, frameCY, frameW, frameH, frontGap, rowSpacing, stagger, cameraStart, cullBehind, mobile };
}

const MuseumFrame = memo(({ item, side, depth, onClick, imageUrls = [], layout, cameraZ }) => {
  const [hover, setHover] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const offsetRef = useRef(0);
  const { wallX, frameCY, frameW, frameH, cullBehind, mobile } = layout;

  // Random per-frame stagger for the image cycle — assigned in an effect
  // (before the cycle effect below) so render stays pure
  useEffect(() => {
    offsetRef.current = Math.floor(Math.random() * 2000);
  }, []);

  // Fully behind the camera — keep mounted (img stays decoded) but invisible,
  // so the layer never sits near the perspective singularity.
  const culled = cameraZ - depth > cullBehind;
  const culledRef = useRef(false);
  useEffect(() => {
    culledRef.current = culled;
  }, [culled]);

  // Pre-decode every cycle image so src swaps and re-entry after culling
  // never paint an undecoded (blank) frame.
  // Keyed on the joined URLs, not the array identity: a caller that rebuilds
  // the array each render would otherwise re-decode every image of every frame
  // on every keystroke, which is enough to OOM the tab on mobile Safari.
  const urlKey = imageUrls.join('|');
  useEffect(() => {
    urlKey.split('|').filter(Boolean).forEach(url => {
      const im = new Image();
      im.src = url;
      im.decode?.().catch(() => {});
    });
  }, [urlKey]);

  // Auto-cycle images when there are multiple (paused while culled so we
  // never swap to a not-yet-decoded image right before re-entry)
  useEffect(() => {
    if (imageUrls.length <= 1) return;
    let intervalId;
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        if (!culledRef.current) setImgIdx(i => (i + 1) % imageUrls.length);
      }, 2500);
    }, offsetRef.current);
    return () => { clearTimeout(timeoutId); clearInterval(intervalId); };
  }, [imageUrls.length]);  

  const imageUrl = imageUrls[imgIdx] || null;

  // Mobile: tilt frame toward viewer symmetrically as camera approaches
  const tiltAngle = mobile ? (() => {
    const dist = Math.abs(depth - cameraZ);
    const maxTilt = 62;
    const tiltRange = 320;
    if (dist > tiltRange) return 0;
    return maxTilt * (1 - dist / tiltRange);
  })() : 0;

  // Push frame away from wall to prevent clipping when tilted
  // side * tiltAngle is the corrected rotation: left wall (side=-1) subtracts, right wall (side=1) adds
  const tiltWallOff = mobile ? (frameW / 2) * Math.sin(tiltAngle * Math.PI / 180) : 0;

  const x = side * (wallX - WALL_THICKNESS);
  const y = frameCY;
  const z = -depth;
  const baseRotY = side * -90;
  const HOVER_ANGLE = 30;
  const hoverRotY = side * -HOVER_ANGLE;
  const rotY = hover ? hoverRotY : baseRotY;
  const cosTilt = Math.cos(HOVER_ANGLE * Math.PI / 180);
  const wallOff = hover ? (frameW / 2) * cosTilt + 30 : 0;
  const liftZ = hover ? 120 : 0;
  const scale = hover ? 1.08 : 1;

  // Internal sizes are 2× visual (RENDER_SCALE trick)
  const r = frameW / 200;
  const pad       = Math.round(24 * r);
  const borderW   = Math.max(4, Math.round(10 * r));
  const margin    = Math.round(20 * r);
  const fontMono  = Math.max(12, Math.round(16 * r));
  const fontDisp  = Math.max(18, Math.round(24 * r));
  const capPad    = `${Math.round(12 * r)}px ${Math.round(20 * r)}px ${Math.round(16 * r)}px`;
  const hangH     = Math.round(44 * r);
  const knobS     = Math.max(6, Math.round(12 * r));

  return (
    <div
      onClick={() => onClick?.(item)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        visibility: culled ? 'hidden' : 'visible',
        left: -(frameW * RENDER_SCALE) / 2,
        top: -(frameH * RENDER_SCALE) / 2,
        width: frameW * RENDER_SCALE,
        height: frameH * RENDER_SCALE,
        transform:
          `translate3d(${x - side * wallOff - side * tiltWallOff}px, ${y}px, ${z + liftZ}px) ` +
          `rotateY(${rotY + side * tiltAngle}deg) scale(${scale / RENDER_SCALE})`,
        transition: mobile
          ? 'none'
          : 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), filter 380ms ease-out',
        cursor: 'pointer',
        background: '#1a1a1a',
        padding: pad,
        border: `${borderW}px solid #0e0e0e`,
        boxSizing: 'border-box',
        boxShadow:
          '0 0 0 2px rgba(0,0,0,0.45) inset, ' +
          '0 0 22px rgba(0,0,0,0.35), ' +
          '0 16px 30px rgba(0,0,0,0.22)',
        filter: hover
          ? 'brightness(1.15) drop-shadow(0 0 26px rgba(255,250,235,0.4))'
          : 'brightness(1)',
      }}
    >
      <div style={{ width: '100%', height: '100%', background: '#f5f2ea', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, margin, overflow: 'hidden', position: 'relative' }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%',
              background: (item.color || '#888888') + '18',
              color: item.color || '#888888',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_MONO, fontSize: fontMono * 1.25, letterSpacing: '0.18em',
              textTransform: 'uppercase',
              overflow: 'hidden',
            }}>
              <span style={{ padding: `0 ${Math.round(24 * r)}px`, textAlign: 'center' }}>
                {(item.brand || '—').split(' ')[0]}
              </span>
            </div>
          )}
        </div>
        <div style={{ padding: capPad, borderTop: `${Math.max(1, Math.round(2 * r))}px solid rgba(10,10,10,0.12)` }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: fontMono, letterSpacing: '0.18em', opacity: 0.55 }}>
            № {item.cat} · {item.brand}
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: fontDisp, fontWeight: 500, lineHeight: 1.15, marginTop: Math.round(4 * r), color: INK }}>
            {item.name}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: -hangH, left: '50%', width: Math.max(2, Math.round(4 * r)), height: hangH, background: 'rgba(0,0,0,0.4)', transform: 'translateX(-50%)' }} />
      <div style={{ position: 'absolute', top: -(hangH + knobS / 2 + 2), left: '50%', width: knobS, height: knobS, borderRadius: '50%', background: '#0e0e0e', transform: 'translateX(-50%)', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }} />
    </div>
  );
});

export default function Museum({ items = [], onItem, hideOverlays = false, onProgress }) {
  const containerRef = useRef(null);

  // Compute layout once per mount via lazy ref
  const [layout] = useState(getLayout);
  const { wallX, floorY, ceilY, frontGap, rowSpacing, stagger, cameraStart } = layout;

  const [cameraZ, setCameraZ] = useState(cameraStart);

  const pairCount = Math.max(1, Math.ceil(items.length / 2));
  const lastFrameDepth = frontGap + (pairCount - 1) * rowSpacing + stagger;
  const ROOM_DEPTH = lastFrameDepth + BACK_PAD;

  const clampZ = useCallback((z) =>
    Math.min(ROOM_DEPTH - 200, Math.max(cameraStart, z)),
  [cameraStart, ROOM_DEPTH]);

  // Filtering shrinks the room — pull the camera back inside its new bounds
  // so a search that drops the far frames doesn't strand you past the wall
  useEffect(() => {
    setCameraZ(z => clampZ(z));
  }, [clampZ]);

  // Wheel (desktop / trackpad)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setCameraZ(z => clampZ(z + e.deltaY * 0.8));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampZ]);

  // Touch (mobile) with momentum
  const touchRef = useRef({ y: 0, vel: 0, raf: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const touch = touchRef.current;

    const onTouchStart = (e) => {
      cancelAnimationFrame(touchRef.current.raf);
      touchRef.current.y = e.touches[0].clientY;
      touchRef.current.vel = 0;
    };

    const onTouchMove = (e) => {
      e.preventDefault();
      const dy = touchRef.current.y - e.touches[0].clientY;
      touchRef.current.y = e.touches[0].clientY;
      touchRef.current.vel = dy;
      setCameraZ(z => clampZ(z + dy * 1.5));
    };

    const onTouchEnd = () => {
      const decay = () => {
        touchRef.current.vel *= 0.92;
        if (Math.abs(touchRef.current.vel) < 0.4) return;
        setCameraZ(z => clampZ(z + touchRef.current.vel * 1.5));
        touchRef.current.raf = requestAnimationFrame(decay);
      };
      touchRef.current.raf = requestAnimationFrame(decay);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove',  onTouchMove,  { passive: false });
    el.addEventListener('touchend',   onTouchEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove',  onTouchMove);
      el.removeEventListener('touchend',   onTouchEnd);
      cancelAnimationFrame(touch.raf);
    };
  }, [clampZ]);

  const placements = useMemo(() => (
    items.map((item, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const depth = frontGap + row * rowSpacing + (side === 1 ? stagger : 0);
      return { item, side, depth, idx: i };
    })
  ), [items, frontGap, rowSpacing, stagger]);

  const progress = Math.min(1, cameraZ / Math.max(1, ROOM_DEPTH - 200));
  const nearest = placements.reduce((best, f) => {
    const d = Math.abs(f.depth - cameraZ);
    return (!best || d < best.dist) ? { ...f, dist: d } : best;
  }, null);

  useEffect(() => {
    onProgress?.({ progress, nearest });
  }, [cameraZ, onProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        width: '100%', height: '100%',
        touchAction: 'none',
        userSelect: 'none',
        backgroundImage: `url('/concrete-wall.jpg')`,
        backgroundRepeat: 'repeat',
        backgroundSize: '600px 600px',
        backgroundColor: COLOR_WALL,
      }}
    >
      {!hideOverlays && (
        <div style={{
          position: 'absolute', top: 14, left: 0, right: 0, zIndex: 50,
          textAlign: 'center', pointerEvents: 'none',
          fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.22em', opacity: 0.7,
        }}>
          {(progress * 100).toFixed(0).padStart(2, '0')}%
        </div>
      )}

      {!hideOverlays && nearest && (
        <div style={{
          position: 'absolute', bottom: 22, left: 0, right: 0, zIndex: 50,
          textAlign: 'center', pointerEvents: 'none',
          fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 500,
          letterSpacing: '-0.01em', color: INK,
        }}>
          {nearest.item.name}
        </div>
      )}

      {/*
        The perspective div is the ONLY overflow:hidden ancestor of preserve-3d.
        No overflow:auto above it — this is what makes iOS Safari render the 3D scene.
      */}
      <div style={{
        position: 'absolute', inset: 0,
        perspective: `${PERSPECTIVE}px`,
        perspectiveOrigin: '50% 42%',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          width: 0, height: 0,
          transformStyle: 'preserve-3d',
          transform: `translate3d(0, 0, ${cameraZ}px)`,
        }}>
          {/*
            Room planes are split into segments (multiples of the texture tile
            size, so the repeat stays seamless). One room-length layer forces
            Chrome to re-rasterize giant near-camera tiles on back-scroll,
            which flashes the background color; small layers keep raster work
            bounded and let fully-passed segments drop out entirely.
          */}
          {/* Floor */}
          {planeSegments(ROOM_DEPTH, FLOOR_SEG).map(({ off, len }) => (
            <div key={`floor-${off}`} style={{
              position: 'absolute',
              left: -wallX, top: 0,
              width: wallX * 2, height: len,
              transformOrigin: '0 0',
              transform: `translate3d(0, ${floorY}px, ${-off}px) rotateX(-90deg)`,
              backgroundImage: `url('/concrete-floor.jpg')`,
              backgroundRepeat: 'repeat',
              backgroundSize: '500px 500px',
              backgroundColor: COLOR_FLOOR,
            }} />
          ))}
          {/* Ceiling */}
          {planeSegments(ROOM_DEPTH, WALL_SEG).map(({ off, len }) => (
            <div key={`ceil-${off}`} style={{
              position: 'absolute',
              left: -wallX, top: 0,
              width: wallX * 2, height: len,
              transformOrigin: '0 0',
              transform: `translate3d(0, ${ceilY}px, ${-off}px) rotateX(-90deg)`,
              backgroundImage: `url('/ceiling.jpg')`,
              backgroundRepeat: 'repeat',
              backgroundSize: '600px 600px',
              backgroundColor: COLOR_CEILING,
            }} />
          ))}
          {/* Left wall — segments run front-to-back (+x maps to −z) */}
          {planeSegments(ROOM_DEPTH, WALL_SEG).map(({ off, len }) => (
            <div key={`lwall-${off}`} style={{
              position: 'absolute',
              left: 0, top: ceilY,
              width: len, height: floorY - ceilY,
              transformOrigin: '0 0',
              transform: `translate3d(${-wallX}px, 0, ${-off}px) rotateY(90deg)`,
              background: WALL_BG,
            }} />
          ))}
          {/* Right wall — segments run back-to-front (+x maps to +z), matching
              the original texture phase which starts at the back of the room */}
          {planeSegments(ROOM_DEPTH, WALL_SEG).map(({ off, len }) => (
            <div key={`rwall-${off}`} style={{
              position: 'absolute',
              left: 0, top: ceilY,
              width: len, height: floorY - ceilY,
              transformOrigin: '0 0',
              transform: `translate3d(${wallX}px, 0, ${-ROOM_DEPTH + off}px) rotateY(-90deg)`,
              background: WALL_BG,
            }} />
          ))}
          {/* Back wall */}
          <div style={{
            position: 'absolute',
            left: -wallX, top: ceilY,
            width: wallX * 2, height: floorY - ceilY,
            transform: `translate3d(0, 0, ${-ROOM_DEPTH}px)`,
            background: WALL_BG,
          }} />
          {placements.map((f) => (
            <MuseumFrame
              key={f.item.id}
              item={f.item}
              side={f.side}
              depth={f.depth}
              layout={layout}
              cameraZ={cameraZ}
              onClick={onItem}
              imageUrls={f.item.imageUrls || []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
