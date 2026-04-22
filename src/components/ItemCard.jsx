import { useRef, useState, useEffect } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { gyroState, gyroCallbacks, isGyroActive } from '../lib/gyro';

export default function ItemCard({ item, onRemove, onEdit, onClick }) {
  const cardRef         = useRef(null);
  const shineRef        = useRef(null);
  const confirmTimer    = useRef(null);
  const gyroCallbackRef = useRef(null);
  const reducedMotion   = useRef(typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isTouch         = useRef(typeof window !== 'undefined' && 'ontouchstart' in window);
  const [imgIdx, setImgIdx]         = useState(0);
  const [confirming, setConfirming] = useState(false);
  const imgUrls  = parseImageUrls(item.image_url);
  const multiImg = imgUrls.length > 1;
  const dateStr  = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  useEffect(() => {
    if (!isTouch.current || reducedMotion.current) return;
    const card  = cardRef.current;
    const shine = shineRef.current;
    gyroCallbackRef.current = () => {
      if (!card) return;
      const x = Math.max(-1, Math.min(1, gyroState.x));
      const y = Math.max(-1, Math.min(1, gyroState.y));
      card.style.transform = `perspective(600px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.02)`;
      if (shine) {
        shine.style.opacity = '0.6';
        shine.style.background = `linear-gradient(${115 + x * 30}deg, transparent 30%, rgba(255,255,255,${0.15 + Math.abs(x) * 0.15}) 50%, transparent 70%)`;
      }
    };
    gyroCallbacks.add(gyroCallbackRef.current);
    return () => {
      if (gyroCallbackRef.current) gyroCallbacks.delete(gyroCallbackRef.current);
      if (card) card.style.transform = '';
      if (shine) shine.style.opacity = '0';
    };
  }, []);

  function handleMouseMove(e) {
    if (reducedMotion.current || isGyroActive()) return;
    const card = cardRef.current; if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    card.style.transform = `perspective(500px) rotateY(${x * 16}deg) rotateX(${-y * 16}deg) scale(1.04) translateZ(10px)`;
    if (shineRef.current) {
      shineRef.current.style.opacity = '1';
      shineRef.current.style.background = `linear-gradient(${115 + x * 30}deg, transparent 30%, rgba(255,255,255,${0.3 + Math.abs(x) * 0.3}) 50%, transparent 70%)`;
    }
  }
  function handleMouseLeave() {
    if (isGyroActive()) return;
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
      role="button"
      tabIndex={0}
      aria-label={item.name || 'Untitled item'}
      onClick={handleCardClick}
      onKeyDown={e => e.key === 'Enter' && handleCardClick(e)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <button
        className={`card-remove-x${confirming ? ' confirming' : ''}`}
        aria-label={confirming ? 'Confirm delete' : 'Delete item'}
        onClick={e => {
          e.stopPropagation();
          if (confirming) {
            clearTimeout(confirmTimer.current);
            onRemove(item.id);
          } else {
            setConfirming(true);
            confirmTimer.current = setTimeout(() => setConfirming(false), 2500);
          }
        }}
      >{confirming ? '?' : '×'}</button>
      <div className="card-image-area">
        {imgUrls.length
          ? <img src={imgUrls[imgIdx]} alt={item.name} />
          : <span style={{ fontSize: 13, color: '#aaa' }}>No image</span>
        }
        {multiImg && <>
          <button className="card-img-arrow card-img-prev" aria-label="Previous image" onClick={e => nav(-1, e)}>‹</button>
          <button className="card-img-arrow card-img-next" aria-label="Next image" onClick={e => nav(1, e)}>›</button>
          <div className="card-img-counter">{imgIdx + 1}/{imgUrls.length}</div>
        </>}
        {dateStr && <div className="card-date">{dateStr}</div>}
        <div ref={shineRef} className="card-shine" />
      </div>
      <div className="card-info">
        {item.status === 'wishlist' && <span className="card-status-badge">WISHLIST</span>}
        <div className="card-name">{item.name || 'Untitled'}</div>
        <div className="card-brand">{item.brand || '—'}</div>
        <div className="card-type">{item.type}{item.condition ? ` · ${item.condition}` : ''}</div>
        {item.size  && <div className="card-type">{item.size}</div>}
        {item.price > 0 && <div className="card-price">${parseFloat(item.price).toLocaleString()}</div>}
        <button className="edit-btn" onClick={e => { e.stopPropagation(); onEdit(item.id); }}>EDIT</button>
      </div>
    </div>
  );
}
