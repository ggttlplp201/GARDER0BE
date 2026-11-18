import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Binder.css';

const EMPTY_ITEMS = [];
const ITEMS_PER_PAGE = 9;
const ITEMS_PER_SPREAD = ITEMS_PER_PAGE * 2;

// Card textures are painted on canvas, so the faces must be loaded first.
const FONT_FACES = [
  "700 21px 'Inter Tight'",
  "700 13px 'JetBrains Mono'",
  "400 13px 'JetBrains Mono'",
  "500 13px 'JetBrains Mono'",
];

function firstImage(item) {
  if (Array.isArray(item.image_url)) return item.image_url[0];
  if (!item.image_url) return null;
  try {
    const parsed = JSON.parse(item.image_url);
    if (Array.isArray(parsed)) return parsed[0];
  } catch { /* A single image URL is also supported. */ }
  return item.image_url;
}

function ItemList({ items, onItemClick, images = false }) {
  return (
    <ul className={images ? 'binder-card-list' : 'binder-item-list'}>
      {items.map(item => {
        const image = images ? firstImage(item) : null;
        return (
          <li key={item.id}>
            <button type="button" onClick={() => onItemClick?.(item)}>
              {images && (
                <span className="binder-card-image">
                  {image ? <img src={image} alt="" loading="lazy" /> : <span>NO IMAGE</span>}
                </span>
              )}
              <span className="binder-item-copy">
                <span className="binder-item-brand">{item.brand || '—'}</span>
                <span className="binder-item-name">{item.name || 'Untitled'}</span>
                {item.type && <span className="binder-item-type">{item.type}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const POCKET_RX = 17;
const REST = { rx: -8, ry: 18 };
const norm = v => ((v % 360) + 540) % 360 - 180;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pull-out card inspector. Owns the overlay's rAF loop, pointer/wheel input and
 * the pocket → centre → pocket flight; React only renders the overlay chrome.
 */
class Inspector {
  constructor({ getEngine, onPicked, onZoom }) {
    this.getEngine = getEngine;
    this.onPicked = onPicked;
    this.onZoom = onZoom;
    this.els = {};
    this.item = null;
    this.insp = null;
    this.anim = null;
    this.raf = 0;
    this.ptrs = new Map();
    this.zoomPct = 100;
  }

  baseS() { return Math.min((innerHeight * .68) / 214, (innerWidth * .55) / 152, 3.2); }
  pocketPose() {
    const r = this.from, vx = innerWidth / 2, vy = innerHeight / 2 - 28;
    return { x: r.left + r.width / 2 - vx, y: r.top + r.height / 2 - vy, s: r.width / 152, h: r.height };
  }

  runPath(dir, done) {
    const P = this.pocketPose(), S = this.baseS();
    const sIn = dir === 'in' ? P.s : this.zc * S, sOut = dir === 'in' ? S : P.s;
    const r0 = dir === 'in' ? { rx: POCKET_RX, ry: 0 } : { rx: this.rx, ry: this.ry };
    const r1 = dir === 'in' ? REST : { rx: POCKET_RX, ry: 0 };
    this.zoom = this.zc = 1;
    const dur = reducedMotion() ? 1 : (dir === 'in' ? 1000 : 900);
    this.anim = { dir, t0: performance.now(), dur, P, sIn, sOut, r0, r1, done };
  }
  stepAnim(now) {
    const a = this.anim, k = Math.min(1, (now - a.t0) / a.dur);
    const io = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const u = a.dir === 'in' ? io : 1 - io;
    const q = (p0, p1, p2) => (1 - u) * (1 - u) * p0 + 2 * (1 - u) * u * p1 + u * u * p2;
    const rE = a.dir === 'in' ? Math.min(1, Math.max(0, (k - .15) / .85)) : Math.min(1, k / .85);
    const rs = rE * rE * (3 - 2 * rE);
    this.rx = a.r0.rx + (a.r1.rx - a.r0.rx) * rs;
    this.ry = a.r0.ry + (a.r1.ry - a.r0.ry) * rs;
    this.pose = { x: q(a.P.x, a.P.x, 0), y: q(a.P.y, a.P.y - a.P.h * 1.15, 0), s: a.sIn + (a.sOut - a.sIn) * io };
    if (k >= 1) { const d = a.done; this.anim = null; d?.(); }
  }
  paint() {
    if (!this.insp || !this.pose) return;
    this.insp.setPose({ x: this.pose.x, y: this.pose.y, s: this.pose.s * (this.anim ? 1 : this.zc), rx: this.rx, ry: this.ry });
  }

  /** Called from the binder engine's onItem. */
  open(item, rect) {
    if (this.item || this.closing || !this.getEngine()) return;
    this.from = rect || { left: innerWidth / 2 - 40, top: innerHeight / 2 - 56, width: 80, height: 112 };
    this.rx = POCKET_RX; this.ry = 0; this.vx = 0; this.vy = 0; this.zoom = 1; this.zc = 1; this.tgt = null;
    this.item = item;
    this.setZoom(1);
    this.onPicked(item);      // React renders the overlay, then calls mount()
  }
  mount() {
    const engine = this.getEngine();
    if (!engine || !this.item || this.insp || !this.els.host) return;
    this.insp = engine.createInspector(this.els.host, this.item);
    this.runPath('in');
    this.stepAnim(performance.now());
    this.paint();
    engine.setHidden(this.item.id);
    if (!reducedMotion()) {
      this.els.back?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
      this.els.ui?.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 650, fill: 'backwards' });
    }
    this.bind();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  loop = now => {
    if (!this.item) return;
    if (this.anim) this.stepAnim(now);
    else {
      if (!this.dragging) {
        if (this.tgt) {
          this.rx += (this.tgt.rx - this.rx) * .1; this.ry += (this.tgt.ry - this.ry) * .1;
          if (Math.abs(this.tgt.rx - this.rx) + Math.abs(this.tgt.ry - this.ry) < .05) { this.rx = this.tgt.rx; this.ry = this.tgt.ry; this.tgt = null; }
        } else if (Math.abs(this.vx) + Math.abs(this.vy) > .02) {
          this.ry += this.vx; this.rx += this.vy; this.vx *= .94; this.vy *= .94;
        }
      }
      this.zc += (this.zoom - this.zc) * .18;
      this.pose = { x: 0, y: 0, s: this.baseS() };
    }
    this.paint();
    if (this.item) this.raf = requestAnimationFrame(this.loop);
  };

  bind() {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
  }
  unbind() {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKey);
  }

  onDown = e => {
    if (this.closing || this.anim) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.moved = 0; this.dragging = true; this.tgt = null; this.vx = this.vy = 0;
    if (this.els.stage) this.els.stage.style.cursor = 'grabbing';
  };
  onMove = e => {
    if (!this.dragging || !this.ptrs.has(e.pointerId)) return;
    const p = this.ptrs.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const [a2, b2] = [...this.ptrs.values()], d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (d0 > 0) this.setZoom(this.zoom * d1 / d0);
      this.moved += 10; return;
    }
    p.x = e.clientX; p.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    this.ry += dx * .5; this.rx -= dy * .5; this.vx = dx * .5; this.vy = -dy * .5;
  };
  onUp = e => {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size) return;
    this.dragging = false;
    if (this.els.stage) this.els.stage.style.cursor = 'grab';
    if (this.moved < 5 && !(this.insp && this.insp.hit(e.clientX, e.clientY))) this.close();
  };
  onWheel = e => { if (!this.item) return; e.preventDefault(); this.setZoom(this.zoom * Math.exp(-e.deltaY * .0015)); };
  onKey = e => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };

  setZoom(z) {
    this.zoom = Math.max(.6, Math.min(2.6, z));
    const pct = Math.round(this.zoom * 100);
    if (pct !== this.zoomPct) { this.zoomPct = pct; this.onZoom(pct); }
  }
  zoomIn = () => this.setZoom(this.zoom * 1.25);
  zoomOut = () => this.setZoom(this.zoom / 1.25);
  flip = () => { if (this.anim) return; this.vx = this.vy = 0; this.tgt = { rx: 0, ry: Math.round((this.ry + 180) / 180) * 180 }; };
  reset = () => {
    if (this.anim) return;
    this.rx = norm(this.rx); this.ry = norm(this.ry); this.vx = this.vy = 0; this.tgt = { ...REST }; this.setZoom(1);
  };

  close = () => {
    if (!this.item || this.closing || !this.insp) return;
    this.closing = true; this.dragging = false; this.vx = this.vy = 0; this.tgt = null;
    this.rx = norm(this.rx); this.ry = norm(this.ry);
    const r = this.getEngine()?.rectFor(this.item.id); if (r) this.from = r;
    if (!reducedMotion()) {
      this.els.back?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-in', fill: 'forwards' });
      this.els.ui?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    }
    this.runPath('out', () => {
      this.getEngine()?.setHidden(null);
      requestAnimationFrame(() => this.teardown());
    });
  };
  /** Immediate teardown (no flight): used after the put-back flight and on unmount. */
  teardown() {
    cancelAnimationFrame(this.raf);
    this.unbind();
    this.ptrs.clear();
    this.insp?.dispose(); this.insp = null;
    this.anim = null; this.closing = false; this.dragging = false;
    if (this.item) { this.getEngine()?.setHidden(null); this.item = null; this.onPicked(null); }
  }
}

export default function Binder({ items = EMPTY_ITEMS, pending = false, onItemClick, onAdd }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const itemsRef = useRef(items);
  const callbackRef = useRef(onItemClick);
  const addRef = useRef(onAdd);
  const inspRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState({ open: false, busy: false, spread: 0, pageCount: 0 });
  const [picked, setPicked] = useState(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [binderZoom, setBinderZoom] = useState(100);

  useEffect(() => { callbackRef.current = onItemClick; }, [onItemClick]);
  useEffect(() => { addRef.current = onAdd; }, [onAdd]);
  useEffect(() => {
    itemsRef.current = items;
    if (!engineRef.current) return;
    // Settle a burst of filtering before rebuilding card textures.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (inspRef.current?.item) inspRef.current.teardown();
      try {
        Promise.resolve(engineRef.current?.setItems(itemsRef.current)).catch(() => {
          if (!cancelled) setFailed(true);
        });
      } catch { setFailed(true); }
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [items]);

  useEffect(() => {
    const insp = new Inspector({
      getEngine: () => engineRef.current,
      onPicked: setPicked,
      onZoom: setZoomPct,
    });
    inspRef.current = insp;
    return () => { insp.teardown(); inspRef.current = null; };
  }, []);

  // Overlay is in the DOM → build the WebGL inspector on top of it.
  useLayoutEffect(() => { if (picked) inspRef.current?.mount(); }, [picked]);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let engine;
    const fontsReady = document.fonts
      ? Promise.all(FONT_FACES.map(f => document.fonts.load(f))).catch(() => {})
      : Promise.resolve();
    fontsReady
      .then(() => import('./binder/engine.js'))
      .then(({ createBinder }) => {
        if (cancelled || !hostRef.current) return;
        engine = createBinder(hostRef.current, {
          onItem: (item, rect) => { if (!cancelled) inspRef.current?.open(item, rect); },
          onAdd: () => { if (!cancelled) addRef.current?.(); },
          onZoom: pct => { if (!cancelled) setBinderZoom(pct); },
          onState: next => { if (!cancelled) setState(next); },
          onReady: () => { if (!cancelled) setReady(true); },
          onError: error => {
            console.warn('Binder unavailable; showing the collection.', error);
            if (!cancelled) setFailed(true);
          },
        });
        engineRef.current = engine;
        return engine.setItems(itemsRef.current);
      })
      .catch(error => {
        console.warn('Binder could not load; showing the collection.', error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      inspRef.current?.teardown();
      engineRef.current = null;
      engine?.dispose();
    };
  }, [failed]);

  const showLoader = !ready || pending;
  const pageCount = state.pageCount || Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const firstPage = state.spread * 2 + 1;
  const lastPage = Math.min(firstPage + 1, pageCount);
  const pageLabel = firstPage === lastPage ? `Page ${firstPage}` : `Pages ${firstPage}–${lastPage}`;
  const visibleItems = items.slice(state.spread * ITEMS_PER_SPREAD, (state.spread + 1) * ITEMS_PER_SPREAD);
  const previousDisabled = !ready || !state.open || state.busy || state.spread === 0 || !!picked;
  const nextDisabled = !ready || !state.open || state.busy || lastPage >= pageCount || !!picked;

  function handleKeyDown(event) {
    if (picked) return; // the inspector owns the keyboard while open (portal events bubble here)
    if (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' && !previousDisabled) {
      event.preventDefault();
      engineRef.current?.turn(-1);
    } else if (event.key === 'ArrowRight' && !nextDisabled) {
      event.preventDefault();
      engineRef.current?.turn(1);
    }
  }

  function openDetails() {
    const insp = inspRef.current;
    const item = insp?.item;
    if (!item) return;
    insp.teardown();
    callbackRef.current?.(item);
  }

  return (
    <section className={`binder${failed ? ' binder--fallback' : ''}`} aria-label="Card portfolio" onKeyDown={handleKeyDown}>
      {!failed && (
        <>
          <div className="binder-stage" tabIndex={0} aria-label={state.open ? 'Open portfolio. Use the left and right arrow keys to turn pages. Select a card to pull it out.' : 'Closed portfolio. Use the Open binder button to view your cards.'}>
            <div className={`binder-canvas-host${showLoader ? '' : ' is-ready'}`} ref={hostRef} />
            <div className={`binder-loading${showLoader ? '' : ' is-done'}`} role="status" aria-hidden={!showLoader}>
              <span className="binder-loading-label">PREPARING YOUR BINDER</span>
              <span className="binder-loading-bar" />
            </div>
          </div>
          <div className="binder-toolbar">
            <span className="binder-count">{pending ? '' : `${items.length} ${items.length === 1 ? 'ITEM' : 'ITEMS'}`}</span>
            <div className="binder-controls">
              <button type="button" className="binder-control" onClick={() => engineRef.current?.turn(-1)} disabled={previousDisabled} aria-label="Previous pages">←</button>
              <button type="button" className="binder-control binder-toggle" onClick={() => engineRef.current?.toggle()} disabled={showLoader || state.busy || !!picked} aria-expanded={state.open}>
                {state.open ? 'CLOSE BINDER' : 'OPEN BINDER'}
              </button>
              <button type="button" className="binder-control" onClick={() => engineRef.current?.turn(1)} disabled={nextDisabled} aria-label="Next pages">→</button>
            </div>
            <div className="binder-right">
              <div className="binder-zoom" role="group" aria-label="Binder zoom">
                <button type="button" onClick={() => engineRef.current?.zoomBy(1 / 1.2)} disabled={!ready || binderZoom <= 56} aria-label="Zoom out">−</button>
                <button type="button" className="binder-zoom-pct" onClick={() => engineRef.current?.resetZoom()} disabled={!ready} aria-label={`Zoom ${binderZoom}%. Reset to 100%`}>{binderZoom}%</button>
                <button type="button" onClick={() => engineRef.current?.zoomBy(1.2)} disabled={!ready || binderZoom >= 181} aria-label="Zoom in">+</button>
              </div>
              <span className="binder-pagination" role="status" aria-live="polite">
                {pending ? '' : state.open ? `${pageLabel} / ${pageCount}` : `${pageCount} ${pageCount === 1 ? 'PAGE' : 'PAGES'}`}
              </span>
            </div>
          </div>
        </>
      )}
      {failed && <p className="binder-fallback-note" role="status">Showing your collection as cards. Select an item to view it.</p>}
      {failed ? (
        <div className="binder-fallback-items" aria-label="Collection items">
          <ItemList items={items} onItemClick={onItemClick} images />
        </div>
      ) : !showLoader && state.open ? (
        <details className="binder-index">
          <summary>ITEMS ON THESE PAGES <span>{visibleItems.length}</span></summary>
          <ItemList items={visibleItems} onItemClick={onItemClick} />
        </details>
      ) : null}

      {picked && createPortal(
        <div className="binder-inspect" role="dialog" aria-modal="true" aria-label={`${picked.brand || ''} ${picked.name || 'Item'}`.trim()}>
          <div className="binder-inspect-back" ref={el => { if (inspRef.current) inspRef.current.els.back = el; }} />
          <div
            className="binder-inspect-stage"
            ref={el => { if (inspRef.current) inspRef.current.els.stage = el; }}
            onPointerDown={e => inspRef.current?.onDown(e)}
          >
            <div className="binder-inspect-host" ref={el => { if (inspRef.current) inspRef.current.els.host = el; }} />
          </div>
          <div className="binder-inspect-ui" ref={el => { if (inspRef.current) inspRef.current.els.ui = el; }}>
            <div className="binder-inspect-bar" onPointerDown={e => e.stopPropagation()}>
              <button type="button" onClick={() => inspRef.current?.zoomOut()} aria-label="Zoom out">−</button>
              <span className="binder-inspect-pct" aria-live="polite">{zoomPct}%</span>
              <button type="button" onClick={() => inspRef.current?.zoomIn()} aria-label="Zoom in">+</button>
              <button type="button" className="txt" onClick={() => inspRef.current?.flip()}>FLIP</button>
              <button type="button" className="txt" onClick={() => inspRef.current?.reset()}>RESET</button>
              {onItemClick && <button type="button" className="txt" onClick={openDetails}>DETAILS</button>}
              <button type="button" className="txt primary" onClick={() => inspRef.current?.close()} autoFocus>PUT BACK ✕</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
