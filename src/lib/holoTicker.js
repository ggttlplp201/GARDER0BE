// One requestAnimationFrame loop that drives every holographic slab card.
// Each card registers a small state object; the loop eases it toward its
// pointer/gyro target and writes transform + CSS custom properties directly
// to the DOM (never through React state). Off-screen cards are skipped.
import { gyroState, isGyroActive } from './gyro';

const TILT = 18;       // max hover tilt (deg)
const REST_TILT = 5;   // resting lean back (deg)

const cards = new Set();
let raf = 0;
let io = null;

function observer() {
  if (io || typeof IntersectionObserver === 'undefined') return io;
  io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const s = e.target.__holo;
      if (s) s.visible = e.isIntersecting;
    }
  }, { rootMargin: '120px' });
  return io;
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function write(s, t) {
  const gyro = isGyroActive();
  if (gyro) {
    s.tx = Math.max(0, Math.min(1, .5 + gyroState.x * .5));
    s.ty = Math.max(0, Math.min(1, .5 + gyroState.y * .5));
    s.ta = 1;
  }
  const k = s.ta ? .16 : .07;
  s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; s.a += (s.ta - s.a) * .12;
  const a = s.a, ia = 1 - a;
  const ax = .5 + Math.sin(t * .5 + s.ph) * .14, ay = .5 + Math.cos(t * .37 + s.ph) * .12;
  const px = ax * ia + s.x * a, py = ay * ia + s.y * a;
  const dx = s.x - .5, dy = s.y - .5;
  const rx = (REST_TILT + Math.cos(t * .6 + s.ph) * .7) * ia + (-dy * TILT * 2) * a;
  const ry = Math.sin(t * .45 + s.ph) * 1.6 * ia + dx * TILT * 2 * a;
  const st = s.card.style;
  st.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${(1 + .04 * a).toFixed(4)})`;
  st.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
  st.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  st.setProperty('--bgx', `${(50 + (px - .5) * 60).toFixed(1)}%`);
  st.setProperty('--bgy', `${(50 + (py - .5) * 60).toFixed(1)}%`);
  st.setProperty('--sx', `${(50 + (px - .5) * 160).toFixed(1)}%`);
  st.setProperty('--gx', `${(40 - ry * 1.6).toFixed(1)}%`);
  st.setProperty('--gy', `${(40 + rx * 1.2).toFixed(1)}%`);
  st.setProperty('--o', a.toFixed(3));
  st.setProperty('--ang', `${(Math.atan2(py - .5, px - .5) * 180 / Math.PI + 90).toFixed(1)}deg`);
  st.setProperty('--ang2', `${(118 + (px - .5) * 30).toFixed(1)}deg`);
  st.setProperty('--shx', `${(-ry * .9).toFixed(1)}px`);
  st.setProperty('--shy', `${(16 + rx * 1.2).toFixed(1)}px`);
  st.setProperty('--shb', `${(30 + 14 * a).toFixed(1)}px`);
  const active = a > .01 && !gyro;
  if (active !== s.active) { s.active = active; s.wrap.classList.toggle('is-active', active); }
}

function tick(now) {
  const t = now / 1000;
  for (const s of cards) if (s.visible) write(s, t);
  raf = cards.size ? requestAnimationFrame(tick) : 0;
}

let seq = 0;

/** Register a card. Returns { setPointer, release, unregister }. */
export function registerHoloCard(wrap, card) {
  const s = { wrap, card, ph: (seq++ % 24) * 1.7, x: .5, y: .5, a: 0, tx: .5, ty: .5, ta: 0, visible: true, active: false };
  if (prefersReducedMotion()) {
    // Static pose: no drift, no tilt.
    write(s, 0);
    return { setPointer() {}, release() {}, unregister() {} };
  }
  wrap.__holo = s;
  const obs = observer();
  if (obs) { s.visible = false; obs.observe(wrap); }
  cards.add(s);
  if (!raf) raf = requestAnimationFrame(tick);
  return {
    setPointer(nx, ny) {
      if (isGyroActive()) return;
      s.tx = Math.min(1, Math.max(0, nx)); s.ty = Math.min(1, Math.max(0, ny)); s.ta = 1;
    },
    release() { if (!isGyroActive()) { s.tx = .5; s.ty = .5; s.ta = 0; } },
    unregister() {
      cards.delete(s);
      if (obs) obs.unobserve(wrap);
      delete wrap.__holo;
      if (!cards.size && raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}
