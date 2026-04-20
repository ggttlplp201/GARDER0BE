import { useEffect, useRef, useState } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

export default function Lightbox({ item, onClose, onEdit }) {
  const panelRef = useRef(null);
  const shineRef = useRef(null);
  const [idx, setIdx] = useState(0);
  const urls = item ? parseImageUrls(item.image_url) : [];
  const multi = urls.length > 1;

  useEffect(() => { setIdx(0); }, [item]);

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
        <div className="lb-img-area">
          {urls.length
            ? <img src={urls[idx]} alt={item.name} />
            : <span className="lb-no-img">No image</span>
          }
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
