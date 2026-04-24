import { useState, useCallback } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

const SLOT_LABELS = ['TOP', 'BOTTOM', 'OUTER', 'SHOE', 'HAT', 'BAG'];

// Which item types each slot accepts (matches ITEM_TYPES in constants.js)
const SLOT_ACCEPTS = {
  TOP:    ['Shirt', 'T-Shirt', 'Sweatshirt'],
  BOTTOM: ['Jeans', 'Trousers', 'Shorts'],
  OUTER:  ['Jacket', 'Coat'],
  SHOE:   ['Footwear'],
  HAT:    ['Accessories'],
  BAG:    ['Accessories'],
};

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

function OutfitSlot({ label, item, idx, onRemove, draggingItem, onDragOver, onDrop }) {
  const accepts = draggingItem ? slotAccepts(label, draggingItem) : null;
  const isDraggingCompatible = draggingItem && accepts;
  const isDraggingIncompatible = draggingItem && !accepts;

  let borderStyle = '1px dashed var(--border)';
  let bg = 'var(--bg2)';
  if (item) { borderStyle = '1px solid var(--border)'; bg = 'var(--bg)'; }
  if (isDraggingCompatible) { borderStyle = '2px dashed #5a8a5a'; bg = 'rgba(90,138,90,0.08)'; }
  if (isDraggingIncompatible) { bg = item ? 'var(--bg)' : 'var(--bg2)'; }

  return (
    <div
      className={`outfit-slot${item ? ' filled' : ''}`}
      style={{
        cursor: item ? 'pointer' : 'default',
        border: borderStyle,
        background: bg,
        opacity: isDraggingIncompatible ? 0.45 : 1,
        transition: 'border-color 0.12s, background 0.12s, opacity 0.12s',
      }}
      onClick={item ? onRemove : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="outfit-slot-label">0{idx + 1} · {label}</div>
      {item ? (
        <>
          <div className="outfit-slot-img"><ItemThumb item={item} /></div>
          <div className="outfit-slot-info">
            <div className="mono-dim" style={{ fontSize: 8, letterSpacing: '0.1em' }}>{item.brand || '—'}</div>
            <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.1 }}>{item.name || 'Untitled'}</div>
          </div>
          <div className="outfit-slot-x">×</div>
        </>
      ) : (
        <div className="outfit-slot-empty">
          {isDraggingCompatible ? '↓ DROP HERE' : `+ ${label}`}
        </div>
      )}
    </div>
  );
}

export default function OutfitsView({ items }) {
  const [slots, setSlots]         = useState([null, null, null, null, null, null]);
  const [fitName, setFitName]     = useState('UNTITLED');
  const [savedFits, setSavedFits] = useState([]);
  const [draggingItem, setDraggingItem] = useState(null);
  const [loadedFitId, setLoadedFitId]   = useState(null);
  const [showSaved, setShowSaved]       = useState(false);

  const rackItems = items.filter(it => it.status !== 'wishlist');

  // Click-to-add: place in first empty slot whose category accepts the item
  const addItem = useCallback((item) => {
    const slotIdx = SLOT_LABELS.findIndex((label, i) => slots[i] === null && slotAccepts(label, item));
    if (slotIdx === -1) return;
    setSlots(prev => { const n = [...prev]; n[slotIdx] = item; return n; });
  }, [slots]);

  const removeSlot = (i) => setSlots(prev => { const n = [...prev]; n[i] = null; return n; });

  const filled = slots.filter(Boolean);
  const value  = filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  const loadFit = (fit) => {
    setSlots([...fit.slots]);
    setFitName(fit.name);
    setLoadedFitId(fit.id);
  };

  const saveFit = () => {
    if (!filled.length) return;
    if (loadedFitId) {
      // Update existing fit in place
      setSavedFits(f => f.map(fit => fit.id === loadedFitId ? { ...fit, name: fitName, slots: [...slots] } : fit));
    } else {
      setSavedFits(f => [...f, { id: Date.now(), name: fitName, slots: [...slots] }]);
    }
    setSlots([null, null, null, null, null, null]);
    setFitName('UNTITLED');
    setLoadedFitId(null);
  };

  const newFit = () => {
    setSlots([null, null, null, null, null, null]);
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
              <span className="mono-dim" style={{ fontSize: 10 }}>{filled.length}/6 · ${Math.round(value).toLocaleString()}</span>
            </div>

            <div className="outfit-slots">
              {SLOT_LABELS.map((label, i) => (
                <OutfitSlot
                  key={label}
                  idx={i}
                  label={label}
                  item={slots[i]}
                  onRemove={() => removeSlot(i)}
                  draggingItem={draggingItem}
                  onDragOver={e => handleSlotDragOver(e, label)}
                  onDrop={e => handleSlotDrop(e, i, label)}
                />
              ))}
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
                : <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={() => { setSlots([null,null,null,null,null,null]); setLoadedFitId(null); }}>CLEAR</button>
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
