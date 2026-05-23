# Museum Wardrobe View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the RACK/GRID/LIST wardrobe view with a CSS-3D museum corridor as the primary browsing mode, using a floating ghost HUD for controls.

**Architecture:** `Museum.jsx` (new) renders a scroll-driven 3D corridor with item photos in frames; `WardrobeView.jsx` is rewritten to use Museum as the default mode with a floating ghost HUD replacing the old toolbar; GRID and LIST remain as secondary modes. `AsciiBackground.jsx` already exists in the project and is already used by `AuthScreen.jsx` — no changes needed there.

**Tech Stack:** React 18, CSS-3D transforms (perspective + rotateY + translate3d), inline styles in Museum, CSS classes in App.css for HUD/bottom bar.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/Museum.jsx` | Create | 3D corridor; accepts `hideOverlays` + `onProgress` props; renders item photos |
| `src/components/WardrobeView.jsx` | Rewrite | Ghost HUD; Museum/GRID/LIST modes; bottom status bar; no more RACK |
| `src/App.css` | Append | `.museum-wrap`, `.museum-hud`, `.museum-hud--static`, `.museum-hud-search`, `.museum-hud-select`, `.museum-hud-add`, `.museum-bottom`, `.museum-stats`, `.museum-item-name`, `.museum-progress` |

---

## Task 1: Create Museum.jsx

**Files:**
- Create: `src/components/Museum.jsx`

Source: `/Users/leon/Downloads/garderobe-handoff/handoff/Museum.jsx`  
Four modifications from the handoff:
1. Add `useEffect` to the React import
2. `MuseumFrame` gets an `imageUrl` prop; renders `<img>` when present, colored placeholder when not
3. `Museum` gets `hideOverlays` boolean prop (default `false`) — skips built-in top/bottom overlays when true
4. `Museum` gets `onProgress` callback prop — fires `{ progress, nearest }` via `useEffect` whenever `cameraZ` changes

- [ ] **Step 1.1: Create the file**

Create `src/components/Museum.jsx` with this exact content:

```jsx
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

