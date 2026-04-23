import { useEffect, useRef, useState } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

const ZOOM_SCALE = 2.8;

export default function Lightbox({ item, onClose, onEdit }) {
  const panelRef   = useRef(null);
  const shineRef   = useRef(null);
  const stripRef   = useRef(null);
  const zoomImgRef = useRef(null);
  const idxRef     = useRef(0);
  const isDragRef  = useRef(false);
  const dragStartRef = useRef(0);

  // Zoom pan state — managed via ref during drag, synced to DOM directly
  const zoomDrag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  const [idx, setIdx]           = useState(0);
  const [zoomActive, setZoomActive] = useState(false);

  const urls  = item ? parseImageUrls(item.image_url) : [];
  const multi = urls.length > 1;

  useEffect(() => { setIdx(0); idxRef.current = 0; setZoomActive(false); }, [item]);

  // Sync strip when idx changes (keyboard / arrow buttons)
  useEffect(() => {
    idxRef.current = idx;
    if (stripRef.current && !isDragRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform  = `translateX(${-idx * 100}%)`;
    }
  }, [idx]);

  // Reset zoom pan when zoom toggled off or image changes
  useEffect(() => {
    if (!zoomActive && zoomImgRef.current) {
      zoomImgRef.current.style.transform = `scale(${ZOOM_SCALE})`;
      zoomDrag.current.baseX = 0;
      zoomDrag.current.baseY = 0;
    }
  }, [zoomActive, idx]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { if (zoomActive) { setZoomActive(false); } else { onClose(); } }
      if (zoomActive) return;
      if (e.key === 'ArrowLeft')  setIdx(i => (i - 1 + urls.length) % urls.length);
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % urls.length);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [urls.length, onClose, zoomActive]);

  function handlePanelMove(e) {
    if (zoomActive) return;
    const panel = panelRef.current; if (!panel) return;
    const r = panel.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    panel.style.transform = `perspective(900px) rotateY(${x*4}deg) rotateX(${-y*4}deg)`;
    if (shineRef.current) {
      shineRef.current.style.opacity = '0.6';
      shineRef.current.style.background = `linear-gradient(${115+x*30}deg,transparent 30%,rgba(255,255,255,${0.05+Math.abs(x)*0.05}) 50%,transparent 70%)`;
    }
  }
  function handlePanelLeave() {
    if (panelRef.current) panelRef.current.style.transform = '';
    if (shineRef.current) shineRef.current.style.opacity = '0';
  }

  // ── Swipe handlers (active when zoom off) ──────────────────────────────
  function onImgPointerDown(e) {
    if (e.target.closest('.lb-arrow') || e.target.closest('.lb-zoom-btn')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragRef.current    = true;
    dragStartRef.current = e.clientX;
    if (stripRef.current) stripRef.current.style.transition = 'none';
  }
  function onImgPointerMove(e) {
    if (!isDragRef.current || !stripRef.current) return;
    const dx = e.clientX - dragStartRef.current;
    stripRef.current.style.transform = `translateX(calc(${-idxRef.current * 100}% + ${dx}px))`;
  }
  function onImgPointerUp(e) {
    if (!isDragRef.current) return;
    isDragRef.current = false;
    const dx         = e.clientX - dragStartRef.current;
    const containerW = e.currentTarget.offsetWidth || 400;
    let newIdx       = idxRef.current;
    if (Math.abs(dx) > containerW * 0.25) {
      newIdx = (idxRef.current + (dx < 0 ? 1 : -1) + urls.length) % urls.length;
    }
    if (stripRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform  = `translateX(${-newIdx * 100}%)`;
    }
    setIdx(newIdx);
  }

  // ── Zoom pan handlers (active when zoom on) ────────────────────────────
  function clampPan(x, y, area) {
    const maxX = (area.offsetWidth  * (ZOOM_SCALE - 1)) / 2;
    const maxY = (area.offsetHeight * (ZOOM_SCALE - 1)) / 2;
    return [Math.max(-maxX, Math.min(maxX, x)), Math.max(-maxY, Math.min(maxY, y))];
  }
  function applyZoom(x, y, transition = false) {
    if (!zoomImgRef.current) return;
    zoomImgRef.current.style.transition = transition ? 'transform 0.12s ease' : 'none';
    zoomImgRef.current.style.transform  = `translate(${x}px,${y}px) scale(${ZOOM_SCALE})`;
  }

  function onZoomPointerDown(e) {
    if (e.target.closest('.lb-zoom-btn') || e.target.closest('.lightbox-close')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = zoomDrag.current;
    d.active = true;
    d.startX = e.clientX;
    d.startY = e.clientY;
    applyZoom(d.baseX, d.baseY);
  }
  function onZoomPointerMove(e) {
    const d = zoomDrag.current;
    if (!d.active) return;
    const area = e.currentTarget;
    const raw  = [d.baseX + e.clientX - d.startX, d.baseY + e.clientY - d.startY];
    const [cx, cy] = clampPan(...raw, area);
    applyZoom(cx, cy);
  }
  function onZoomPointerUp(e) {
    const d = zoomDrag.current;
    if (!d.active) return;
    d.active = false;
    const area = e.currentTarget;
    const [cx, cy] = clampPan(d.baseX + e.clientX - d.startX, d.baseY + e.clientY - d.startY, area);
    d.baseX = cx;
    d.baseY = cy;
    applyZoom(cx, cy, true);
  }

  if (!item) return null;

  const dateStr = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const swipeHandlers = multi && !zoomActive ? {
    onPointerDown: onImgPointerDown, onPointerMove: onImgPointerMove,
    onPointerUp: onImgPointerUp, onPointerCancel: onImgPointerUp,
  } : {};
  const zoomHandlers = zoomActive ? {
    onPointerDown: onZoomPointerDown, onPointerMove: onZoomPointerMove,
    onPointerUp: onZoomPointerUp, onPointerCancel: onZoomPointerUp,
  } : {};

  return (
    <div className="lightbox-bg open" onClick={onClose}>
      <div
        ref={panelRef}
        className="lightbox-panel"
        onClick={e => e.stopPropagation()}
        onMouseMove={handlePanelMove}
        onMouseLeave={handlePanelLeave}
      >
        <button className="lightbox-close" onClick={onClose}>×</button>
        <div ref={shineRef} className="lb-shine" />

        <div
          className="lb-img-area"
          style={{ touchAction: zoomActive ? 'none' : (multi ? 'pan-y' : undefined), cursor: zoomActive ? 'grab' : 'default' }}
          {...swipeHandlers}
          {...zoomHandlers}
        >
          {zoomActive ? (
            <img
              ref={zoomImgRef}
              src={urls[idx]}
              alt={item.name}
              draggable="false"
              style={{ maxWidth: '88%', maxHeight: '88%', objectFit: 'contain', display: 'block',
                       transform: `scale(${ZOOM_SCALE})`, transformOrigin: 'center center',
                       transition: 'transform 0.18s ease', userSelect: 'none' }}
            />
          ) : multi ? (
            <div ref={stripRef} className="lb-img-strip">
              {urls.map((url, i) => (
                <div key={url + i} className="lb-img-slot">
                  <img src={url} alt={item.name} draggable="false" />
                </div>
              ))}
            </div>
          ) : urls.length ? (
            <img src={urls[0]} alt={item.name} />
          ) : (
            <span className="lb-no-img">No image</span>
          )}

          {multi && !zoomActive && <>
            <button className="lb-arrow lb-prev" onClick={() => setIdx(i => (i-1+urls.length)%urls.length)}>‹</button>
            <button className="lb-arrow lb-next" onClick={() => setIdx(i => (i+1)%urls.length)}>›</button>
            <div className="lb-counter">{idx+1} / {urls.length}</div>
          </>}

          <button
            className={`lb-zoom-btn${zoomActive ? ' active' : ''}`}
            onClick={() => setZoomActive(z => !z)}
            title={zoomActive ? 'Exit zoom' : 'Zoom in'}
          >
            {zoomActive ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
            )}
          </button>
        </div>

        <div className="lb-details">
          <div className="lb-name">{item.name || 'Untitled'}</div>
          {item.brand && <div className="lb-brand">{item.brand}</div>}
          {item.type  && <div className="lb-type">{item.type}</div>}
          {item.size  && <div className="lb-size">Size: {item.size}</div>}
          {item.price > 0 && <div className="lb-price">${parseFloat(item.price).toLocaleString()}</div>}
          <button className="lb-edit-btn" onClick={() => { onClose(); onEdit(item.id); }}>EDIT ITEM</button>
          {dateStr && <div className="lb-date">Added {dateStr}</div>}
        </div>
      </div>
    </div>
  );
}
