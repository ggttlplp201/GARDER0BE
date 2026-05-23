// Museum.jsx — Garderobe museum room view
import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';

const FONT_DISPLAY = "'Inter Tight', -apple-system, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
const INK = '#0a0a0a';

const WALL_X = 380;
const FLOOR_Y = 280;
const CEIL_Y = -360;
const FRAME_CY = -40;
const FRAME_W = 200;
const FRAME_H = 290;
const ROW_SPACING = 460;
const STAGGER = 230;
const FRONT_GAP = 380;
const BACK_PAD = 700;
const WALL_THICKNESS = 4;
const PERSPECTIVE = 900;
const SCROLL_PER_DEPTH = 1.4;
const CAMERA_START = 430;
const MIN_SCROLL = Math.round(CAMERA_START / SCROLL_PER_DEPTH);

const COLOR_WALL = '#ebe6d7';
const COLOR_FLOOR = '#d8d3c5';
const COLOR_CEILING = '#fbfaf5';
const COLOR_DOORWAY = '#0a0a0a';
const WALL_BG = `url('/concrete-wall.jpg') repeat 0 0 / 600px 600px, ${COLOR_WALL}`;
// Ceiling: white panel with 3 warm fluorescent strip lights running corridor length
const CEIL_BG = `linear-gradient(90deg,
  #e4e4e4 0px,   #e4e4e4 172px,
  #fffbe8 177px, #ffffff 189px, #fffbe8 201px,
  #e4e4e4 206px, #e4e4e4 366px,
  #fffbe8 371px, #ffffff 383px, #fffbe8 395px,
  #e4e4e4 400px, #e4e4e4 558px,
  #fffbe8 563px, #ffffff 575px, #fffbe8 587px,
  #e4e4e4 592px, #e4e4e4 760px
)`;

const MuseumFrame = ({ item, side, depth, onClick, imageUrl }) => {
  const [hover, setHover] = useState(false);

  const x = side * (WALL_X - WALL_THICKNESS);
  const y = FRAME_CY;
  const z = -depth;
  const baseRotY = side * -90;
  const HOVER_ANGLE = 30;
  const hoverRotY = side * -HOVER_ANGLE;
  const rotY = hover ? hoverRotY : baseRotY;
  const cosTilt = Math.cos(HOVER_ANGLE * Math.PI / 180);
  const wallOff = hover ? (FRAME_W / 2) * cosTilt + 30 : 0;
  const liftZ = hover ? 120 : 0;
  const scale = hover ? 1.08 : 1;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        left: -FRAME_W / 2,
        top: -FRAME_H / 2,
        width: FRAME_W,
        height: FRAME_H,
        transform:
          `translate3d(${x - side * wallOff}px, ${y}px, ${z + liftZ}px) ` +
          `rotateY(${rotY}deg) scale(${scale})`,
        transformStyle: 'preserve-3d',
        transition:
          'transform 520ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'filter 380ms ease-out',
        cursor: 'pointer',
        background: '#1a1a1a',
        padding: 12,
        border: '5px solid #0e0e0e',
        boxSizing: 'border-box',
        boxShadow:
          '0 0 0 1px rgba(0,0,0,0.45) inset, ' +
          '0 0 22px rgba(0,0,0,0.35), ' +
          '0 16px 30px rgba(0,0,0,0.22)',
        filter: hover
          ? 'brightness(1.15) drop-shadow(0 0 26px rgba(255,250,235,0.4))'
          : 'brightness(1)',
        willChange: 'transform',
      }}
    >
      <div style={{ width: '100%', height: '100%', background: '#f5f2ea', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, margin: 10, overflow: 'hidden', position: 'relative' }}>
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
              fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em',
              textTransform: 'uppercase',
              position: 'relative', overflow: 'hidden',
            }}>
              <span style={{ position: 'relative', zIndex: 2, padding: '0 12px', textAlign: 'center' }}>
                {(item.brand || '—').split(' ')[0]}
              </span>
            </div>
          )}
        </div>
        <div style={{ padding: '6px 10px 8px', borderTop: '1px solid rgba(10,10,10,0.12)' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 8, letterSpacing: '0.18em', opacity: 0.55 }}>
            № {item.cat} · {item.brand}
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 12, fontWeight: 500, lineHeight: 1.15, marginTop: 2, color: INK }}>
            {item.name}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: -22, left: '50%', width: 2, height: 22, background: 'rgba(0,0,0,0.4)', transform: 'translateX(-50%)' }} />
      <div style={{ position: 'absolute', top: -26, left: '50%', width: 6, height: 6, borderRadius: '50%', background: '#0e0e0e', transform: 'translateX(-50%)', boxShadow: '0 2px 3px rgba(0,0,0,0.3)' }} />
    </div>
  );
};