const COLOR_WALL = '#ebe6d7';
const COLOR_FLOOR = '#d8d3c5';
const COLOR_CEILING = '#fbfaf5';
const COLOR_DOORWAY = '#0a0a0a';

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
              background: item.color + '18',
              color: item.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.18em',
              textTransform: 'uppercase',
              position: 'relative', overflow: 'hidden',
            }}>
              <span style={{ position: 'relative', zIndex: 2, padding: '0 12px', textAlign: 'center' }}>
                {item.brand.split(' ')[0]}
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
  const [cameraZ, setCameraZ] = useState(0);

  const pairCount = Math.max(1, Math.ceil(items.length / 2));
  const lastFrameDepth = FRONT_GAP + (pairCount - 1) * ROW_SPACING + STAGGER;
  const ROOM_DEPTH = lastFrameDepth + BACK_PAD;

  const SCROLL_PER_DEPTH = 1.4;
  const scrollLen = Math.round(ROOM_DEPTH / SCROLL_PER_DEPTH) + 700;

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const onScroll = (e) => {
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
    if (onProgress) onProgress({ progress, nearest });
  }, [cameraZ]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
      width: '100%', height: '100vh',
      background: COLOR_FLOOR,
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
                transform: `translate3d(0, ${FLOOR_Y}px, 0) rotateX(90deg)`,
                background: COLOR_FLOOR,
              }} />
              <div style={{
                position: 'absolute',
                left: -WALL_X, top: 0,
                width: WALL_X * 2, height: ROOM_DEPTH,
                transformOrigin: '0 0',
                transform: `translate3d(0, ${CEIL_Y}px, 0) rotateX(-90deg)`,
                background: COLOR_CEILING,
              }} />
              <div style={{
                position: 'absolute',
                left: 0, top: CEIL_Y,
                width: ROOM_DEPTH, height: FLOOR_Y - CEIL_Y,
                transformOrigin: '0 0',
                transform: `translate3d(${-WALL_X}px, 0, 0) rotateY(90deg)`,
                background: COLOR_WALL,
              }} />
              <div style={{
                position: 'absolute',
                left: 0, top: CEIL_Y,
                width: ROOM_DEPTH, height: FLOOR_Y - CEIL_Y,
                transformOrigin: '0 0',
                transform: `translate3d(${WALL_X}px, 0, ${-ROOM_DEPTH}px) rotateY(-90deg)`,
                background: COLOR_WALL,
              }} />
              <div style={{
                position: 'absolute',
                left: -WALL_X, top: CEIL_Y,
                width: WALL_X * 2, height: FLOOR_Y - CEIL_Y,
                transform: `translate3d(0, 0, ${-ROOM_DEPTH}px)`,
                background: COLOR_WALL,
              }}>
                <div style={{
                  position: 'absolute',
                  left: '50%', bottom: 0, transform: 'translateX(-50%)',
                  width: 160, height: 240,
                  background: COLOR_DOORWAY,
                }}>
                  <div style={{
                    position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center',
                    color: '#f5f2ea', fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.2em', opacity: 0.7,
                  }}>ROOM 02 →</div>
                </div>
              </div>
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
```

- [ ] **Step 1.2: Verify the file exists and has no syntax errors**

Run: `cd "/Users/leon/Library/Mobile Documents/com~apple~CloudDocs/Development/GARDEROBE-react" && node --input-type=module < /dev/null; npx --yes acorn --ecma2020 --module src/components/Museum.jsx > /dev/null && echo "OK"`

Expected: `OK` (or just confirm file was created — Vite will catch syntax errors at build time in step 3.1)

---

## Task 2: Rewrite WardrobeView.jsx

**Files:**
- Modify: `src/components/WardrobeView.jsx`

Full replacement. Removes: `RackCard`, `Hanger` SVG, `isGyroActive` import, RACK mode, old stat-bar, old toolbar.  
Adds: Museum import, `museumProgress`/`museumNearest` state, ghost HUD, Museum mode rendering, bottom status bar.  
Keeps: `useConfirm`, `catNum`, GRID mode, LIST mode (unchanged internally).

- [ ] **Step 2.1: Replace the entire file**

Write `src/components/WardrobeView.jsx` with:

```jsx
import { useState, useRef } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { ITEM_TYPES } from '../lib/constants';
import ItemCard from './ItemCard';
import Museum from './Museum';

function useConfirm() {
  const [pending, setPending] = useState(null);
  const timer = useRef(null);
  function arm(id) {
    clearTimeout(timer.current);
    setPending(id);
    timer.current = setTimeout(() => setPending(null), 2500);
  }
  function disarm() { clearTimeout(timer.current); setPending(null); }
  return { pending, arm, disarm };
}

function catNum(idx) {
  return String(idx + 1).padStart(3, '0');
}

const TYPES = ['ALL', ...ITEM_TYPES];

