import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { sb } from '../lib/supabase';

// ── Data model ──────────────────────────────────────────────────────────────

const DISPLAY_SLOTS = [
  { key: 'TOP',    idx: 0, label: 'TOP',    accepts: ['Shirt', 'T-Shirt', 'Sweatshirt'] },
  { key: 'OUTER',  idx: 2, label: 'OUTER',  accepts: ['Jacket', 'Coat'] },
  { key: 'BOTTOM', idx: 1, label: 'BOTTOM', accepts: ['Jeans', 'Trousers', 'Shorts'] },
  { key: 'SHOE',   idx: 3, label: 'SHOES',  accepts: ['Footwear'] },
  { key: 'BAG',    idx: 5, label: 'BAG',    accepts: ['Bag'] },
  { key: 'HAT',    idx: 4, label: 'HAT',    accepts: ['Headwear'] },
];

const CHAIN_SLOTS = DISPLAY_SLOTS.filter(s => ['TOP', 'OUTER', 'BOTTOM'].includes(s.key));

const PHYSIQUE = [
  { key: 'slim',     label: 'SLIM',     abbr: 'SLM' },
  { key: 'standard', label: 'STANDARD', abbr: 'STD' },
  { key: 'curvy',    label: 'CURVY',    abbr: 'CRV' },
];

const CATEGORIES = ['ALL', 'TOPS', 'OUTER', 'BOTTOMS', 'SHOES', 'BAGS', 'HATS'];

const CAT_TYPES = {
  TOPS:    ['Shirt', 'T-Shirt', 'Sweatshirt'],
  OUTER:   ['Jacket', 'Coat'],
  BOTTOMS: ['Jeans', 'Trousers', 'Shorts'],
  SHOES:   ['Footwear'],
  BAGS:    ['Bag'],
  HATS:    ['Headwear'],
};

// ── Canvas helpers (verbatim from previous OutfitsView) ──────────────────────

function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function smartCropDraw(ctx, img, dx, dy, dw, dh) {
  if (!img) return;
  const scan = document.createElement('canvas');
  const SW = Math.min(img.width, 200);
  const SH = Math.round(img.height * SW / img.width);
  scan.width = SW; scan.height = SH;
  const sCtx = scan.getContext('2d');
  sCtx.drawImage(img, 0, 0, SW, SH);
  let data;
  try { data = sCtx.getImageData(0, 0, SW, SH).data; }
  catch { ctx.drawImage(img, dx, dy, dw, dh); return; }
  let minX = SW, maxX = 0, minY = SH, maxY = 0;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      const a = data[i + 3], r = data[i], g = data[i + 1], b = data[i + 2];
      if (a > 20 && !(r > 235 && g > 235 && b > 235)) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) { ctx.drawImage(img, dx, dy, dw, dh); return; }
  const scaleX = img.width / SW, scaleY = img.height / SH;
  const pad = 4;
  const sx = Math.max(0, minX * scaleX - pad);
  const sy = Math.max(0, minY * scaleY - pad);
  const sw = Math.min(img.width, maxX * scaleX + pad) - sx;
  const sh = Math.min(img.height, maxY * scaleY + pad) - sy;
  const fit = Math.min(dw / sw, dh / sh);
  ctx.drawImage(img, sx, sy, sw, sh,
    dx + (dw - sw * fit) / 2,
    dy + (dh - sh * fit) / 2,
    sw * fit, sh * fit);
}

