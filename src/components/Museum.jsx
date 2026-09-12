import { useEffect, useRef, useState } from 'react';
import MuseumCss from './MuseumCss';
import './Museum.css';

const EMPTY_ITEMS = [];

export default function Museum({ items = EMPTY_ITEMS, onItem, hideOverlays = false, onProgress }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const callbacksRef = useRef({ onItem, onProgress, hideOverlays });
  const itemsRef = useRef(items);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState({ progress: 0, nearest: null });

  useEffect(() => { callbacksRef.current = { onItem, onProgress, hideOverlays }; }, [onItem, onProgress, hideOverlays]);
  useEffect(() => {
    itemsRef.current = items;
    if (!engineRef.current) return;
    // Let a burst of search input settle before rebuilding room materials.
    // Initial creation below still starts immediately with the latest items.
    const timer = window.setTimeout(() => { void engineRef.current?.setItems(itemsRef.current); }, 100);
    return () => window.clearTimeout(timer);
  }, [items]);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let engine;
    import('./museum/engine.js').then(({ createMuseum }) => {
      if (cancelled || !hostRef.current) return;
      engine = createMuseum(hostRef.current, {
        onItem: item => callbacksRef.current.onItem?.(item),
        onProgress: next => {
          if (cancelled) return;
          callbacksRef.current.onProgress?.(next);
          if (!callbacksRef.current.hideOverlays) setStatus(next);
        },
        onReady: () => { if (!cancelled) setReady(true); },
        onError: error => {
          console.warn('Museum renderer unavailable; using the CSS gallery.', error);
          if (!cancelled) setFailed(true);
        },
      });
      engineRef.current = engine;
      void engine.setItems(itemsRef.current);
    }).catch(error => {
      console.warn('Museum renderer could not load; using the CSS gallery.', error);
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; engineRef.current = null; engine?.dispose(); };
  }, [failed]);

  if (failed) return <MuseumCss items={items} onItem={onItem} hideOverlays={hideOverlays} onProgress={onProgress} />;

  return (
    <div className="museum-webgl" aria-label="Wardrobe museum">
      <div className="museum-canvas-host" ref={hostRef} />
      {!ready && <div className="museum-render-loading" role="status">Preparing gallery…</div>}
      {!hideOverlays && (
        <>
          <div className="museum-render-progress">{String(Math.round(status.progress * 100)).padStart(2, '0')}%</div>
          <div className="museum-render-caption">{status.nearest?.item.name}</div>
        </>
      )}
      {items.map(item => (
        <button key={item.id} className="museum-item-access" onFocus={() => engineRef.current?.focusItem(item.id)} onBlur={() => engineRef.current?.clearFocus()} onClick={() => onItem?.(item)}>
          View {item.brand} — {item.name}
        </button>
      ))}
    </div>
  );
}
