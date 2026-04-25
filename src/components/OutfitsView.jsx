import { useState, useCallback, useRef, useEffect } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

const SLOT_LABELS = ['TOP', 'BOTTOM', 'OUTER', 'SHOE', 'HAT', 'BAG', 'ACC1', 'ACC2', 'ACC3', 'ACC4'];

// Which item types each slot accepts (matches ITEM_TYPES in constants.js)
const SLOT_ACCEPTS = {
  TOP:    ['Shirt', 'T-Shirt', 'Sweatshirt', 'Jacket', 'Coat'],
  BOTTOM: ['Jeans', 'Trousers', 'Shorts'],
  OUTER:  [],
  SHOE:   ['Footwear'],
  HAT:    ['Accessories'],
  BAG:    ['Accessories'],
  ACC1:   ['Accessories'],
  ACC2:   ['Accessories'],
  ACC3:   ['Accessories'],
  ACC4:   ['Accessories'],
};

const ACC_SLOTS = ['ACC1', 'ACC2', 'ACC3', 'ACC4'];
const ACC_IDXS  = [6, 7, 8, 9];

function slotAccepts(slotLabel, item) {
  if (!item?.type) return false;
  return (SLOT_ACCEPTS[slotLabel] || []).includes(item.type);
}

function Hanger({ size = 28 }) {
  return (
    <svg width={size} height={size * 0.64} viewBox="0 0 44 28" style={{ display: 'block' }}>
      <path d="M22 4 L22 10 M6 22 L22 10 L38 22 L6 22" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <circle cx="22" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" fill="var(--bg)" />
    </svg>
  );
}

function ItemThumb({ item }) {
  const imgs = parseImageUrls(item?.image_url);
  if (!item) return <div style={{ background: 'var(--bg2)', width: '100%', height: '100%' }} />;
  return imgs.length > 0
    ? <img src={imgs[0]} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    : <div className="rack-img-placeholder" style={{ height: '100%' }}><span>{(item.brand || '').slice(0, 3)}</span></div>;
}