async function renderFitCanvas(slots, fitName, username) {
  const W = 800, H = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const images = await Promise.all(slots.map(item => {
    if (!item) return Promise.resolve(null);
    const urls = parseImageUrls(item.image_url);
    return urls.length ? loadImg(urls[0]) : Promise.resolve(null);
  }));

  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.fillText(fitName, 40, 58);
  const filled = slots.filter(Boolean);
  const value = filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`${filled.length} PIECES  ·  $${Math.round(value).toLocaleString()}`, 40, 85);

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 105); ctx.lineTo(W - 40, 105); ctx.stroke();

  const bodyTop = 112, bodyH = 758;
  const accX = 20,     accW = 130;
  const centerX = 175, centerW = 400;
  const bagX = 600,    bagW = 165;

  const GAP = 6;
  const centerItems = [
    { idx: 4, h: 80  },
    { idx: 0, h: 230 },
    { idx: 1, h: 240 },
    { idx: 3, h: 172 },
  ];
  let cy = bodyTop;
  for (let ci = 0; ci < centerItems.length; ci++) {
    const { idx, h } = centerItems[ci];
    if (images[idx]) {
      smartCropDraw(ctx, images[idx], centerX, cy, centerW, h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
      ctx.fillRect(centerX, cy, centerW, h);
    }
    cy += h + (ci < centerItems.length - 1 ? GAP : 0);
  }

  const accSlotH = 82, accGap = 8;
  const accTotalH = 4 * accSlotH + 3 * accGap;
  let ay = bodyTop + (bodyH - accTotalH) / 2;
  for (let i = 0; i < 4; i++) {
    const idx = 6 + i;
    if (images[idx]) {
      smartCropDraw(ctx, images[idx], accX, ay, accW, accSlotH);
    }
    ay += accSlotH + accGap;
  }

  const bagH = 155;
  if (images[5]) {
    smartCropDraw(ctx, images[5], bagX, bodyTop + (bodyH - bagH) / 2, bagW, bagH);
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.moveTo(40, H - 60); ctx.lineTo(W - 40, H - 60); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.font = '11px "Courier New", monospace';
  ctx.fillText((username || 'ANONYMOUS').toUpperCase(), 40, H - 30);
  ctx.textAlign = 'right';
  ctx.fillText('GARDEROBE', W - 40, H - 30);
  ctx.textAlign = 'left';

  return canvas;
}

// ── ShareModal (verbatim from previous OutfitsView) ──────────────────────────

function ShareModal({ canvas, fitName, slotCount, totalValue, user, onClose }) {
  const [posting, setPosting] = useState(false);
  const [posted,  setPosted]  = useState(false);
  const [copied,  setCopied]  = useState(false);
  const [error,   setError]   = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const dataUrl = canvas.toDataURL('image/png');

  function handleDownload() {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${fitName.toLowerCase().replace(/\s+/g, '-') || 'fit'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleCopy() {
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      await navigator.clipboard.writeText(dataUrl).catch(() => {});
    }
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  async function handlePost() {
    if (!user?.id) return;
    setPosting(true);
    setError(null);
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const fileName = `${user.id}/${Date.now()}.png`;
      const { error: upErr } = await sb.storage
        .from('outfit-shares')
        .upload(fileName, blob, { contentType: 'image/png' });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = sb.storage
        .from('outfit-shares')
        .getPublicUrl(fileName);
      const { error: insErr } = await sb.from('outfit_posts').insert({
        user_id: user.id, fit_name: fitName,
        image_url: publicUrl, slot_count: slotCount, total_value: totalValue,
      });
      if (insErr) throw insErr;
      setPosted(true);
    } catch (e) {
      console.error('[handlePost] error:', e);
      setError('Upload failed. Try again.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="share-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <div className="share-modal-header">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', opacity: 0.6 }}>EXPORT FIT</span>
          <button className="share-modal-close" onClick={onClose}>×</button>
        </div>
        <img src={dataUrl} alt="Fit preview" className="share-modal-preview" />
        <div className="share-modal-actions">
          <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={handleDownload}>↓ DOWNLOAD</button>
          <button className="mode-btn bd-r" style={{ flex: 1 }} onClick={handleCopy}>
            {copied ? '✓ COPIED' : '⧉ COPY'}
          </button>
          {!posted
            ? <button
                className={`mode-btn${!posting && user?.id ? ' active' : ''}`}
                style={{ flex: 1 }}
                onClick={handlePost}
                disabled={posting || !user?.id}
              >{posting ? '…' : '→ POST'}</button>
            : <button className="mode-btn" style={{ flex: 1 }} disabled>✓ POSTED</button>
          }
        </div>
        {!user?.id && (
          <div className="share-modal-error">Sign in to post to Explore.</div>
        )}
        {error && <div className="share-modal-error">{error}</div>}
      </div>
    </div>
  );
}

// ── Progress pill ─────────────────────────────────────────────────────────────

function ProgressPill({ completedSteps, slots }) {
  const activeChain = CHAIN_SLOTS.filter(s => slots[s.idx]);
  if (!activeChain.length) return null;
  return (
    <div className="tryon-progress-pill">
      {activeChain.map((s, i) => {
        const done = completedSteps.includes(s.key);
        return (
          <span key={s.key} className={`tryon-progress-step${done ? '' : ' pending'}`}>
            {i > 0 && <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>}
            {s.label} {done ? '✓' : '—'}
          </span>
        );
      })}
    </div>
  );
}

// ── Wardrobe grid (shared between desktop right panel and mobile rack) ────────

function WardrobeGrid({ filteredItems, slots, addItem, extraClass }) {
  return (
    <div className={`tryon-wardrobe-grid${extraClass ? ' ' + extraClass : ''}`}>
      {filteredItems.length === 0 && (
        <div className="tryon-wardrobe-empty">NO ITEMS</div>
      )}
      {filteredItems.map(it => {
        const inFit = slots.some(s => s && s.id === it.id);
        const imgs = parseImageUrls(it.image_url);
        return (
          <div
            key={it.id}
            className={`tryon-wardrobe-card${inFit ? ' in-fit' : ''}`}
            onClick={() => !inFit && addItem(it)}
          >
            <div className="tryon-wardrobe-card-img">
              {imgs.length > 0
                ? <img src={imgs[0]} alt={it.name} />
                : <div style={{ width: '100%', height: '100%', background: 'var(--bg2)' }} />
              }
            </div>
            <div className="tryon-wardrobe-card-info">
              <div className="tryon-wardrobe-card-brand">{(it.brand || '').toUpperCase()}</div>
              <div className="tryon-wardrobe-card-name">{it.name || 'Untitled'}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Result area ───────────────────────────────────────────────────────────────

function ResultArea({ genState, slots, completedSteps }) {
  const hasItems = slots.some(Boolean);
  const hasChain = CHAIN_SLOTS.some(s => slots[s.idx]);

  let content;
  if (genState === 'done') {
    const pieceCount = slots.filter(Boolean).length;
    content = (
      <div className="tryon-result-mock">
        <div className="tryon-result-mock-label">TRY-ON RESULT (MOCK)</div>
        <div className="tryon-result-mock-sub">
          STANDARD · {pieceCount} {pieceCount === 1 ? 'PIECE' : 'PIECES'}
        </div>
      </div>
    );
  } else if (!hasItems) {
    content = <div className="tryon-result-empty">ADD ITEMS TO BUILD YOUR FIT</div>;
  } else if (!hasChain) {
    content = <div className="tryon-result-empty">ADD A TOP, OUTER, OR BOTTOM TO GENERATE</div>;
  } else {
    content = <div className="tryon-result-empty">PRESS GENERATE</div>;
  }

  return (
    <div className={`tryon-result-area${genState === 'generating' ? ' generating' : ''}`}>
      {content}
      {(genState === 'generating' || genState === 'done') && (
        <ProgressPill completedSteps={completedSteps} slots={slots} />
      )}
    </div>
  );
}

// ── Action buttons row ────────────────────────────────────────────────────────

function ActionButtons({ genState, hasChainSlot, onBack, onGenerate, onDownload }) {
  const generateLabel = genState === 'generating' ? 'GENERATING...' : 'GENERATE';
  return (
    <div className="tryon-actions">
      <button
        className="tryon-action-btn"
        disabled={genState !== 'done'}
        onClick={onBack}
      >BACK</button>
      <button
        className="tryon-action-btn primary"
        disabled={!hasChainSlot || genState === 'generating'}
        onClick={onGenerate}
      >{generateLabel}</button>
      <button
        className="tryon-action-btn primary"
        disabled={genState !== 'done'}
        onClick={onDownload}
      >DOWNLOAD</button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OutfitsView({ items, user }) {
  const [slots, setSlots]               = useState(Array(10).fill(null));
  const [physique, setPhysique]         = useState('standard');
  const [genState, setGenState]         = useState('idle');
  const [completedSteps, setCompletedSteps] = useState([]);
  const [searchQuery, setSearchQuery]   = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [fitName, setFitName]           = useState('UNTITLED');
  const [savedFits, setSavedFits]       = useState([]);
  const [loadedFitId, setLoadedFitId]   = useState(null);
  const [shareCanvas, setShareCanvas]   = useState(null);
  const [showShare, setShowShare]       = useState(false);
  const [rackOpen, setRackOpen]         = useState(false);
  const [showSaved, setShowSaved]       = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const genAbortRef = useRef(false);
  const genSlotsRef = useRef(null);
  const fitsLoadedRef = useRef(false);

  // ── Supabase saved fits load (verbatim from previous OutfitsView) ──────────
  useEffect(() => {
    if (!user?.id) {
      try { setSavedFits(JSON.parse(localStorage.getItem('garderobe-saved-fits') || '[]')); } catch {}
      return;
    }
    sb.from('saved_fits')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data) {
          const fits = data.map(r => ({ id: r.id, name: r.name, slots: r.slots }));
          setSavedFits(fits);
          fitsLoadedRef.current = true;
          try {
            const local = JSON.parse(localStorage.getItem('garderobe-saved-fits') || '[]');
            if (local.length > 0) {
              const rows = local.map(f => ({ user_id: user.id, name: f.name, slots: f.slots }));
              sb.from('saved_fits').insert(rows).then(({ data: inserted }) => {
                if (inserted) {
                  setSavedFits(prev => [...prev, ...inserted.map(r => ({ id: r.id, name: r.name, slots: r.slots }))]);
                }
                localStorage.removeItem('garderobe-saved-fits');
              });
            }
          } catch {}
        }
      });
  }, [user?.id]);

  // ── Slot change detection after generation ─────────────────────────────────
  useEffect(() => {
    if (genState !== 'done' || !genSlotsRef.current) return;
    const changed = genSlotsRef.current.some((s, i) => (s?.id ?? null) !== (slots[i]?.id ?? null));
    if (changed) {
      setGenState('idle');
      setCompletedSteps([]);
      genSlotsRef.current = null;
    }
  }, [slots, genState]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const rackItems = useMemo(
    () => items.filter(it => it.status !== 'wishlist' && it.type !== 'Other'),
    [items]
  );

  const filteredItems = useMemo(() => {
    let list = rackItems;
    if (activeCategory !== 'ALL') {
      const types = CAT_TYPES[activeCategory] || [];
      list = list.filter(it => types.includes(it.type));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(it =>
        (it.name || '').toLowerCase().includes(q) ||
        (it.brand || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rackItems, activeCategory, searchQuery]);

  const filled = useMemo(() => slots.filter(Boolean), [slots]);
  const hasChainSlot = CHAIN_SLOTS.some(s => slots[s.idx]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addItem = useCallback((item) => {
    const slot = DISPLAY_SLOTS.find(s => slots[s.idx] === null && s.accepts.includes(item.type));
    if (!slot) return;
    setSlots(prev => { const n = [...prev]; n[slot.idx] = item; return n; });
  }, [slots]);

  const removeSlot = useCallback((idx) => {
    setSlots(prev => { const n = [...prev]; n[idx] = null; return n; });
  }, []);

  const clearSlots = useCallback(() => {
    setSlots(Array(10).fill(null));
    setLoadedFitId(null);
    genAbortRef.current = true;
    setGenState('idle');
    setCompletedSteps([]);
    genSlotsRef.current = null;
  }, []);

  const handleGenerate = useCallback(async () => {
    const toRun = CHAIN_SLOTS.filter(s => slots[s.idx]);
    if (!toRun.length || genState === 'generating') return;
    genAbortRef.current = false;
    setGenState('generating');
    setCompletedSteps([]);
    for (const slot of toRun) {
      if (genAbortRef.current) return;
      await new Promise(r => setTimeout(r, 2000));
      if (genAbortRef.current) return;
      setCompletedSteps(prev => [...prev, slot.key]);
    }
    genSlotsRef.current = [...slots];
    setGenState('done');
  }, [slots, genState]);

  const handleBack = useCallback(() => {
    genAbortRef.current = true;
    setGenState('idle');
    setCompletedSteps([]);
    genSlotsRef.current = null;
  }, []);

  const handleDownload = useCallback(async () => {
    if (genState !== 'done') return;
    const meta = await sb.auth.getUser();
    const username = meta?.data?.user?.user_metadata?.profile?.['p-name'] || '';
    const canvas = await renderFitCanvas(slots, fitName, username);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${fitName.toLowerCase().replace(/\s+/g, '-') || 'fit'}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [slots, fitName, genState]);

  // ── Saved fits actions ─────────────────────────────────────────────────────

  const EMPTY_SLOTS = Array(10).fill(null);

  const loadFit = useCallback((fit) => {
    const padded = [...fit.slots, ...Array(10)].slice(0, 10).map(v => v ?? null);
    setSlots(padded);
    setFitName(fit.name);
    setLoadedFitId(fit.id);
    genAbortRef.current = true;
    setGenState('idle');
    setCompletedSteps([]);
    genSlotsRef.current = null;
  }, []);

  const saveFit = useCallback(async () => {
    if (!filled.length) return;
    if (loadedFitId) {
      setSavedFits(f => f.map(fit => fit.id === loadedFitId ? { ...fit, name: fitName, slots: [...slots] } : fit));
      if (user?.id) {
        await sb.from('saved_fits').update({ name: fitName, slots: [...slots] }).eq('id', loadedFitId).eq('user_id', user.id);
      }
    } else {
      if (user?.id) {
        const { data } = await sb.from('saved_fits').insert({ user_id: user.id, name: fitName, slots: [...slots] }).select().single();
        if (data) setSavedFits(f => [...f, { id: data.id, name: data.name, slots: data.slots }]);
      } else {
        const newFit = { id: Date.now(), name: fitName, slots: [...slots] };
        setSavedFits(f => {
          const updated = [...f, newFit];
          try { localStorage.setItem('garderobe-saved-fits', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
    }
  }, [filled.length, loadedFitId, fitName, slots, user]);

  const deleteFit = useCallback((fitId) => {
    setSavedFits(f => {
      const updated = f.filter(x => x.id !== fitId);
      if (!user?.id) {
        try { localStorage.setItem('garderobe-saved-fits', JSON.stringify(updated)); } catch {}
      }
      return updated;
    });
    if (loadedFitId === fitId) { setSlots(EMPTY_SLOTS); setLoadedFitId(null); }
    setPendingDelete(null);
    if (user?.id) sb.from('saved_fits').delete().eq('id', fitId).eq('user_id', user.id);
  }, [loadedFitId, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared sub-components ──────────────────────────────────────────────────

  const SearchAndCategories = (
    <>
      <div className="tryon-search-wrap">
        <span className="tryon-search-icon">⌕</span>
        <input
          className="tryon-search-input"
          type="text"
          placeholder="Search items..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="tryon-cat-tabs">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`tryon-cat-tab${activeCategory === cat ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >{cat}</button>
        ))}
      </div>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="tryon-wrap">

      {/* ── MOBILE HEADER (hidden on desktop) ── */}
      <div className="tryon-mobile-header">
        <span className="tryon-mobile-title">FITS</span>
        <div className="tryon-mobile-physique">
          {PHYSIQUE.map(p => (
            <button
              key={p.key}
              className={`tryon-mobile-physique-btn${physique === p.key ? ' active' : ''}`}
              onClick={() => setPhysique(p.key)}
            >{p.abbr}</button>
          ))}
        </div>
      </div>

      <div className="tryon-layout">

        {/* ── LEFT PANEL (desktop only) ── */}
        <div className="tryon-left">
          <div className="tryon-section-label">OUTFIT</div>
          <div className="tryon-slot-list">
            {DISPLAY_SLOTS.map(s => {
              const item = slots[s.idx];
              const imgs = item ? parseImageUrls(item.image_url) : [];
              return (
                <div
                  key={s.key}
                  className={`tryon-slot-row${item ? ' filled' : ''}`}
                  onClick={item ? () => removeSlot(s.idx) : undefined}
                  title={item ? `Remove ${item.name}` : undefined}
                >
                  <div className="tryon-slot-thumb">
                    {item
                      ? (imgs.length > 0
                          ? <img src={imgs[0]} alt={item.name} />
                          : <div style={{ width: '100%', height: '100%', background: 'var(--bg3, #e0e0e0)' }} />)
                      : <span className="tryon-slot-plus">+</span>
                    }
                  </div>
                  <div className="tryon-slot-label">{s.label}</div>
                </div>
              );
            })}
          </div>

          <hr className="tryon-divider" />

          <div className="tryon-section-label">PHYSIQUE</div>
          <div className="tryon-physique-row">
            {PHYSIQUE.map(p => (
              <button
                key={p.key}
                className={`tryon-physique-btn${physique === p.key ? ' active' : ''}`}
                onClick={() => setPhysique(p.key)}
              >
                {p.abbr}
              </button>
            ))}
          </div>

          <hr className="tryon-divider" />

          <button
            className={`tryon-saved-btn${showSaved ? ' open' : ''}`}
            onClick={() => setShowSaved(s => !s)}
          >
            SAVED · {savedFits.length}
          </button>

          {showSaved && (
            <div className="tryon-saved-list">
              {savedFits.length === 0 && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: 'var(--text3)', padding: '8px 0' }}>
                  NO SAVED FITS
                </div>
              )}
              {savedFits.map(fit => {
                const isActive = fit.id === loadedFitId;
                const isPending = pendingDelete === fit.id;
                const pieceCount = (fit.slots || []).filter(Boolean).length;
                return (
                  <div
                    key={fit.id}
                    className={`tryon-saved-card${isActive ? ' active' : ''}`}
                    onClick={() => { if (!isPending) { loadFit(fit); setShowSaved(false); } }}
                  >
                    <div className="tryon-saved-card-name">{fit.name}</div>
                    <div className="tryon-saved-card-meta">
                      {pieceCount} PIECES{isActive ? ' · LOADED' : ''}
                    </div>
                    <button
                      className="tryon-saved-del"
                      onClick={e => {
                        e.stopPropagation();
                        if (isPending) { deleteFit(fit.id); }
                        else { setPendingDelete(fit.id); }
                      }}
                      onBlur={() => { if (isPending) setPendingDelete(null); }}
                      title={isPending ? 'Confirm delete' : 'Delete fit'}
                    >{isPending ? '?' : '×'}</button>
                  </div>
                );
              })}
              {filled.length > 0 && (
                <button
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 8,
                    letterSpacing: '0.15em',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    marginTop: 4,
                  }}
                  onClick={saveFit}
                >{loadedFitId ? 'UPDATE FIT' : '+ SAVE CURRENT FIT'}</button>
              )}
            </div>
          )}

          <div style={{ flex: 1 }} />
          <hr className="tryon-divider" />
          <button className="tryon-clear-btn" onClick={clearSlots}>CLEAR</button>
        </div>

        {/* ── CENTER PANEL ── */}
        <div className="tryon-center">

          {/* Mobile: result label (desktop header hidden on mobile via CSS) */}
          <div className="tryon-mobile-result-label">TRY-ON RESULT</div>

          {/* Desktop: panel header */}
          <div className="tryon-center-header">TRY-ON RESULT</div>

          <ResultArea genState={genState} slots={slots} completedSteps={completedSteps} />

          <ActionButtons
            genState={genState}
            hasChainSlot={hasChainSlot}
            onBack={handleBack}
            onGenerate={handleGenerate}
            onDownload={handleDownload}
          />

          {/* ── MOBILE SLOT STRIP ── */}
          <div className="tryon-mobile-slots">
            {DISPLAY_SLOTS.map(s => {
              const item = slots[s.idx];
              const imgs = item ? parseImageUrls(item.image_url) : [];
              return (
                <div
                  key={s.key}
                  className={`tryon-mobile-slot${item ? ' filled' : ''}`}
                  onClick={item ? () => removeSlot(s.idx) : undefined}
                >
                  <div className="tryon-mobile-slot-thumb">
                    {item
                      ? (imgs.length > 0
                          ? <img src={imgs[0]} alt={item.name} />
                          : <div style={{ width: '100%', height: '100%', background: 'var(--bg3, #e0e0e0)' }} />)
                      : <span className="tryon-mobile-slot-plus">+</span>
                    }
                  </div>
                  <span className="tryon-mobile-slot-label">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* ── MOBILE RACK TOGGLE + GRID ── */}
          <button
            className="tryon-mobile-rack-toggle"
            onClick={() => setRackOpen(o => !o)}
          >
            WARDROBE · {rackItems.length} ITEMS {rackOpen ? '▲' : '▼'}
          </button>

          {rackOpen && (
            <>
              <div style={{ padding: '8px 16px 0', position: 'relative' }}>
                <span style={{
                  position: 'absolute',
                  left: 26,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  marginTop: 4,
                  color: 'var(--text3)',
                  fontSize: 13,
                  pointerEvents: 'none',
                }}>⌕</span>
                <input
                  className="tryon-search-input"
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', padding: '8px 16px 0', overflowX: 'auto', scrollbarWidth: 'none' }}>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    className={`tryon-cat-tab${activeCategory === cat ? ' active' : ''}`}
                    onClick={() => setActiveCategory(cat)}
                  >{cat}</button>
                ))}
              </div>
              <WardrobeGrid
                filteredItems={filteredItems}
                slots={slots}
                addItem={addItem}
                extraClass="tryon-mobile-rack"
              />
            </>
          )}
        </div>

        {/* ── RIGHT PANEL (desktop only) ── */}
        <div className="tryon-right">
          <div className="tryon-right-header">WARDROBE</div>
          {SearchAndCategories}
          <WardrobeGrid
            filteredItems={filteredItems}
            slots={slots}
            addItem={addItem}
          />
        </div>

      </div>

      {showShare && shareCanvas && (
        <ShareModal
          canvas={shareCanvas}
          fitName={fitName}
          slotCount={filled.length}
          totalValue={filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0)}
          user={user}
          onClose={() => { setShowShare(false); setShareCanvas(null); }}
        />
      )}
    </div>
  );
}
