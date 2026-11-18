import { useState, useRef, useEffect, useMemo } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { sb } from '../lib/supabase';
import FitDeck from './FitDeck';

function ItemThumb({ item }) {
  const imgs = parseImageUrls(item?.image_url);
  if (!item) return <div style={{ background: 'var(--bg2)', width: '100%', height: '100%' }} />;
  return imgs.length > 0
    ? <img src={imgs[0]} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    : <div className="rack-img-placeholder" style={{ height: '100%' }}><span>{(item.brand || '').slice(0, 3)}</span></div>;
}

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

  // Light background matching the app's OOTD builder aesthetic
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 26px "Courier New", monospace';
  ctx.fillText(fitName, 40, 58);
  const filled = slots.filter(Boolean);
  // const value = filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0); // temporarily disabled
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.font = '13px "Courier New", monospace';
  ctx.fillText(`${filled.length} PIECES`, 40, 85); // temporarily disabled: `  ·  $${Math.round(value).toLocaleString()}`

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, 105); ctx.lineTo(W - 40, 105); ctx.stroke();

  // Layout mirrors OOTD builder: ACC | center stack | BAG
  const bodyTop = 112, bodyH = 758;
  const accX = 20,     accW = 130;
  const centerX = 175, centerW = 400;
  const bagX = 600,    bagW = 165;

  // Center stack: HAT → TOP → BOTTOM → SHOE with breathing room between each
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

  // ACC slots: vertically centred in body
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

  // BAG slot: vertically centred in body
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


const EMPTY_SLOTS = Array(10).fill(null);

export default function OutfitsView({ items, user }) {
  const [slots, setSlots]         = useState(EMPTY_SLOTS);
  const [fitName, setFitName]     = useState('UNTITLED');
  const [savedFits, setSavedFits] = useState([]);
  const [loadedFitId, setLoadedFitId]   = useState(null);
  const [showSaved, setShowSaved]       = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [shareCanvas, setShareCanvas]   = useState(null);
  const [showShare,   setShowShare]     = useState(false);
  const deckRef = useRef(null);

  // Load fits from Supabase (or fall back to localStorage for guests)
  useEffect(() => {
    if (!user?.id) {
      try { setSavedFits(JSON.parse(localStorage.getItem('garderobe-saved-fits') || '[]')); } catch { /* ignore */ }
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
          // Migrate any localStorage fits to Supabase on first load
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
          } catch { /* ignore */ }
        }
      });
  }, [user?.id]);

  const deckItems = useMemo(() => items.filter(it => it.status !== 'wishlist' && it.type !== 'Other'), [items]);

  const filled = slots.filter(Boolean);
  const value  = filled.reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  const clearFit = () => {
    setFitName('UNTITLED');
    setLoadedFitId(null);
  };

  const loadFit = (fit) => {
    const padded = [...fit.slots, ...Array(10)].slice(0, 10).map(v => v ?? null);
    deckRef.current?.loadFit(padded);
    setSlots(padded);
    setFitName(fit.name);
    setLoadedFitId(fit.id);
  };

  const saveFit = async () => {
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
        setSavedFits(f => [...f, { id: Date.now(), name: fitName, slots: [...slots] }]);
      }
    }
    deckRef.current?.newFit();
    clearFit();
  };

  const handleShare = async () => {
    if (!filled.length) return;
    const meta = await sb.auth.getUser();
    const username = meta?.data?.user?.user_metadata?.profile?.['p-name'] || '';
    const c = await renderFitCanvas(slots, fitName, username);
    setShareCanvas(c);
    setShowShare(true);
  };

  return (
    <div className="deal-screen">
      <div className="deal-header">
        <div className="deal-title">OOTD</div>
        <button
          className={`deal-btn-outline${showSaved ? ' active' : ''}`}
          onClick={() => setShowSaved(s => !s)}
          aria-expanded={showSaved}
        >SAVED FITS · {savedFits.length}</button>
      </div>

      <div className="deal-body">
        {showSaved && (
          <div className="deal-saved">
            {savedFits.length === 0 && (
              <div className="v-empty">No saved fits yet. Deal a fit and save it to see it here.</div>
            )}
            <div className="saved-fits-grid">
              {savedFits.map(fit => {
                const isActive = fit.id === loadedFitId;
                const isPending = pendingDelete === fit.id;
                return (
                  <div
                    key={fit.id}
                    className="saved-fit-card"
                    onClick={() => { if (!isPending) { loadFit(fit); setShowSaved(false); } }}
                    style={{
                      cursor: isPending ? 'default' : 'pointer',
                      border: isActive ? '1px solid var(--text)' : '1px solid var(--border)',
                      position: 'relative',
                    }}
                  >
                    <button
                      className="saved-fit-del"
                      onClick={e => {
                        e.stopPropagation();
                        if (isPending) {
                          setSavedFits(f => f.filter(x => x.id !== fit.id));
                          if (loadedFitId === fit.id) { deckRef.current?.newFit(); clearFit(); }
                          setPendingDelete(null);
                          if (user?.id) sb.from('saved_fits').delete().eq('id', fit.id).eq('user_id', user.id);
                        } else {
                          setPendingDelete(fit.id);
                        }
                      }}
                      onBlur={() => { if (isPending) setPendingDelete(null); }}
                      title={isPending ? 'Confirm delete' : 'Delete fit'}
                    >{isPending ? '?' : '×'}</button>
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

        <FitDeck
          ref={deckRef}
          items={deckItems}
          fitName={fitName}
          onFitNameChange={setFitName}
          onSlotsChange={setSlots}
          onNewFit={clearFit}
          onSave={saveFit}
          onShare={handleShare}
          saveLabel={loadedFitId ? '✓ UPDATE FIT' : '+ SAVE FIT'}
        />
      </div>

      {showShare && shareCanvas && (
        <ShareModal
          canvas={shareCanvas}
          fitName={fitName}
          slotCount={filled.length}
          totalValue={value}
          user={user}
          onClose={() => { setShowShare(false); setShareCanvas(null); }}
        />
      )}
    </div>
  );
}