export default function WardrobeView({ items, loading, loadError, onRetry, onItemClick, onAdd, onEdit, onRemove }) {
  const [mode, setMode] = useState('MUSEUM');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [museumProgress, setMuseumProgress] = useState(0);
  const [museumNearest, setMuseumNearest] = useState(null);
  const confirm = useConfirm();

  const filtered = items.filter(it => {
    if (search) {
      const q = search.toLowerCase();
      if (!it.name?.toLowerCase().includes(q) && !it.brand?.toLowerCase().includes(q)) return false;
    }
    if (filterType !== 'ALL' && it.type !== filterType) return false;
    return true;
  });

  const totalValue = items
    .filter(i => i.status !== 'wishlist')
    .reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const brands = new Set(items.map(i => i.brand).filter(Boolean));
  const grails = items.filter(i => i.status === 'grail').length;

  const statsStr = [
    String(items.length),
    `${brands.size} BRANDS`,
    `$${Math.round(totalValue).toLocaleString()}`,
    grails ? `${grails} GRAILS` : null,
  ].filter(Boolean).join(' · ');

  const museumItems = filtered.map((item) => ({
    id: item.id,
    cat: catNum(items.findIndex(it => it.id === item.id)),
    brand: item.brand || '—',
    name: item.name || 'Untitled',
    type: item.type || '',
    color: item.color || '#888888',
    imageUrl: parseImageUrls(item.image_url)[0] || null,
  }));

  const hud = (
    <div className={`museum-hud${mode !== 'MUSEUM' ? ' museum-hud--static' : ''}`}>
      <div className="mode-toggle">
        {['MUSEUM', 'GRID', 'LIST'].map((m, i, arr) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`mode-btn${mode === m ? ' active' : ''}${i < arr.length - 1 ? ' bd-r' : ''}`}
          >{m}</button>
        ))}
      </div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="SEARCH…"
        className="museum-hud-search"
      />
      <select
        value={filterType}
        onChange={e => setFilterType(e.target.value)}
        className="museum-hud-select"
      >
        {TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <button onClick={onAdd} className="museum-hud-add">+ ADD</button>
    </div>
  );

  if (mode === 'MUSEUM') {
    return (
      <div className="museum-wrap">
        {hud}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', color: '#0a0a0a',
          }}>
            LOADING…
          </div>
        )}
        {!loading && loadError && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em',
          }}>
            FAILED TO LOAD
            <button onClick={onRetry} className="museum-hud-add">↻ RETRY</button>
          </div>
        )}
        {!loading && !loadError && museumItems.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 16, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em', color: '#0a0a0a',
          }}>
            {items.length === 0 ? 'WARDROBE EMPTY' : 'NO ITEMS MATCH'}
            {items.length === 0 && (
              <button onClick={onAdd} className="museum-hud-add">+ ADD FIRST ITEM</button>
            )}
          </div>
        )}
        {!loading && !loadError && museumItems.length > 0 && (
          <Museum
            items={museumItems}
            onItem={(mi) => onItemClick(items.find(i => i.id === mi.id))}
            hideOverlays
            onProgress={({ progress, nearest }) => {
              setMuseumProgress(progress);
              setMuseumNearest(nearest);
            }}
          />
        )}
        <div className="museum-bottom">
          <span className="museum-stats">{statsStr}</span>
          <span className="museum-item-name">{museumNearest?.item?.name || ''}</span>
          <span className="museum-progress">
            {String(Math.round(museumProgress * 100)).padStart(2, '0')}%
          </span>
        </div>
      </div>
    );
  }

  // GRID / LIST modes
  const itemGlobalIdx = (id) => items.findIndex(i => i.id === id);

  return (
    <div className="v-screen">
      {hud}
      <div className="v-body">
        {loading && <div className="v-empty">LOADING…</div>}
        {!loading && loadError && (
          <div className="v-empty" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <span>Failed to load items.</span>
            <button onClick={onRetry} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', padding: '8px 20px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>↻ RETRY</button>
          </div>
        )}

        {!loading && mode === 'GRID' && (
          <div className="cards-grid" style={{ padding: '16px 36px 24px' }}>
            {filtered.map(it => (
              <ItemCard key={it.id} item={it} onRemove={onRemove} onEdit={onEdit}
                onClick={id => onItemClick(items.find(i => i.id === id))} />
            ))}
            {filtered.length === 0 && <div className="v-empty">No items match your filters.</div>}
          </div>
        )}

        {!loading && mode === 'LIST' && (
          <div className="mob-pad" style={{ padding: '0 36px 24px' }}>
            <div className="list-header">
              <div>№</div>
              <div>BRAND · ITEM</div>
              <div>TYPE · COND</div>
              <div>SIZE</div>
              <div>ACQ.</div>
              <div style={{ textAlign: 'right' }}>PRICE</div>
              <div />
            </div>
            {filtered.map(it => {
              const gi = itemGlobalIdx(it.id);
              const dateStr = it.created_at
                ? new Date(it.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.')
                : '—';
              const isPending = confirm.pending === it.id;
              return (
                <div key={it.id} className="list-row" onClick={() => { if (!isPending) onItemClick(it); }}>
                  <div className="list-cat">{catNum(gi)}</div>
                  <div>
                    <div className="list-brand-sm">{it.brand || '—'}</div>
                    <div className="list-item-name">{it.name || 'Untitled'}</div>
                  </div>
                  <div className="list-meta">{it.type}{it.condition ? ` · ${it.condition}` : ''}</div>
                  <div className="list-meta">{it.size || '—'}</div>
                  <div className="list-meta">{dateStr}</div>
                  <div className="list-price">{parseFloat(it.price) ? `$${parseFloat(it.price).toLocaleString()}` : 'N/A'}</div>
                  <button
                    className={`rack-del${isPending ? ' confirming' : ''}`}
                    style={{ marginLeft: 8 }}
                    onClick={e => {
                      e.stopPropagation();
                      if (isPending) { onRemove(it.id); confirm.disarm(); }
                      else confirm.arm(it.id);
                    }}
                  >{isPending ? '?' : '×'}</button>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="v-empty">No items match your filters.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.2: Confirm the old imports are gone**

Run: `grep -n "isGyroActive\|RackCard\|Hanger\|stat-bar\|RACK" "src/components/WardrobeView.jsx"`

Expected: no output (all removed)

---

## Task 3: Add CSS and verify

**Files:**
- Modify: `src/App.css` (append)

- [ ] **Step 3.1: Start dev server**

Run: `npm run dev`

Expected: server starts on `http://localhost:5173` (or similar) with no build errors. If there are errors, fix them before continuing.

- [ ] **Step 3.2: Append museum CSS to App.css**

Add the following block at the end of `src/App.css`:

```css
/* ─── Museum wardrobe view ──────────────────────────────── */
.museum-wrap {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

/* Ghost HUD — floats over Museum corridor */
.museum-hud {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 100;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Static HUD — used for GRID / LIST modes */
.museum-hud--static {
  position: relative;
  background: var(--bg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 1px solid var(--border);
}

/* Mode toggle border in Museum mode */
.museum-hud:not(.museum-hud--static) .mode-toggle {
  border: 1px solid rgba(245,242,234,0.25);
}

/* Mode buttons — light text on dark HUD */
.museum-hud:not(.museum-hud--static) .mode-btn         { color: rgba(245,242,234,0.7); }
.museum-hud:not(.museum-hud--static) .mode-btn.active  { background: #f5f2ea; color: #0a0a0a; }
.museum-hud:not(.museum-hud--static) .mode-btn:hover:not(.active) { background: rgba(245,242,234,0.12); }
.museum-hud:not(.museum-hud--static) .mode-btn.bd-r    { border-right: 1px solid rgba(245,242,234,0.2); }

/* Search input */
.museum-hud-search {
  flex: 1;
  min-width: 80px;
  max-width: 200px;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(245,242,234,0.35);
  color: #f5f2ea;
  padding: 4px 2px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  outline: none;
  height: 28px;
}
.museum-hud-search::placeholder { color: rgba(245,242,234,0.4); }
.museum-hud--static .museum-hud-search {
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.museum-hud--static .museum-hud-search::placeholder { color: var(--text3); }

/* Type filter */
.museum-hud-select {
  background: rgba(245,242,234,0.08);
  border: 1px solid rgba(245,242,234,0.2);
  color: #f5f2ea;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  height: 28px;
  cursor: pointer;
  outline: none;
}
.museum-hud--static .museum-hud-select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
}

/* Add button */
.museum-hud-add {
  background: transparent;
  border: 1px solid rgba(245,242,234,0.4);
  color: #f5f2ea;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.15em;
  padding: 4px 12px;
  height: 28px;
  cursor: pointer;
  white-space: nowrap;
}
.museum-hud-add:hover { background: #f5f2ea; color: #0a0a0a; }
.museum-hud--static .museum-hud-add {
  border: 1px solid var(--border);
  color: var(--text);
}
.museum-hud--static .museum-hud-add:hover {
  background: var(--text);
  color: var(--bg);
}

/* Bottom status bar */
.museum-bottom {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: rgba(10,10,10,0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: none;
}
.museum-stats {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.15em;
  opacity: 0.7;
  color: #0a0a0a;
  white-space: nowrap;
}
.museum-item-name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: #0a0a0a;
  text-align: center;
  flex: 1;
  margin: 0 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.museum-progress {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  opacity: 0.7;
  color: #0a0a0a;
  white-space: nowrap;
}

/* Mobile: collapse search behind icon on small screens */
@media (max-width: 479px) {
  .museum-hud-search {
    max-width: 100px;
  }
  .museum-hud-select { display: none; }
  .museum-stats { display: none; }
}
```

- [ ] **Step 3.3: Open browser and verify Museum mode**

Open `http://localhost:5173` (or whichever port Vite shows), log in, and navigate to the wardrobe tab.

Verify:
- [ ] 3D corridor renders with cream walls, floor, and ceiling
- [ ] Item frames hang on alternating walls
- [ ] Frames show actual item photos (not just brand-colored placeholders) for items with photos
- [ ] Hovering a frame tilts it toward the camera with glow
- [ ] Clicking a frame opens the item detail view
- [ ] Ghost HUD floats at top with dark blur background
- [ ] Mode toggle shows MUSEUM (active) · GRID · LIST
- [ ] Search input filters corridor items as you type
- [ ] Type filter select works
- [ ] Bottom bar shows stats on left, item name center, `00%` progress right
- [ ] Progress % updates as you scroll deeper

- [ ] **Step 3.4: Verify GRID mode**

Click GRID in the HUD. Verify:
- [ ] Corridor is gone; item cards grid renders below the HUD
- [ ] HUD now uses `var(--bg)` background matching the app theme
- [ ] Search and type filter still work
- [ ] Clicking a card opens item detail

- [ ] **Step 3.5: Verify LIST mode**

Click LIST in the HUD. Verify:
- [ ] Table layout renders correctly
- [ ] Delete button (×) shows confirm state (?) on first click
- [ ] Clicking a row opens item detail

- [ ] **Step 3.6: Commit**

```bash
git add src/components/Museum.jsx src/components/WardrobeView.jsx src/App.css
git commit -m "feat: museum corridor wardrobe view with ghost HUD"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Museum corridor as primary view (default mode MUSEUM)
- ✅ Ghost HUD: mode toggle + search + filter + add (Task 2 + Task 3)
- ✅ Bottom status bar: stats + item name + progress (Task 2 + Task 3)
- ✅ Real item photos in frames (Task 1, MuseumFrame imageUrl prop)
- ✅ GRID and LIST modes preserved (Task 2)
- ✅ RACK mode removed (Task 2)
- ✅ AsciiBackground — already live, no work needed
- ✅ Empty / loading / error states in Museum mode (Task 2)
- ✅ Mobile: search collapses on < 480px (Task 3, media query)

**Placeholder scan:** None found.

**Type consistency:**
- `museumItems` always includes `imageUrl` field — MuseumFrame reads `f.item.imageUrl` ✅
- `onProgress` callback signature `{ progress, nearest }` matches `setMuseumProgress` / `setMuseumNearest` usage ✅
- `hideOverlays` prop: Museum checks `!hideOverlays` before rendering its own overlays ✅
