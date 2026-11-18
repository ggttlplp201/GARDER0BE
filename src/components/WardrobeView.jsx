import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { ITEM_TYPES } from '../lib/constants';
import { acquired, metaLine, serialFor } from '../lib/holoCard';
import Binder from './Binder';
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

// Museum view is temporarily switched off. Flip to true to bring it back;
// its code path below is untouched.
const MUSEUM_ENABLED = false;
const MODES = MUSEUM_ENABLED ? ['MUSEUM', 'PORTFOLIO', 'LIST'] : ['PORTFOLIO', 'LIST'];

export default function WardrobeView({ items = [], loading, loadError, onRetry, onItemClick, onAdd, onRemove }) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = sessionStorage.getItem('wardrobe-mode');
      return MODES.includes(saved) ? saved : 'PORTFOLIO';
    } catch { return 'PORTFOLIO'; }
  });
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [museumProgress, setMuseumProgress] = useState(0);
  const [museumReady, setMuseumReady] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    try { sessionStorage.setItem('wardrobe-mode', mode); } catch { /* Storage can be disabled. */ }
  }, [mode]);

  const filtered = useMemo(() => items.filter(it => {
    if (search) {
      const q = search.toLowerCase();
      if (!it.name?.toLowerCase().includes(q) && !it.brand?.toLowerCase().includes(q)) return false;
    }
    if (filterType !== 'ALL' && it.type !== filterType) return false;
    return true;
  }), [items, search, filterType]);

  // Museum frame data is derived from `items` alone, so each frame object —
  // and its imageUrls array — keeps its identity while you type. Rebuilding
  // these per keystroke re-parsed every image_url and handed every frame fresh
  // props, which re-ran the image pre-decode pass across the whole room.
  const museumById = useMemo(() => {
    const map = new Map();
    items.forEach((item, i) => {
      map.set(item.id, {
        id: item.id,
        cat: catNum(i),
        brand: item.brand || '—',
        name: item.name || 'Untitled',
        type: item.type || '',
        color: item.color || '#888888',
        imageUrls: parseImageUrls(item.image_url),
      });
    });
    return map;
  }, [items]);

  const museumItems = useMemo(
    () => filtered.map(it => museumById.get(it.id)).filter(Boolean),
    [filtered, museumById],
  );

  // Portfolio cards: the binder engine paints the grading label from these
  // pre-formatted fields. Keyed off `items` so filtering keeps object identity.
  const cardById = useMemo(() => {
    const map = new Map();
    items.forEach((item, i) => {
      const acq = acquired(item);
      map.set(item.id, { ...item, cat: catNum(i), meta: metaLine(item), acqDay: acq.day, acqYear: acq.year, serial: serialFor(item.id) });
    });
    return map;
  }, [items]);
  const binderItems = useMemo(
    () => filtered.map(it => cardById.get(it.id)).filter(Boolean),
    [filtered, cardById],
  );

  const handleProgress = useCallback(({ progress }) => {
    setMuseumProgress(progress);
  }, []);

  const handleMuseumItem = useCallback((mi) => {
    const it = items.find(i => i.id === mi.id);
    if (it) onItemClick(it);
  }, [items, onItemClick]);

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
        {MODES.map((m, i, arr) => (
          <button
            key={m}
            onClick={() => setMode(m)}
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
      {mode === 'LIST' && (
        <button onClick={onAdd} className="museum-hud-add">+ ADD</button>
      )}
    </div>
  );

  if (MUSEUM_ENABLED && mode === 'MUSEUM') {
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
            onItem={handleMuseumItem}
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

  // PORTFOLIO / LIST modes
  const itemGlobalIdx = (id) => items.findIndex(i => i.id === id);

  return (
    <div className="v-screen">
      {hud}
      <div className={`v-body${mode === 'PORTFOLIO' ? ' v-body--binder' : ''}`}>
        {loading && mode === 'LIST' && <div className="v-empty">LOADING…</div>}
        {!loading && loadError && (
          <div className="v-empty" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <span>Failed to load items.</span>
            <button onClick={onRetry} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', padding: '8px 20px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}>↻ RETRY</button>
          </div>
        )}

        {!loadError && mode === 'PORTFOLIO' && (
          // Always the binder: an empty category or a fresh wardrobe shows empty
          // pockets, each with a "+" to add an item.
          // While items load the binder warms up WebGL behind one centred loader.
          <Binder items={binderItems} pending={loading} onItemClick={onItemClick} onAdd={onAdd} />
        )}

        {!loading && mode === 'LIST' && (
          <div className="mob-pad" style={{ padding: '0 36px 24px' }}>
            <div className="list-header">
              <div>№</div>
              <div>BRAND · ITEM</div>
              <div>TYPE · COND</div>
              <div>SIZE</div>
              <div>ACQ.</div>
              <div style={{ textAlign: 'right' }}>{/* temporarily disabled: PRICE */}</div>
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
                  <div className="list-price">{/* temporarily disabled: {parseFloat(it.price) ? `$${parseFloat(it.price).toLocaleString()}` : 'N/A'} */}</div>
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
