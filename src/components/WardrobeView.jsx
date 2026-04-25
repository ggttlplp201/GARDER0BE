import { useState, useRef } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { isGyroActive } from '../lib/gyro';
import { ITEM_TYPES } from '../lib/constants';
import ItemCard from './ItemCard';

function Hanger({ size = 34 }) {
  return (
    <svg width={size} height={size * 0.64} viewBox="0 0 44 28" style={{ display: 'block' }}>
      <path d="M22 4 L22 10 M6 22 L22 10 L38 22 L6 22" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      <circle cx="22" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" fill="var(--bg)" />
    </svg>
  );
}

function catNum(idx) {
  return String(idx + 1).padStart(3, '0');
}

function RackCard({ item, globalIdx, onClick }) {
  const cardRef  = useRef(null);
  const shineRef = useRef(null);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const imgs = parseImageUrls(item.image_url);
  const stripRef    = useRef(null);
  const imgIdxRef   = useRef(0);
  const isDragRef   = useRef(false);
  const dragStartRef = useRef(0);
  const didSwipeRef = useRef(false);
  const [imgIdx, setImgIdx] = useState(0);
  const multiImg = imgs.length > 1;

  function handleMouseMove(e) {
    if (reducedMotion || isGyroActive()) return;
    const card = cardRef.current; if (!card) return;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(500px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) scale(1.04) translateZ(8px)`;
    if (shineRef.current) {
      const dk = document.documentElement.classList.contains('dark');
      shineRef.current.style.opacity = dk ? '0.4' : '1';
      shineRef.current.style.background = `linear-gradient(${115 + x * 30}deg, transparent 30%, rgba(255,255,255,${(0.28 + Math.abs(x) * 0.28) * (dk ? 0.4 : 1)}) 50%, transparent 70%)`;
    }
  }
  function handleMouseLeave() {
    if (isGyroActive()) return;
    if (cardRef.current) cardRef.current.style.transform = '';
    if (shineRef.current) shineRef.current.style.opacity = '0';
  }

  function onImgPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.rack-arrow')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragRef.current = true; dragStartRef.current = e.clientX; didSwipeRef.current = false;
    if (stripRef.current) stripRef.current.style.transition = 'none';
  }
  function onImgPointerMove(e) {
    if (!isDragRef.current || !stripRef.current) return;
    stripRef.current.style.transform = `translateX(calc(${-imgIdxRef.current * 100}% + ${e.clientX - dragStartRef.current}px))`;
  }
  function onImgPointerUp(e) {
    if (!isDragRef.current) return;
    isDragRef.current = false;
    const dx = e.clientX - dragStartRef.current;
    const w = e.currentTarget.offsetWidth || 200;
    let ni = imgIdxRef.current;
    if (Math.abs(dx) > w * 0.25) { ni = (ni + (dx < 0 ? 1 : -1) + imgs.length) % imgs.length; didSwipeRef.current = true; }
    if (stripRef.current) {
      stripRef.current.style.transition = 'transform 0.22s ease';
      stripRef.current.style.transform = `translateX(${-ni * 100}%)`;
    }
    setImgIdx(ni); imgIdxRef.current = ni;
  }

  return (
    <div
      ref={cardRef}
      className="rack-card"
      onClick={() => { if (!didSwipeRef.current) onClick(item); didSwipeRef.current = false; }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
    >
      <div className="rack-hanger"><Hanger size={28} /></div>
      <div className="rack-cat">№ {catNum(globalIdx)}</div>
      <div
        className="rack-img"
        onPointerDown={multiImg ? onImgPointerDown : undefined}
        onPointerMove={multiImg ? onImgPointerMove : undefined}
        onPointerUp={multiImg ? onImgPointerUp : undefined}
        onPointerCancel={multiImg ? onImgPointerUp : undefined}
      >
        {imgs.length > 0 ? (
          multiImg ? (
            <div ref={stripRef} className="rack-img-strip">
              {imgs.map((url, i) => (
                <div key={i} className="rack-img-slot"><img src={url} alt={item.name} draggable="false" /></div>
              ))}
            </div>
          ) : (
            <img src={imgs[0]} alt={item.name} />
          )
        ) : (
          <div className="rack-img-placeholder">
            <span>{(item.brand || '').split(' ')[0] || 'IMG'}</span>
          </div>
        )}
        {multiImg && (
          <div className="rack-img-count">{imgIdx + 1}/{imgs.length}</div>
        )}
        <div ref={shineRef} className="card-shine" />
      </div>
      <div className="rack-brand">{item.brand || '—'}</div>
      <div className="rack-name">{item.name || 'Untitled'}</div>
    </div>
  );
}

const TYPES = ['ALL', ...ITEM_TYPES];

export default function WardrobeView({ items, loading, loadError, onRetry, onItemClick, onAdd, onEdit, onRemove }) {
  const [mode, setMode]         = useState('RACK');
  const [search, setSearch]     = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const filtered = items.filter(it => {
    if (search) {
      const q = search.toLowerCase();
      if (!it.name?.toLowerCase().includes(q) && !it.brand?.toLowerCase().includes(q)) return false;
    }
    if (filterType !== 'ALL' && it.type !== filterType) return false;
    return true;
  });

  const totalValue = items.filter(i => i.status !== 'wishlist').reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const brands = new Set(items.map(i => i.brand).filter(Boolean));
  const grails = items.filter(i => i.status === 'grail').length;
  const thisYear = new Date().getFullYear();
  const ytd = items
    .filter(i => i.status !== 'wishlist' && i.created_at && new Date(i.created_at).getFullYear() === thisYear)
    .reduce((s, i) => s + (parseFloat(i.price) || 0), 0);

  const grouped = {};
  filtered.forEach(it => {
    const b = (it.brand || 'Uncategorized').trim();
    if (!grouped[b]) grouped[b] = [];
    grouped[b].push(it);
  });
  const brandKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  const itemGlobalIdx = (id) => items.findIndex(i => i.id === id);

  return (
    <div className="v-screen">
      <div className="stat-bar">
        {[
          ['ITEMS', String(items.length).padStart(2, '0')],
          ['BRANDS', String(brands.size).padStart(2, '0')],
          ['VALUE', '$' + Math.round(totalValue).toLocaleString()],
          ['GRAILS', String(grails).padStart(2, '0')],
          ['YTD +', '$' + Math.round(ytd).toLocaleString()],
        ].map(([k, v], i, arr) => (
          <div key={k} className={`stat-cell${i < arr.length - 1 ? ' bd-r' : ''}`}>
            <div className="stat-key">{k}</div>
            <div className="stat-val">{v}</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <div className="mode-toggle">
          {['RACK', 'GRID', 'LIST'].map((m, i, arr) => (
            <button key={m} onClick={() => setMode(m)}
              className={`mode-btn${mode === m ? ' active' : ''}${i < arr.length - 1 ? ' bd-r' : ''}`}>
              {m}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="SEARCH NAME, BRAND…" className="toolbar-search" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="toolbar-select">
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <button onClick={onAdd} className="toolbar-add">+ NEW ENTRY</button>
      </div>

      <div className="v-body">
        {loading && <div className="v-empty">LOADING…</div>}
        {!loading && loadError && (
          <div className="v-empty" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <span>Failed to load items.</span>
            <button onClick={onRetry} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', padding: '8px 20px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>↻ RETRY</button>
          </div>
        )}

        {!loading && mode === 'RACK' && (
          <div className="mob-pad" style={{ padding: '0 36px 24px' }}>
            {brandKeys.length === 0 && <div className="v-empty">No items match your filters.</div>}
            {brandKeys.map((brand, bi) => (
              <div key={brand} style={{ marginTop: bi === 0 ? 0 : 32 }}>
                <div className="rack-section-header">
                  <div className="rack-brand-title">
                    {brand} <span className="rack-brand-count">({grouped[brand].length})</span>
                  </div>
                  <div className="rack-rail-num">RAIL {String(bi + 1).padStart(2, '0')}</div>
                </div>
                <div className="rack-rule" />
                <div className="rack-rail-wrap">
                  <div className="rack-rail-line" />
                  <div className="rack-cards">
                    {grouped[brand].map(it => (
                      <RackCard key={it.id} item={it} globalIdx={itemGlobalIdx(it.id)} onClick={onItemClick} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && mode === 'GRID' && (
          <div className="cards-grid" style={{ padding: '16px 36px 24px' }}>
            {filtered.map(it => (
              <ItemCard key={it.id} item={it} onRemove={onRemove} onEdit={onEdit}
                onClick={id => onItemClick(items.find(i => i.id === id))} />
            ))}
            {filtered.length === 0 && <div className="v-empty">No items match your filters.</div>}
          </div>
        )}

        {!loading && mode === 'LIST' && (
          <div className="mob-pad" style={{ padding: '0 36px 24px' }}>
            <div className="list-header">
              <div>№</div>
              <div>BRAND · ITEM</div>
              <div>TYPE · COND</div>
              <div>SIZE</div>
              <div>ACQ.</div>
              <div style={{ textAlign: 'right' }}>PRICE</div>
            </div>
            {filtered.map(it => {
              const gi = itemGlobalIdx(it.id);
              const dateStr = it.created_at
                ? new Date(it.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.')
                : '—';
              return (
                <div key={it.id} className="list-row" onClick={() => onItemClick(it)}>
                  <div className="list-cat">{catNum(gi)}</div>
                  <div>
                    <div className="list-brand-sm">{it.brand || '—'}</div>
                    <div className="list-item-name">{it.name || 'Untitled'}</div>
                  </div>
                  <div className="list-meta">{it.type}{it.condition ? ` · ${it.condition}` : ''}</div>
                  <div className="list-meta">{it.size || '—'}</div>
                  <div className="list-meta">{dateStr}</div>
                  <div className="list-price">{parseFloat(it.price) ? `$${parseFloat(it.price).toLocaleString()}` : 'N/A'}</div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="v-empty">No items match your filters.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
