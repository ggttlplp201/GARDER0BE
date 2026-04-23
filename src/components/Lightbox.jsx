import { useEffect, useRef, useState } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

export default function Lightbox({ item, onClose, onEdit }) {
  const panelRef   = useRef(null);
  const shineRef   = useRef(null);
  const stripRef   = useRef(null);
  const idxRef     = useRef(0);
  const isDragRef  = useRef(false);
  const dragStartRef = useRef(0);

  const [idx, setIdx] = useState(0);
  const urls  = item ? parseImageUrls(item.image_url) : [];
  const multi = urls.length > 1;

  useEffect(() => { setIdx(0); idxRef.current = 0; }, [item]);

  useEffect(() => {
    idxRef.current = idx;
    if (stripRef.current && !isDragRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform  = `translateX(${-idx * 100}%)`;
    }
  }, [idx]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape')     onClose();
      if (e.key === 'ArrowLeft')  setIdx(i => (i - 1 + urls.length) % urls.length);
      if (e.key === 'ArrowRight') setIdx(i => (i + 1) % urls.length);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [urls.length, onClose]);

  function handlePanelMove(e) {
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

  function onImgPointerDown(e) {
    if (e.target.closest('.lb-arrow')) return;
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

  if (!item) return null;

  const dateStr = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

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
          onPointerDown={multi ? onImgPointerDown : undefined}
          onPointerMove={multi ? onImgPointerMove : undefined}
          onPointerUp={multi ? onImgPointerUp : undefined}
          onPointerCancel={multi ? onImgPointerUp : undefined}
          style={multi ? { touchAction: 'pan-y' } : undefined}
        >
          {multi ? (
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
          {multi && <>
            <button className="lb-arrow lb-prev" onClick={() => setIdx(i => (i-1+urls.length)%urls.length)}>‹</button>
            <button className="lb-arrow lb-next" onClick={() => setIdx(i => (i+1)%urls.length)}>›</button>
            <div className="lb-counter">{idx+1} / {urls.length}</div>
          </>}
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