// Scans image pixels to find tight bounding box of non-white/non-transparent content,
// then redraws zoomed to that box so every item fills its slot at true visual size.
function SmartThumb({ item }) {
  const canvasRef = useRef(null);
  const imgs = parseImageUrls(item?.image_url);
  const src = imgs[0];

  useEffect(() => {
    if (!src || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Scan at reduced resolution for speed
      const scan = document.createElement('canvas');
      const SW = Math.min(img.width, 400), SH = Math.round(img.height * SW / img.width);
      scan.width = SW; scan.height = SH;
      const sCtx = scan.getContext('2d');
      sCtx.drawImage(img, 0, 0, SW, SH);
      let data;
      try { data = sCtx.getImageData(0, 0, SW, SH).data; }
      catch { fallback(); return; }

      let minX = SW, maxX = 0, minY = SH, maxY = 0;
      for (let y = 0; y < SH; y++) {
        for (let x = 0; x < SW; x++) {
          const i = (y * SW + x) * 4;
          const a = data[i + 3];
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (a > 20 && !(r > 235 && g > 235 && b > 235)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX <= minX || maxY <= minY) { fallback(); return; }

      // Scale detected bounds back to original image coords
      const scaleX = img.width / SW, scaleY = img.height / SH;
      const pad = 8;
      const sx = Math.max(0, minX * scaleX - pad);
      const sy = Math.max(0, minY * scaleY - pad);
      const sw = Math.min(img.width, maxX * scaleX + pad) - sx;
      const sh = Math.min(img.height, maxY * scaleY + pad) - sy;

      const cw = canvas.offsetWidth || 200;
      const ch = canvas.offsetHeight || 200;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      ctx.scale(dpr, dpr);

      const fit = Math.min(cw / sw, ch / sh);
      const dx = (cw - sw * fit) / 2;
      const dy = (ch - sh * fit) / 2;
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * fit, sh * fit);
    };
    img.onerror = fallback;
    img.src = src;

    function fallback() {
      // CORS blocked or no content — just draw the full image centered
      const cw = canvas.offsetWidth || 200;
      const ch = canvas.offsetHeight || 200;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cw * dpr; canvas.height = ch * dpr;
      const fc = canvas.getContext('2d');
      fc.scale(dpr, dpr);
      const img2 = new Image();
      img2.onload = () => {
        const fit = Math.min(cw / img2.width, ch / img2.height);
        fc.drawImage(img2, (cw - img2.width * fit) / 2, (ch - img2.height * fit) / 2, img2.width * fit, img2.height * fit);
      };
      img2.src = src;
    }
  }, [src]);

  if (!item) return <div style={{ background: 'var(--bg2)', width: '100%', height: '100%' }} />;
  if (!src) return <div className="rack-img-placeholder" style={{ height: '100%' }}><span>{(item.brand || '').slice(0, 3)}</span></div>;
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

// Heights per slot type for the flat-lay look
const SLOT_H = { TOP: 240, BOTTOM: 250, OUTER: 240, SHOE: 180, HAT: 90, BAG: 110, ACC1: 90, ACC2: 90, ACC3: 90, ACC4: 90 };

function FlatSlot({ label, item, onRemove, draggingItem, onDragOver, onDrop, style = {} }) {
  const accepts = draggingItem ? slotAccepts(label, draggingItem) : null;
  const compatible = draggingItem && accepts;
  const incompatible = draggingItem && !accepts;
  const h = SLOT_H[label] || 160;

  return (
    <div
      className={`flat-slot${item ? ' flat-filled' : ' flat-empty'}`}
      style={{
        height: h,
        outline: compatible ? '2px dashed #5a8a5a' : 'none',
        outlineOffset: 2,
        opacity: incompatible && !item ? 0.3 : 1,
        cursor: item ? 'pointer' : 'default',
        ...style,
      }}
      onClick={item ? onRemove : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {item ? (
        <>
          <div className="flat-img"><ItemThumb item={item} /></div>
          <div className="flat-caption">
            <button className="flat-x" onClick={e => { e.stopPropagation(); onRemove(); }}>×</button>
          </div>
        </>
      ) : (
        <div className="flat-empty-label">
          {compatible ? '↓ DROP' : `+ ${label}`}
        </div>
      )}
    </div>
  );
}

export default function OutfitsView({ items }) {
  const [slots, setSlots]         = useState(Array(10).fill(null));
  const [fitName, setFitName]     = useState('UNTITLED');
  const [savedFits, setSavedFits] = useState(() => {
    try { return JSON.parse(localStorage.getItem('garderobe-saved-fits') || '[]'); } catch { return []; }
  });
  const [draggingItem, setDraggingItem] = useState(null);
  const [loadedFitId, setLoadedFitId]   = useState(null);
  const [showSaved, setShowSaved]       = useState(false);

  useEffect(() => {
    try { localStorage.setItem('garderobe-saved-fits', JSON.stringify(savedFits)); } catch {}
  }, [savedFits]);

  const rackItems = items.filter(it => it.status !== 'wishlist' && it.type !== 'Other');

  // Click-to-add: place in first empty slot whose category accepts the item
  const addItem = useCallback((item) => {
    const slotIdx = SLOT_LABELS.findIndex((label, i) => slots[i] === null && slotAccepts(label, item));
    if (slotIdx === -1) return;
    setSlots(prev => { const n = [...prev]; n[slotIdx] = item; return n; });
  }, [slots]);

  const removeSlot = (i) => setSlots(prev => { const n = [...prev]; n[i] = null; return n; });

  const filled = slots.filter(Boolean);
  const value  = filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  const EMPTY_SLOTS = Array(10).fill(null);

  const loadFit = (fit) => {
    const padded = [...fit.slots, ...Array(10)].slice(0, 10).map(v => v ?? null);
    setSlots(padded);
    setFitName(fit.name);
    setLoadedFitId(fit.id);
  };

  const saveFit = () => {
    if (!filled.length) return;
    if (loadedFitId) {
      setSavedFits(f => f.map(fit => fit.id === loadedFitId ? { ...fit, name: fitName, slots: [...slots] } : fit));
    } else {
      setSavedFits(f => [...f, { id: Date.now(), name: fitName, slots: [...slots] }]);
    }
    setSlots(EMPTY_SLOTS);
    setFitName('UNTITLED');
    setLoadedFitId(null);
  };

  const newFit = () => {
    setSlots(EMPTY_SLOTS);
    setFitName('UNTITLED');
    setLoadedFitId(null);
  };

  const shuffle = () => {
    const used = new Set();
    const newSlots = SLOT_LABELS.map(label => {
      const candidates = rackItems.filter(it => slotAccepts(label, it) && !used.has(it.id));
      if (!candidates.length) return null;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      used.add(pick.id);
      return pick;
    });
    setSlots(newSlots);
  };

  // Drag handlers
  const handleDragStart = (e, item) => {
    setDraggingItem(item);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const handleDragEnd = () => setDraggingItem(null);

  const handleSlotDragOver = (e, slotLabel) => {
    if (slotAccepts(slotLabel, draggingItem)) e.preventDefault();
  };
  const handleSlotDrop = (e, slotIdx, slotLabel) => {
    e.preventDefault();
    if (!draggingItem || !slotAccepts(slotLabel, draggingItem)) return;
    setSlots(prev => { const n = [...prev]; n[slotIdx] = draggingItem; return n; });
    setDraggingItem(null);
  };

  return (
    <div className="v-screen">
      <div className="v-screen-header" style={{ borderBottom: 'none' }}>
        <div>
          <div className="v-screen-title">OOTD</div>
          <div className="v-screen-sub">BUILD A FIT · TAP ITEMS TO ADD · TAP SLOT TO REMOVE</div>
        </div>
        <button
          onClick={() => setShowSaved(s => !s)}
          style={{
            background: showSaved ? 'var(--text)' : 'transparent',
            color: showSaved ? 'var(--bg)' : 'var(--text)',
            border: '1px solid var(--border)',
            padding: '7px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.15em',
            cursor: 'pointer',
            alignSelf: 'flex-end',
          }}
        >
          SAVED FITS · {savedFits.length}
        </button>
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} />

      <div className="v-body" style={{ overflow: 'hidden', display: 'flex' }}>
        <div className="outfits-cols" style={{ flex: 1 }}>

          {/* LEFT: builder */}
          <div className="outfits-left">
            {showSaved && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', opacity: 0.55, marginBottom: 10 }}>PRIOR FITS · {savedFits.length} SAVED</div>
                {savedFits.length === 0 && (
                  <div className="v-empty">No saved fits yet.</div>
                )}
                <div className="saved-fits-grid">
                  {savedFits.map(fit => {
                    const isActive = fit.id === loadedFitId;
                    return (
                      <div
                        key={fit.id}
                        className="saved-fit-card"
                        onClick={() => { loadFit(fit); setShowSaved(false); }}
                        style={{
                          cursor: 'pointer',
                          border: isActive ? '1px solid var(--text)' : '1px solid var(--border)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500 }}>{fit.name}</div>
                          {isActive && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', opacity: 0.6 }}>LOADED</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {fit.slots.map((it, i) => (
                            <div key={i} className="saved-fit-thumb"><ItemThumb item={it} /></div>
                          ))}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em', opacity: 0.45, marginTop: 6 }}>
                          {fit.slots.filter(Boolean).length} PIECES
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="outfits-name-row">
              <span className="mono-dim" style={{ fontSize: 10, letterSpacing: '0.15em' }}>FIT /</span>
              <input
                value={fitName}
                onChange={e => setFitName(e.target.value.toUpperCase())}
                className="outfits-name-input"
              />
              <span className="mono-dim" style={{ fontSize: 10 }}>{filled.length}/10 · ${Math.round(value).toLocaleString()}</span>
            </div>

            <div className="outfit-slots">
              <div className="outfit-body-row">
                {/* Center column: head → torso → legs → feet */}
                <div className="outfit-center-col">
                  {/* HAT */}
                  <FlatSlot idx={4} label="HAT" item={slots[4]} onRemove={() => removeSlot(4)}
                    draggingItem={draggingItem}
                    onDragOver={e => handleSlotDragOver(e, 'HAT')}
                    onDrop={e => handleSlotDrop(e, 4, 'HAT')}
                    style={{ marginBottom: -28 }} />
                  {/* TOP (single slot, accepts all topwear) */}
                  <FlatSlot idx={0} label="TOP" item={slots[0]} onRemove={() => removeSlot(0)}
                    draggingItem={draggingItem}
                    onDragOver={e => handleSlotDragOver(e, 'TOP')}
                    onDrop={e => handleSlotDrop(e, 0, 'TOP')}
                    style={{ marginBottom: -75 }} />
                  {/* BOTTOM */}
                  <FlatSlot idx={1} label="BOTTOM" item={slots[1]} onRemove={() => removeSlot(1)}
                    draggingItem={draggingItem}
                    onDragOver={e => handleSlotDragOver(e, 'BOTTOM')}
                    onDrop={e => handleSlotDrop(e, 1, 'BOTTOM')}
                    style={{ marginBottom: -65 }} />
                  {/* SHOE */}
                  <FlatSlot idx={3} label="SHOE" item={slots[3]} onRemove={() => removeSlot(3)}
                    draggingItem={draggingItem}
                    onDragOver={e => handleSlotDragOver(e, 'SHOE')}
                    onDrop={e => handleSlotDrop(e, 3, 'SHOE')} />
                </div>
                {/* BAG column — right, separate */}
                <div className="outfit-bag-col">
                  <FlatSlot idx={5} label="BAG" item={slots[5]} onRemove={() => removeSlot(5)}
                    draggingItem={draggingItem}
                    onDragOver={e => handleSlotDragOver(e, 'BAG')}
                    onDrop={e => handleSlotDrop(e, 5, 'BAG')} />
                </div>
              </div>

              {/* Accessories strip */}
              <div className="outfit-acc-strip">
                <div className="mono-dim" style={{ fontSize: 8, letterSpacing: '0.15em', marginBottom: 6 }}>ACCESSORIES</div>
                <div className="outfit-acc-row">
                  {ACC_SLOTS.map((label, i) => {
                    const slotIdx = ACC_IDXS[i];
                    return (
                      <FlatSlot key={label} label="ACC" item={slots[slotIdx]} onRemove={() => removeSlot(slotIdx)}
                        draggingItem={draggingItem}
                        onDragOver={e => handleSlotDragOver(e, label)}
                        onDrop={e => handleSlotDrop(e, slotIdx, label)}
                        style={{ height: SLOT_H.ACC1 }} />
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="outfit-stats">
              <span className="mono-dim">TOTAL PIECES</span>
              <strong>{filled.length}</strong>
              <span className="mono-dim">OUTFIT VALUE</span>
              <strong>${Math.round(value).toLocaleString()}</strong>
              <span className="mono-dim">WT CLASS</span>
              <strong>{filled.length < 3 ? 'LIGHT' : filled.length < 5 ? 'STD' : 'LAYERED'}</strong>
            </div>

            <div className="outfit-actions" style={{ border: '1px solid var(--border)' }}>
              {loadedFitId
                ? <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={newFit}>← NEW FIT</button>
                : <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={() => { setSlots(EMPTY_SLOTS); setLoadedFitId(null); }}>CLEAR</button>
              }
              <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={shuffle}>SHUFFLE</button>
              <button
                className={`mode-btn${filled.length > 0 ? ' active' : ''}`}
                style={{ flex: 2 }}
                disabled={filled.length === 0}
                onClick={saveFit}
              >{loadedFitId ? '✓ UPDATE FIT' : '+ SAVE FIT'}</button>
            </div>

          </div>

          {/* RIGHT: rack */}
          <div className="outfits-right">
            <div className="outfits-rack-header">
              <span className="mono-dim" style={{ fontSize: 11 }}>THE RACK · PICK AN ITEM</span>
              <span className="mono-dim">{rackItems.length} AVAILABLE</span>
            </div>
            <div className="rack-rule" />
            <div className="outfit-rack-wrap">
              <div className="outfit-rack-line" />
              <div className="outfit-rack-grid">
                {rackItems.map(it => {
                  const inFit = slots.some(s => s && s.id === it.id);
                  const imgs = parseImageUrls(it.image_url);
                  // Which slots would accept this item?
                  const compatibleSlots = SLOT_LABELS.filter(l => slotAccepts(l, it));
                  const hasValidEmptySlot = SLOT_LABELS.some((l, i) => slots[i] === null && slotAccepts(l, it));
                  const dimmed = inFit || (!hasValidEmptySlot && !inFit);

                  return (
                    <div
                      key={it.id}
                      className={`outfit-pick${inFit ? ' in-fit' : ''}`}
                      draggable={!inFit}
                      onDragStart={e => !inFit && handleDragStart(e, it)}
                      onDragEnd={handleDragEnd}
                      onClick={() => !inFit && addItem(it)}
                      style={{ cursor: inFit ? 'default' : 'grab', opacity: dimmed ? 0.35 : 1 }}
                      title={compatibleSlots.length ? `Goes in: ${compatibleSlots.join(', ')}` : 'No matching slot'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -1 }}>
                        <Hanger size={24} />
                      </div>
                      <div className="mono-dim" style={{ fontSize: 8, textAlign: 'center', letterSpacing: '0.12em', marginBottom: 4 }}>
                        № {String(rackItems.findIndex(r => r.id === it.id) + 1).padStart(3, '0')}
                      </div>
                      <div className="outfit-pick-img">
                        {imgs.length > 0
                          ? <img src={imgs[0]} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : <div className="rack-img-placeholder" style={{ height: '100%' }}><span>{(it.brand || '').slice(0, 3)}</span></div>
                        }
                      </div>
                      <div className="mono-dim" style={{ fontSize: 8, letterSpacing: '0.1em', marginTop: 4 }}>{(it.brand || '').toUpperCase()}</div>
                      <div style={{ fontSize: 10, fontWeight: 500, lineHeight: 1.15, marginTop: 2 }}>{it.name || 'Untitled'}</div>
                      {inFit && <div className="outfit-in-fit-badge">IN FIT</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
