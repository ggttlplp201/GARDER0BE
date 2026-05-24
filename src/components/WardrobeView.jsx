import { useState, useRef, useCallback, useEffect } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { ITEM_TYPES } from '../lib/constants';
import ItemCard from './ItemCard';
import Museum from './Museum';

function useConfirm() {
  const [pending, setPending] = useState(null);
  const timer = useRef(null);
  function arm(id) {
    clearTimeout(timer.current);
    setPending(id);
    timer.current = setTimeout(() => setPending(null), 2500);
  }
  function disarm() { clearTimeout(timer.current); setPending(null); }
  return { pending, arm, disarm };
}

function catNum(idx) {
  return String(idx + 1).padStart(3, '0');
}

const TYPES = ['ALL', ...ITEM_TYPES];

export default function WardrobeView({ items = [], loading, loadError, onRetry, onItemClick, onAdd, onEdit, onRemove }) {
  const [mode, setMode] = useState(() => sessionStorage.getItem('wardrobe-mode') || 'MUSEUM');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [museumProgress, setMuseumProgress] = useState(0);
  const [museumReady, setMuseumReady] = useState(false);
  const confirm = useConfirm();

  const filtered = items.filter(it => {
    if (search) {
      const q = search.toLowerCase();
      if (!it.name?.toLowerCase().includes(q) && !it.brand?.toLowerCase().includes(q)) return false;
    }
    if (filterType !== 'ALL' && it.type !== filterType) return false;
    return true;
  });

  const totalValue = items
    .filter(i => i.status !== 'wishlist')
    .reduce((s, i) => s + (parseFloat(i.price) || 0), 0);
  const brands = new Set(items.map(i => i.brand).filter(Boolean));
  const grails = items.filter(i => i.status === 'grail').length;

  const statsStr = [
    String(items.length),
    `${brands.size} BRANDS`,
    `$${Math.round(totalValue).toLocaleString()}`,
    grails ? `${grails} GRAILS` : null,
  ].filter(Boolean).join(' · ');

  const idxMap = new Map(items.map((item, i) => [item.id, i]));
  const museumItems = filtered.map((item) => ({
    id: item.id,
    cat: catNum(idxMap.get(item.id) ?? 0),
    brand: item.brand || '—',
    name: item.name || 'Untitled',
    type: item.type || '',
    color: item.color || '#888888',
    imageUrl: parseImageUrls(item.image_url)[0] || null,
  }));

  const handleProgress = useCallback(({ progress }) => {
    setMuseumProgress(progress);
  }, []);

  useEffect(() => {
    if (mode !== 'MUSEUM') { setMuseumReady(false); return; }
    if (loading || loadError || items.length === 0) return;
    const t = setTimeout(() => setMuseumReady(true), 120);
    return () => clearTimeout(t);
  }, [mode, loading, loadError, items.length]);

  useEffect(() => {
    if (mode === 'MUSEUM') {
      document.body.classList.add('museum-mode');
    } else {
      document.body.classList.remove('museum-mode');
    }
    return () => document.body.classList.remove('museum-mode');
  }, [mode]);

  const hud = (
    <div className={`museum-hud${mode !== 'MUSEUM' ? ' museum-hud--static' : ''}`}>
      <div className="mode-toggle">
        {['MUSEUM', 'GRID', 'LIST'].map((m, i, arr) => (
          <button
            key={m}
            onClick={() => { setMode(m); sessionStorage.setItem('wardrobe-mode', m); }}
            className={`mode-btn${mode === m ? ' active' : ''}${i < arr.length - 1 ? ' bd-r' : ''}`}
          >{m}</button>
        ))}
      </div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="SEARCH…"
        className="museum-hud-search"
      />
      {mode !== 'MUSEUM' && (
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="museum-hud-select"
        >
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      )}
      {mode !== 'MUSEUM' && (
        <button onClick={onAdd} className="museum-hud-add">+ ADD</button>
      )}
    </div>
  );

  if (mode === 'MUSEUM') {
    return (
      <div className="museum-wrap">
        {hud}
        {/* Full-screen cover — hides app chrome and unrendered corridor until ready */}
        <div className={`museum-cover${museumReady ? ' museum-cover--revealed' : ''}`}>
          {loadError ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <span>FAILED TO LOAD</span>
              <button onClick={onRetry} className="museum-cover-retry">↻ RETRY</button>
            </div>
          ) : !loading && items.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <span>WARDROBE EMPTY</span>
              <button onClick={onAdd} className="museum-hud-add">+ ADD FIRST ITEM</button>
            </div>
          ) : (
            <span className="museum-cover-loading">LOADING</span>
          )}
        </div>
        {!loading && !loadError && items.length > 0 && (
          <Museum
            items={museumItems}
            onItem={(mi) => { const it = items.find(i => i.id === mi.id); if (it) onItemClick(it); }}
            hideOverlays
            onProgress={handleProgress}
          />
        )}
        {!loading && museumReady && museumItems.length === 0 && items.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 60, left: 0, right: 0, zIndex: 50,
            textAlign: 'center', pointerEvents: 'none',
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.22em',
            color: 'rgba(245,242,234,0.5)',
          }}>NO ITEMS MATCH</div>
        )}
        <div className="museum-progress-top">
          {String(Math.round(museumProgress * 100)).padStart(2, '0')}%
        </div>
      </div>
    );
  }

  // GRID / LIST modes
  const itemGlobalIdx = (id) => items.findIndex(i => i.id === id);

  return (
    <div className="v-screen">
      {hud}
      <div className="v-body">
        {loading && <div className="v-empty">LOADING…</div>}
        {!loading && loadError && (
          <div className="v-empty" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <span>Failed to load items.</span>
            <button onClick={onRetry} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', padding: '8px 20px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>↻ RETRY</button>
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
              <div />
            </div>
            {filtered.map(it => {
              const gi = itemGlobalIdx(it.id);
              const dateStr = it.created_at
                ? new Date(it.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).replace(/\//g, '.')
                : '—';
              const isPending = confirm.pending === it.id;
              return (
                <div key={it.id} className="list-row" onClick={() => { if (!isPending) onItemClick(it); }}>
                  <div className="list-cat">{catNum(gi)}</div>
                  <div>
                    <div className="list-brand-sm">{it.brand || '—'}</div>
                    <div className="list-item-name">{it.name || 'Untitled'}</div>
                  </div>
                  <div className="list-meta">{it.type}{it.condition ? ` · ${it.condition}` : ''}</div>
                  <div className="list-meta">{it.size || '—'}</div>
                  <div className="list-meta">{dateStr}</div>
                  <div className="list-price">{parseFloat(it.price) ? `$${parseFloat(it.price).toLocaleString()}` : 'N/A'}</div>
                  <button
                    className={`rack-del${isPending ? ' confirming' : ''}`}
                    style={{ marginLeft: 8 }}
                    onClick={e => {
                      e.stopPropagation();
                      if (isPending) { onRemove(it.id); confirm.disarm(); }
                      else confirm.arm(it.id);
                    }}
                  >{isPending ? '?' : '×'}</button>
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
