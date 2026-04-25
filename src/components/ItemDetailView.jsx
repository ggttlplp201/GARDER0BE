import { useState, useRef, useEffect, useCallback } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { sb } from '../lib/supabase';
import { API_URL } from '../lib/constants';

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

async function getToken() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token ?? '';
}

function PriceSources({ item }) {
  const [sources, setSources]     = useState([]);
  const [loadingSrc, setLoadingSrc] = useState(true);
  const [srcName, setSrcName]     = useState('');
  const [srcUrl, setSrcUrl]       = useState('');
  const [adding, setAdding]       = useState(false);
  const [refreshing, setRefreshing] = useState(null);
  const [error, setError]         = useState('');

  const load = useCallback(async () => {
    setLoadingSrc(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wishlist/${item.id}/prices`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSources((await res.json()).sources ?? []);
    } finally {
      setLoadingSrc(false);
    }
  }, [item.id]);

  useEffect(() => { load(); }, [load]);

  async function addSource() {
    setError('');
    if (!srcName.trim() || !srcUrl.trim()) return;
    setAdding(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/wishlist/${item.id}/sources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_name: srcName.trim(), source_url: srcUrl.trim() }),
      });
      if (res.ok) {
        const newSrc = await res.json().catch(() => ({}));
        setSrcName(''); setSrcUrl('');
        await load();
        if (newSrc?.id) refreshSource(newSrc.id);
      } else { const b = await res.json().catch(() => ({})); setError(b.detail ?? 'Failed to add source.'); }
    } catch (err) {
      setError(`Network error: ${err.message}`);
    } finally {
      setAdding(false);
    }
  }

  async function removeSource(id) {
    setError('');
    try {
      const token = await getToken();
      await fetch(`${API_URL}/wishlist/sources/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await load();
    } catch (err) {
      setError(`Network error: ${err.message}`);
    }
  }

  async function refreshSource(id) {
    setRefreshing(id);
    setError('');
    try {
      const res = await fetch(`${API_URL}/wishlist/sources/${id}/refresh`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.detail ?? 'Refresh failed.');
      }
      await load();
    } catch (err) {
      setError(`Network error: ${err.message}`);
    } finally {
      setRefreshing(null);
    }
  }

  return (
    <div className="price-sources">
      <div className="price-sources-hd">
        <span>PRICE SOURCES</span>
        <span className="price-sources-hint">SSENSE · FARFETCH · MYTHERESA · GRAILED · STOCKX · JUSTIN REED · KITH · END</span>
      </div>

      {loadingSrc ? (
        <div className="price-src-empty">LOADING…</div>
      ) : sources.length === 0 ? (
        <div className="price-src-empty">NO SOURCES — ADD ONE BELOW</div>
      ) : (
        <div className="price-src-list">
          {sources.map(src => (
            <div key={src.id} className="price-src-row">
              <a className="price-src-name" href={src.source_url} target="_blank" rel="noopener noreferrer">{src.source_name.toUpperCase()}</a>
              <div className="price-src-price">
                {src.last_price ? `$${parseFloat(src.last_price).toLocaleString()}` : '—'}
              </div>
              <div className="price-src-date">
                {src.last_seen_at
                  ? new Date(src.last_seen_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.')
                  : 'NEVER'}
              </div>
              <div className="price-src-btns">
                <button
                  className="price-src-btn"
                  onClick={() => refreshSource(src.id)}
                  disabled={refreshing === src.id}
                  title="Refresh price"
                >
                  {refreshing === src.id ? '…' : '↻'}
                </button>
                <button
                  className="price-src-btn"
                  onClick={() => removeSource(src.id)}
                  title="Remove source"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="price-src-error">{error}</div>}

      <div className="price-src-form">
        <input
          className="price-src-input"
          placeholder="SOURCE  (e.g. SSENSE)"
          value={srcName}
          onChange={e => setSrcName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSource()}
        />
        <input
          className="price-src-input price-src-url"
          placeholder="PRODUCT PAGE URL"
          value={srcUrl}
          onChange={e => setSrcUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSource()}
        />
        <button
          className="price-src-add"
          type="button"
          onClick={addSource}
          disabled={adding || !srcName.trim() || !srcUrl.trim()}
        >
          {adding ? '…' : '+ ADD'}
        </button>
      </div>
    </div>
  );
}

export default function ItemDetailView({ item, items, onBack, onEdit, onNavigate, onRemove, onLogWear }) {
  const [imgIdx, setImgIdx]       = useState(0);
  const [wearLogged, setWear]     = useState(false);
  const [delConfirm, setDelConfirm] = useState(false);
  const delTimer = useRef(null);

  if (!item) return null;

  const imgs = parseImageUrls(item.image_url);
  const idx  = items.findIndex(i => i.id === item.id);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx < items.length - 1 ? items[idx + 1] : null;
  const cat  = catNum(idx);

  const dateStr = item.created_at
    ? new Date(item.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '.')
    : '—';

  const wearCount = item.wear_count || 0;
  const fields = [
    ['TYPE',      item.type      || '—'],
    ['CONDITION', item.condition || '—'],
    ['SIZE',      item.size      || '—'],
    ['STATUS',    (item.status || 'owned').toUpperCase()],
    ['ACQUIRED',  dateStr],
    ['PRICE',     parseFloat(item.price) ? `$${parseFloat(item.price).toLocaleString()}` : 'N/A'],
    ['WORN',      `${wearCount}×`],
  ];

  function logWear() {
    if (onLogWear) onLogWear(item.id);
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
              {onRemove && (
                <button
                  className={`det-btn${delConfirm ? ' det-btn-danger' : ''}`}
                  onClick={() => {
                    if (delConfirm) {
                      clearTimeout(delTimer.current);
                      onRemove(item.id);
                      onBack();
                    } else {
                      setDelConfirm(true);
                      delTimer.current = setTimeout(() => setDelConfirm(false), 2500);
                    }
                  }}
                >{delConfirm ? 'CONFIRM?' : 'DELETE'}</button>
              )}
            </div>

            {item.status === 'wishlist' && <PriceSources item={item} />}
          </div>
        </div>
      </div>
    </div>
  );
}
