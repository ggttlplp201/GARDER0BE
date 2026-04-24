import { useState, useRef, useEffect, useCallback } from 'react';
import { parseImageUrls } from '../lib/imageUtils';

function catNum(idx) {
  return String(idx + 1).padStart(3, '0');
}

function DetailCarousel({ imgs, imgIdx, onNav }) {
  const stripRef  = useRef(null);
  const idxRef    = useRef(imgIdx);
  const dragRef   = useRef(false);
  const startXRef = useRef(0);
  const didSwipe  = useRef(false);

  const moveTo = useCallback((i, animate = true) => {
    idxRef.current = i;
    if (!stripRef.current) return;
    stripRef.current.style.transition = animate ? 'transform 0.28s ease' : 'none';
    stripRef.current.style.transform  = `translateX(${-i * 100}%)`;
  }, []);

  // Set initial position without animation on mount
  useEffect(() => { moveTo(imgIdx, false); }, []); // eslint-disable-line

  // Sync when parent changes imgIdx (thumbnail click)
  useEffect(() => {
    if (idxRef.current !== imgIdx) moveTo(imgIdx, true);
  }, [imgIdx, moveTo]);

  function nav(dir) {
    const next = (idxRef.current + dir + imgs.length) % imgs.length;
    moveTo(next, true);
    onNav(next);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.detail-img-arrow')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = true; startXRef.current = e.clientX; didSwipe.current = false;
    if (stripRef.current) stripRef.current.style.transition = 'none';
  }
  function onPointerMove(e) {
    if (!dragRef.current || !stripRef.current) return;
    stripRef.current.style.transform = `translateX(calc(${-idxRef.current * 100}% + ${e.clientX - startXRef.current}px))`;
  }
  function onPointerUp(e) {
    if (!dragRef.current) return;
    dragRef.current = false;
    const dx = e.clientX - startXRef.current;
    const w  = e.currentTarget.offsetWidth || 400;
    let ni = idxRef.current;
    if (Math.abs(dx) > w * 0.2) {
      ni = (ni + (dx < 0 ? 1 : -1) + imgs.length) % imgs.length;
      didSwipe.current = true;
    }
    moveTo(ni, true);
    onNav(ni);
  }

  if (!imgs.length) return (
    <div className="detail-main-img">
      <div className="detail-img-placeholder" />
    </div>
  );

  return (
    <div
      className="detail-main-img"
      onPointerDown={imgs.length > 1 ? onPointerDown : undefined}
      onPointerMove={imgs.length > 1 ? onPointerMove : undefined}
      onPointerUp={imgs.length > 1 ? onPointerUp : undefined}
      onPointerCancel={imgs.length > 1 ? onPointerUp : undefined}
      style={{ overflow: 'hidden', cursor: imgs.length > 1 ? 'grab' : 'default', userSelect: 'none' }}
    >
      {/* Strip — position controlled entirely via ref, no JSX transform */}
      <div ref={stripRef} style={{ display: 'flex', width: '100%', height: '100%' }}>
        {imgs.map((url, i) => (
          <div key={i} style={{ flexShrink: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={url} alt="" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} draggable="false" />
          </div>
        ))}
      </div>
      {imgs.length > 1 && (
        <>
          <button className="detail-img-arrow detail-img-arrow-l" onClick={() => nav(-1)}>‹</button>
          <button className="detail-img-arrow detail-img-arrow-r" onClick={() => nav(1)}>›</button>
        </>
      )}
    </div>
  );
}

export default function ItemDetailView({ item, items, onBack, onEdit, onNavigate }) {
  const [imgIdx, setImgIdx]   = useState(0);
  const [wearLogged, setWear] = useState(false);

  if (!item) return null;

  const imgs = parseImageUrls(item.image_url);
  const idx  = items.findIndex(i => i.id === item.id);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx < items.length - 1 ? items[idx + 1] : null;
  const cat  = catNum(idx);

  const dateStr = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.')
    : '—';

  const fields = [
    ['TYPE',      item.type      || '—'],
    ['CONDITION', item.condition || '—'],
    ['SIZE',      item.size      || '—'],
    ['STATUS',    (item.status || 'owned').toUpperCase()],
    ['ACQUIRED',  dateStr],
    ['PRICE',     parseFloat(item.price) ? `$${parseFloat(item.price).toLocaleString()}` : 'N/A'],
  ];

  function logWear() {
    setWear(true);
    setTimeout(() => setWear(false), 2000);
  }

  return (
    <div className="v-screen">
      <div className="detail-nav">
        <button className="detail-back" onClick={onBack}>← WARDROBE / ACQUISITIONS / № {cat}</button>
        <div className="detail-nav-arrows">
          {prev && (
            <button className="detail-nav-btn" onClick={() => { onNavigate(prev); setImgIdx(0); }}>
              ← PRIOR №{catNum(items.indexOf(prev))}
            </button>
          )}
          {next && (
            <button className="detail-nav-btn" onClick={() => { onNavigate(next); setImgIdx(0); }}>
              NEXT №{catNum(items.indexOf(next))} →
            </button>
          )}
        </div>
      </div>

      <div className="v-body" style={{ overflow: 'hidden', display: 'flex' }}>
        <div className="detail-cols" style={{ flex: 1 }}>
          <div className="detail-left">
            <div className="detail-plate-meta">
              <span>PLATE {String(imgIdx + 1).padStart(2, '0')} / {String(Math.max(imgs.length, 1)).padStart(2, '0')}</span>
              <span>FIG. A · FULL FRONT</span>
            </div>

            <DetailCarousel imgs={imgs} imgIdx={imgIdx} onNav={setImgIdx} />

            {imgs.length > 1 && (
              <div className="detail-thumbs">
                {imgs.map((url, i) => (
                  <div key={i} className={`detail-thumb${i === imgIdx ? ' active' : ''}`} onClick={() => setImgIdx(i)}>
                    <img src={url} alt="" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="detail-right">
            <div className="detail-brand-label">{item.brand || '—'}</div>
            <div className="detail-item-name">{item.name || 'Untitled'}</div>

            <div className="detail-entry-block">
              <div className="detail-cat-num">{cat}</div>
              <div className="detail-entry-lines">
                <div>ENTRY № {cat}</div>
                <div>ACQ. {dateStr}</div>
                <div>COND. {(item.condition || '—').toUpperCase()} · SIZE {item.size || '—'} · {parseFloat(item.price) ? `$${parseFloat(item.price).toLocaleString()}` : 'N/A'}</div>
              </div>
            </div>

            <div className="detail-fields">
              {fields.map(([k, v]) => (
                <div key={k} className="detail-field">
                  <div className="detail-field-key">{k}</div>
                  <div className="detail-field-val">{v}</div>
                </div>
              ))}
            </div>

            <div className="detail-actions">
              <button className={`det-btn det-btn-primary${wearLogged ? ' logged' : ''}`} onClick={logWear}>
                {wearLogged ? '✓ LOGGED' : '+ LOG WEAR'}
              </button>
              <button className="det-btn" onClick={() => onEdit(item.id)}>EDIT</button>
              <button className="det-btn">SELL</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
