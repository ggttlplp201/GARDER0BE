import { useRef, useState, useEffect } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { detailOrigin } from '../lib/detailOrigin';
import { registerHoloCard } from '../lib/holoTicker';
import { acquired, serialFor, metaLine, catNo } from '../lib/holoCard';
import './holo.css';

const RING_Z = [-10, -8.5, -7, -5.5, -4, -2.5, -1];

// Holographic "graded slab" item card: acrylic case + grading label + recessed
// item card with pearl foil, glare and pointer/gyro tilt (see holoTicker.js).
export default function ItemCard({ item, index, onRemove, onEdit, onClick }) {
  const wrapRef      = useRef(null);
  const cardRef      = useRef(null);
  const holoRef      = useRef(null);
  const confirmTimer = useRef(null);

  const stripRef     = useRef(null);
  const imgIdxRef    = useRef(0);
  const isDragRef    = useRef(false);
  const dragStartRef = useRef(0);
  const didSwipeRef  = useRef(false);

  const [imgIdx, setImgIdx]         = useState(0);
  const [confirming, setConfirming] = useState(false);

  const imgUrls  = parseImageUrls(item.image_url);
  const multiImg = imgUrls.length > 1;
  const acq      = acquired(item);
  const meta     = metaLine(item);

  useEffect(() => {
    holoRef.current = registerHoloCard(wrapRef.current, cardRef.current);
    return () => { holoRef.current?.unregister(); holoRef.current = null; };
  }, []);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  // Sync strip position when imgIdx changes (arrow buttons, etc.)
  useEffect(() => {
    imgIdxRef.current = imgIdx;
    if (stripRef.current && !isDragRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform  = `translateX(${-imgIdx * 100}%)`;
    }
  }, [imgIdx]);

  function handlePointerMove(e) {
    if (e.pointerType === 'touch') return;
    const r = wrapRef.current.getBoundingClientRect();
    holoRef.current?.setPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }
  function handlePointerLeave() { holoRef.current?.release(); }

  function handleCardClick(e) {
    if (didSwipeRef.current) { didSwipeRef.current = false; return; }
    if (e.target.closest('.holo-x') || e.target.closest('.holo-edit') || e.target.closest('.card-img-arrow')) return;
    detailOrigin.rect = cardRef.current?.getBoundingClientRect() ?? null;
    onClick(item.id);
  }

  function nav(dir, e) {
    e.stopPropagation();
    setImgIdx(i => (i + dir + imgUrls.length) % imgUrls.length);
  }

  function onImgPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.card-img-arrow')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragRef.current    = true;
    dragStartRef.current = e.clientX;
    didSwipeRef.current  = false;
    if (stripRef.current) stripRef.current.style.transition = 'none';
  }
  function onImgPointerMove(e) {
    if (!isDragRef.current || !stripRef.current) return;
    const dx = e.clientX - dragStartRef.current;
    stripRef.current.style.transform = `translateX(calc(${-imgIdxRef.current * 100}% + ${dx}px))`;
  }
  function onImgPointerUp(e) {
    if (!isDragRef.current) return;
    isDragRef.current = false;
    const dx         = e.clientX - dragStartRef.current;
    const containerW = e.currentTarget.offsetWidth || 200;
    const len        = imgUrls.length;
    let newIdx       = imgIdxRef.current;
    if (Math.abs(dx) > containerW * 0.25) {
      newIdx = (imgIdxRef.current + (dx < 0 ? 1 : -1) + len) % len;
      didSwipeRef.current = true;
    }
    if (stripRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform  = `translateX(${-newIdx * 100}%)`;
    }
    setImgIdx(newIdx);
  }

  return (
    <div ref={wrapRef} className="holo-cell" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
      <div
        ref={cardRef}
        className="holo-card"
        role="button"
        tabIndex={0}
        aria-label={item.name || 'Untitled item'}
        onClick={handleCardClick}
        onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) handleCardClick(e); }}
      >
        <div className="holo-back" />
        {RING_Z.map(z => <div key={z} className="holo-ring" style={{ transform: `translateZ(${z}px)` }} />)}

        <div className="holo-face">
          <div className="holo-label">
            <div className="holo-label-main">
              <div className="holo-mark"><span>GARDER0BE</span><span className="holo-mark-no">№ {catNo(index)}</span></div>
              <div className="holo-brand">{item.brand || '—'}</div>
              <div className="holo-name">{item.name || 'Untitled'}</div>
              <div className="holo-code">
                <div className="holo-barcode" />
                <span className="holo-serial">{serialFor(item.id)}</span>
                <div className="holo-sticker" />
              </div>
            </div>
            <div className="holo-acq">
              <div className="holo-acq-k">ACQ.</div>
              <div className="holo-acq-d">{acq.day}</div>
              {acq.year && <div className="holo-acq-y">{acq.year}</div>}
            </div>
          </div>

          <div className="holo-well">
            <div className="holo-item">
              <div
                className="holo-photo"
                onPointerDown={multiImg ? onImgPointerDown : undefined}
                onPointerMove={multiImg ? onImgPointerMove : undefined}
                onPointerUp={multiImg ? onImgPointerUp : undefined}
                onPointerCancel={multiImg ? onImgPointerUp : undefined}
                style={multiImg ? { touchAction: 'pan-y' } : undefined}
              >
                {multiImg ? (
                  <div ref={stripRef} className="card-img-strip">
                    {imgUrls.map((url, i) => (
                      <div key={url + i} className="card-img-slot">
                        <img src={url} alt={item.name} draggable="false" loading="lazy" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="holo-photo-inset">
                    {imgUrls.length
                      ? <img src={imgUrls[0]} alt={item.name} draggable="false" loading="lazy" />
                      : <span className="holo-noimg">NO IMAGE</span>}
                  </div>
                )}
                {multiImg && <>
                  <button className="card-img-arrow card-img-prev" aria-label="Previous image" onClick={e => nav(-1, e)}>‹</button>
                  <button className="card-img-arrow card-img-next" aria-label="Next image" onClick={e => nav(1, e)}>›</button>
                  <div className="card-img-counter">{imgIdx + 1}/{imgUrls.length}</div>
                </>}
              </div>

              <div className="holo-info">
                {item.status === 'wishlist' && <span className="holo-wish">WISHLIST</span>}
                <div className="holo-meta">
                  <span>{meta || '—'}</span>
                  <span>{item.size || ''}</span>
                </div>
                <button className="holo-edit" onClick={e => { e.stopPropagation(); onEdit(item.id); }}>EDIT</button>
              </div>

              <div className="holo-foil" />
              <div className="holo-spot" />
              <button
                className={`holo-x${confirming ? ' confirming' : ''}`}
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
            </div>
          </div>
        </div>

        <div className="holo-glare" />
        <div className="holo-rim" />
      </div>
    </div>
  );
}
