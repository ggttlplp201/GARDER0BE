import { useRef, useState } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

export default function ItemCard({ item, onRemove, onEdit, onClick }) {
  const cardRef   = useRef(null);
  const shineRef  = useRef(null);
  const [imgIdx, setImgIdx] = useState(0);
  const imgUrls   = parseImageUrls(item.image_url);
  const multiImg  = imgUrls.length > 1;
  const dateStr   = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  function handleMouseMove(e) {
    const card = cardRef.current; if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    card.style.transform = `perspective(500px) rotateY(${x*16}deg) rotateX(${-y*16}deg) scale(1.04) translateZ(10px)`;
    if (shineRef.current) {
      shineRef.current.style.opacity = '1';
      shineRef.current.style.background = `linear-gradient(${115+x*30}deg, transparent 30%, rgba(255,255,255,${0.3+Math.abs(x)*0.3}) 50%, transparent 70%)`;
    }
  }
  function handleMouseLeave() {
    if (cardRef.current) cardRef.current.style.transform = '';
    if (shineRef.current) shineRef.current.style.opacity = '0';
  }

  function handleCardClick(e) {
    if (e.target.closest('.card-remove-x') || e.target.closest('.edit-btn') || e.target.closest('.card-img-arrow')) return;
    onClick(item.id);
  }

  function nav(dir, e) {
    e.stopPropagation();
    setImgIdx(i => (i + dir + imgUrls.length) % imgUrls.length);
  }

  return (
    <div
      ref={cardRef}
      className="item-card"
      onClick={handleCardClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <button className="card-remove-x" onClick={e => { e.stopPropagation(); onRemove(item.id); }} title="Remove">×</button>
      <div className="card-image-area">
        {imgUrls.length
          ? <img src={imgUrls[imgIdx]} alt={item.name} />
          : <span style={{ fontSize: 13, color: '#aaa' }}>No image</span>
        }
        {multiImg && <>
          <button className="card-img-arrow card-img-prev" onClick={e => nav(-1, e)}>‹</button>
          <button className="card-img-arrow card-img-next" onClick={e => nav(1, e)}>›</button>
          <div className="card-img-counter">{imgIdx + 1}/{imgUrls.length}</div>
        </>}
        {dateStr && <div className="card-date">{dateStr}</div>}
        <div ref={shineRef} className="card-shine" />
      </div>
      <div className="card-info">
        <div className="card-name">{item.name || 'Untitled'}</div>
        <div className="card-brand">Brand: {item.brand || '—'}</div>
        <div className="card-type">Type: {item.type}</div>
        {item.size  && <div className="card-type">Size: {item.size}</div>}
        {item.price > 0 && <div className="card-price">${parseFloat(item.price).toLocaleString()}</div>}
        <button className="edit-btn" onClick={e => { e.stopPropagation(); onEdit(item.id); }}>EDIT</button>
      </div>
    </div>
  );
}