export default function Museum({ items = [], onItem, hideOverlays = false, onProgress }) {
  const scrollRef = useRef(null);
  const [cameraZ, setCameraZ] = useState(CAMERA_START);

  const pairCount = Math.max(1, Math.ceil(items.length / 2));
  const lastFrameDepth = FRONT_GAP + (pairCount - 1) * ROW_SPACING + STAGGER;
  const ROOM_DEPTH = lastFrameDepth + BACK_PAD;

  const scrollLen = Math.round(ROOM_DEPTH / SCROLL_PER_DEPTH) + 700;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.round(CAMERA_START / SCROLL_PER_DEPTH);
  }, []);

  const onScroll = (e) => {
    if (e.target.scrollTop < MIN_SCROLL) {
      e.target.scrollTop = MIN_SCROLL;
      return;
    }
    const t = e.target.scrollTop;
    const z = Math.min(ROOM_DEPTH - 200, t * SCROLL_PER_DEPTH);
    setCameraZ(z);
  };

  const placements = useMemo(() => (
    items.map((item, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const depth = FRONT_GAP + row * ROW_SPACING + (side === 1 ? STAGGER : 0);
      return { item, side, depth, idx: i };
    })
  ), [items]);

  const progress = Math.min(1, cameraZ / Math.max(1, ROOM_DEPTH - 200));
  const nearest = placements.reduce((best, f) => {
    const d = Math.abs(f.depth - cameraZ - 200);
    return (!best || d < best.dist) ? { ...f, dist: d } : best;
  }, null);

  useEffect(() => {
    onProgress?.({ progress, nearest });
  }, [cameraZ, onProgress]); // nearest and progress derived from cameraZ; object identity not stable

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
      width: '100%', height: '100%',
      backgroundImage: `url('/concrete-wall.jpg')`,
      backgroundRepeat: 'repeat',
      backgroundSize: '600px 600px',
      backgroundColor: COLOR_WALL,
    }}>
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

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflow: 'auto', overflowX: 'hidden', position: 'relative' }}
      >
        <div style={{ height: scrollLen, position: 'relative' }}>
          <div style={{
            position: 'sticky', top: 0,
            width: '100%', height: '100vh',
            perspective: `${PERSPECTIVE}px`,
            perspectiveOrigin: '50% 42%',
            overflow: 'hidden',
            backgroundImage: `url('/concrete-wall.jpg')`,
            backgroundRepeat: 'repeat',
            backgroundSize: '600px 600px',
            backgroundColor: COLOR_WALL,
          }}>
            <div style={{
              position: 'absolute', left: '50%', top: '50%',
              width: 0, height: 0,
              transformStyle: 'preserve-3d',
              transform: `translate3d(0, 0, ${cameraZ}px)`,
            }}>
              <div style={{
                position: 'absolute',
                left: -WALL_X, top: 0,
                width: WALL_X * 2, height: ROOM_DEPTH,
                transformOrigin: '0 0',
                transform: `translate3d(0, ${FLOOR_Y}px, 0) rotateX(-90deg)`,
                backgroundImage: `url('/concrete-floor.jpg')`,
                backgroundRepeat: 'repeat',
                backgroundPosition: '0 0',
                backgroundSize: '500px 500px',
                backgroundColor: COLOR_FLOOR,
              }} />
              <div style={{
                position: 'absolute',
                left: -WALL_X, top: 0,
                width: WALL_X * 2, height: ROOM_DEPTH,
                transformOrigin: '0 0',
                transform: `translate3d(0, ${CEIL_Y}px, 0) rotateX(-90deg)`,
                backgroundImage: `url('/ceiling.jpg')`,
                backgroundRepeat: 'repeat',
                backgroundSize: '600px 600px',
                backgroundColor: COLOR_CEILING,
              }} />
              <div style={{
                position: 'absolute',
                left: 0, top: CEIL_Y,
                width: ROOM_DEPTH, height: FLOOR_Y - CEIL_Y,
                transformOrigin: '0 0',
                transform: `translate3d(${-WALL_X}px, 0, 0) rotateY(90deg)`,
                background: WALL_BG,
              }} />
              <div style={{
                position: 'absolute',
                left: 0, top: CEIL_Y,
                width: ROOM_DEPTH, height: FLOOR_Y - CEIL_Y,
                transformOrigin: '0 0',
                transform: `translate3d(${WALL_X}px, 0, ${-ROOM_DEPTH}px) rotateY(-90deg)`,
                background: WALL_BG,
              }} />
              <div style={{
                position: 'absolute',
                left: -WALL_X, top: CEIL_Y,
                width: WALL_X * 2, height: FLOOR_Y - CEIL_Y,
                transform: `translate3d(0, 0, ${-ROOM_DEPTH}px)`,
                background: WALL_BG,
              }} />
              {placements.map((f) => (
                <MuseumFrame
                  key={f.item.id}
                  item={f.item}
                  side={f.side}
                  depth={f.depth}
                  onClick={() => onItem && onItem(f.item)}
                  imageUrl={f.item.imageUrl}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
