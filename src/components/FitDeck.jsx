import { useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { parseImageUrls } from '../lib/imageUtils';
import { acquired, metaLine, catNo } from '../lib/holoCard';
import { prefersReducedMotion } from '../lib/holoTicker';
import './holo.css';

// Card-deal OOTD builder. Item cards are drawn from a face-down deck into the
// outfit slots; on completion the photos form the fit and the drawn cards fan
// out beside it, where any card can be swapped for the next matching one.
// All card motion is imperative WAAPI on DOM nodes (DealController below);
// React only renders the static markup and the action-bar state.

// Design fill order → index in the app's persisted 10-slot array
// (TOP0 BOTTOM1 OUTER2 SHOE3 HAT4 BAG5 ACC6-9 — unchanged for saved fits).
const DEAL_SLOTS = [
  { key: 'HAT',    idx: 4, group: 'HAT' },
  { key: 'TOP',    idx: 0, group: 'TOP' },
  { key: 'BOTTOM', idx: 1, group: 'BOTTOM' },
  { key: 'SHOE',   idx: 3, group: 'SHOE' },
  { key: 'BAG',    idx: 5, group: 'BAG' },
  { key: 'ACC1',   idx: 6, group: 'ACC' },
  { key: 'ACC2',   idx: 7, group: 'ACC' },
  { key: 'ACC3',   idx: 8, group: 'ACC' },
  { key: 'ACC4',   idx: 9, group: 'ACC' },
];
const SLOT_BY_KEY = Object.fromEntries(DEAL_SLOTS.map(s => [s.key, s]));

const GROUP_ACCEPTS = {
  HAT:    ['Headwear'],
  TOP:    ['Shirt', 'T-Shirt', 'Sweatshirt', 'Jacket', 'Coat'],
  BOTTOM: ['Jeans', 'Trousers', 'Shorts'],
  SHOE:   ['Footwear'],
  BAG:    ['Bag'],
  ACC:    ['Accessories'],
};
// Cards per category in one deck (keeps the 3D DOM light for big wardrobes;
// the deck is re-sampled from the whole wardrobe on every reshuffle).
const GROUP_CAP = { HAT: 3, TOP: 6, BOTTOM: 5, SHOE: 4, BAG: 3, ACC: 7 };
const groupOf = type => Object.keys(GROUP_ACCEPTS).find(g => GROUP_ACCEPTS[g].includes(type));

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Pick the deck: every forced item (a loaded fit) plus a random sample per category. */
function samplePool(items, forced = []) {
  const current = new Map(items.map(it => [String(it.id), it]));
  const out = new Map();
  const counts = {};
  for (const f of forced) {
    const it = current.get(String(f.id)) || f;
    const g = groupOf(it.type);
    if (!g || out.has(String(it.id))) continue;
    out.set(String(it.id), it);
    counts[g] = (counts[g] || 0) + 1;
  }
  for (const it of shuffle(items)) {
    const g = groupOf(it.type);
    if (!g || out.has(String(it.id))) continue;
    const forcedInGroup = forced.filter(f => groupOf(f.type) === g).length;
    const cap = Math.max(GROUP_CAP[g], forcedInGroup + 1);
    if ((counts[g] || 0) >= cap) continue;
    out.set(String(it.id), it);
    counts[g] = (counts[g] || 0) + 1;
  }
  return [...out.values()];
}

const W = 160, H = 224;
const RING = [
  [-3.75, 'rgba(160,176,190,.7)'], [-2.5, 'rgba(175,190,203,.7)'], [-1.25, 'rgba(190,204,215,.7)'], [0, 'rgba(200,213,223,.7)'],
  [1.25, 'rgba(190,204,215,.7)'], [2.5, 'rgba(175,190,203,.7)'], [3.75, 'rgba(160,176,190,.7)'],
];
const EASE_DRAW = 'cubic-bezier(.35,.6,.2,1)';
const EASE_GLIDE = 'cubic-bezier(.65,0,.25,1)';
const EASE_LIFT = 'cubic-bezier(.2,.8,.2,1)';

class DealController {
  constructor() {
    this.cards = {};        // id → { loc: 'deck'|'slot'|'fan', slot, fan, tilt }
    this.deckOrder = [];
    this.pose = {};
    this.phase = 'idle';    // 'idle' | 'build' | 'done'
    this.filled = 0;        // next slot index the draw searches from
    this.busy = false;
    this.poolMap = new Map();
    this.timers = new Set();
    this.gen = 0;           // bumped on hard clear/unmount; stale async continuations bail
    this.extra2 = null;     // legacy OUTER slot value, passed through untouched
    this.stage = null;
    this.emitUi = () => {};
    this.emitSlots = () => {};
    this.requestPool = () => {};
  }

  // ── helpers ──
  S() { return prefersReducedMotion() ? 0.001 : 1; }
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms * this.S());
    this.timers.add(t);
  }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }
  q(sel) { return this.stage?.querySelector(sel) || null; }
  cardEl(id) { return this.q(`[data-card="${CSS.escape(id)}"]`); }
  colEl(id) { return this.q(`[data-collage="${CSS.escape(id)}"]`); }
  slotEl(key) { return this.q(`[data-slot="${key}"]`); }
  ids() { return Object.keys(this.cards); }
  rel(el) {
    const s = this.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width, h: r.height, l: r.left - s.left, t: r.top - s.top };
  }
  k() { const t = this.q('.deal-table'); return t ? Math.min(1, t.clientWidth / 520) : 1; }
  deckIds() { return this.deckOrder.filter(id => this.cards[id]?.loc === 'deck'); }
  fanIds() { return this.ids().filter(id => this.cards[id].loc === 'fan').sort((a, b) => this.cards[a].fan - this.cards[b].fan); }
  usedIds() { return this.ids().filter(id => this.cards[id].loc !== 'deck' && this.cards[id].slot); }
  accepts(group, id) { return GROUP_ACCEPTS[group].includes(this.poolMap.get(id)?.type); }

  setBusy(b) {
    this.busy = b;
    if (!b && this.needLayout) { this.needLayout = false; this.layout(); }
    this.emit();
  }
  emit() {
    this.emitUi({
      phase: this.phase,
      busy: this.busy,
      count: this.usedIds().length,
      deckCount: this.deckIds().length,
      canDraw: this.phase !== 'done' && !!this.nextDraw(),
    });
  }
  slots10() {
    const s = Array(10).fill(null);
    s[2] = this.extra2;
    for (const id of this.usedIds()) s[SLOT_BY_KEY[this.cards[id].slot].idx] = this.poolMap.get(id);
    return s;
  }
  emitFit() { this.emitSlots(this.slots10()); }

  // ── poses ──
  poseFor(id) {
    const c = this.cards[id];
    const k = this._k || 1;
    if (c.loc === 'deck') {
      const done = this.phase === 'done';
      const a = this.rel(this.q(done ? '.deal-anchor.deck-done' : '.deal-anchor.deck'));
      const ids = this.deckIds(), n = ids.length, i = ids.indexOf(id);
      return { x: a.x + i * .15, y: a.y - (n - 1 - i) * 1.6, r: c.tilt, s: (done ? .5 : .95) * k, f: 180, tx: 10, ty: 0, z: 100 + n - i };
    }
    if (c.loc === 'slot') {
      const a = this.rel(this.slotEl(c.slot));
      return { x: a.x, y: a.y, r: 0, s: Math.min(a.w / W, a.h / H) * .94, f: 0, tx: 8, ty: 0, z: 300 + DEAL_SLOTS.findIndex(s => s.key === c.slot) };
    }
    const a = this.rel(this.q('.deal-anchor.fan'));
    const ids = this.fanIds(), n = ids.length, i = ids.indexOf(id);
    const spread = Math.min(64, n * 9);
    const ang = n > 1 ? -spread / 2 + i * spread / (n - 1) : 0;
    const R = 300 * k, rad = ang * Math.PI / 180;
    return { x: a.x + Math.sin(rad) * R, y: a.y + R - 40 * k - Math.cos(rad) * R, r: ang, s: .86 * k, f: 0, tx: 14, ty: -ang * .35, z: 400 + i };
  }
  clickable(id) { const l = this.cards[id].loc; return l === 'fan' || (l === 'deck' && this.phase !== 'done'); }
  F(p) { return `rotateX(${(p.tx || 0).toFixed(2)}deg) rotateY(${(p.f + (p.ty || 0)).toFixed(2)}deg)`; }
  T(p) { return `translate(${(p.x - W / 2).toFixed(1)}px, ${(p.y - H / 2).toFixed(1)}px) rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(3)})`; }

  place(id, p) {
    const el = this.cardEl(id); if (!el) return;
    el.getAnimations().forEach(a => a.cancel());
    const flip = el.querySelector('.deal-flip');
    flip.getAnimations().forEach(a => a.cancel());
    el.style.transform = this.T(p); el.style.zIndex = p.z;
    flip.style.transform = this.F(p);
    el.style.pointerEvents = this.clickable(id) ? 'auto' : 'none';
    this.pose[id] = p;
  }
  layout() {
    if (!this.stage) return;
    if (this.busy) { this.needLayout = true; return; }
    this._k = this.k();
    this.ids().forEach(id => this.place(id, this.poseFor(id)));
    if (this.phase === 'done') this.placeCollage(false);
  }

  fly(id, B, { dur = 760, delay = 0, arc = 70, smooth = false, z = 900 } = {}) {
    const el = this.cardEl(id);
    if (!el) { this.pose[id] = B; return Promise.resolve(); }
    const A = this.pose[id] || B;
    const S = this.S();
    dur = Math.max(1, dur * S); delay *= S;
    el.getAnimations().forEach(a => { try { a.commitStyles(); } catch { /* detached */ } a.cancel(); });
    el.style.zIndex = z;
    el.style.pointerEvents = 'none';
    const opts = { duration: dur, delay, easing: smooth ? EASE_GLIDE : EASE_DRAW, fill: 'both' };
    let frames;
    if (smooth) {
      const mid = { x: A.x + (B.x - A.x) * .5, y: A.y + (B.y - A.y) * .5 - arc, s: (A.s + B.s) / 2, r: (A.r + B.r) / 2 };
      frames = [{ transform: this.T(A) }, { transform: this.T(mid), offset: .5 }, { transform: this.T(B) }];
    } else {
      const dist = Math.hypot(B.x - A.x, B.y - A.y);
      const lift = { ...A, y: A.y - 26, s: A.s * 1.05, r: A.r - 4 };
      const mid = { x: (A.x + B.x) / 2, y: Math.min(A.y, B.y) - arc - dist * .08, s: Math.max(A.s, B.s) * 1.12, r: (A.r + B.r) / 2 + (B.x < A.x ? -9 : 9) };
      frames = [{ transform: this.T(A) }, { transform: this.T(lift), offset: .16 }, { transform: this.T(mid), offset: .55 }, { transform: this.T(B) }];
    }
    const an = el.animate(frames, opts);
    const flip = el.querySelector('.deal-flip');
    flip.getAnimations().forEach(a => { try { a.commitStyles(); } catch { /* detached */ } a.cancel(); });
    let fa = null;
    if (this.F(A) !== this.F(B)) {
      const M = { ...B, tx: (A.tx || 0) * .5 + 6, ty: (A.ty || 0) * .5 };
      fa = flip.animate(A.f !== B.f ? [
        { transform: this.F(A) }, { transform: this.F({ ...A, tx: 18 }), offset: .2 }, { transform: this.F({ ...B, tx: 18 }), offset: .72 }, { transform: this.F(B) },
      ] : [{ transform: this.F(A) }, { transform: this.F(M), offset: .5 }, { transform: this.F(B) }], opts);
    }
    this.pose[id] = B;
    return an.finished.then(() => {
      el.style.transform = this.T(B); el.style.zIndex = B.z; an.cancel();
      flip.style.transform = this.F(B); if (fa) fa.cancel();
      el.style.pointerEvents = this.clickable(id) ? 'auto' : 'none';
    }).catch(() => {});
  }
  land(id) {
    const el = this.cardEl(id); if (!el || prefersReducedMotion()) return;
    el.querySelector('.deal-lift').animate([{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 260, easing: EASE_LIFT });
    el.querySelector('[data-glare]').animate([{ backgroundPosition: '150% 50%' }, { backgroundPosition: '-50% 50%' }], { duration: 750, easing: 'ease-out' });
  }

  // ── pool sync (after React renders a new deck) ──
  syncPool(pool) {
    this.poolMap = new Map(pool.map(it => [String(it.id), it]));
    for (const id of this.ids()) if (!this.poolMap.has(id)) { delete this.cards[id]; delete this.pose[id]; }
    const fresh = [];
    for (const id of this.poolMap.keys()) {
      if (!this.cards[id]) { this.cards[id] = { loc: 'deck', slot: null, fan: -1, tilt: (Math.random() - .5) * 3 }; fresh.push(id); }
    }
    this.deckOrder = [...this.deckOrder.filter(id => this.poolMap.has(id)), ...shuffle(fresh)];
    let used = null;
    if (this.pendingLoad) used = this.applyLoad(this.pendingLoad);
    this.layout();
    if (used) this.placeCollage(true, used);
    this.emit();
    if (used) this.emitFit();
    const then = this.afterSync; this.afterSync = null;
    if (then) then();
  }
  applyLoad(slots) {
    this.pendingLoad = null;
    this.extra2 = slots[2] ?? null;
    const used = [];
    for (const s of DEAL_SLOTS) {
      const it = slots[s.idx]; if (!it) continue;
      const id = String(it.id), c = this.cards[id];
      if (!c || c.loc !== 'deck') continue;
      c.loc = 'fan'; c.slot = s.key; c.fan = used.length; used.push(id);
    }
    this.deckOrder = [...this.deckOrder.filter(id => !used.includes(id)), ...used];
    this.phase = used.length ? 'done' : 'idle';
    this.filled = used.length ? DEAL_SLOTS.length : 0;
    return used.length ? used : null;
  }

  /** Hard reset of all transient DOM state (used before loading a saved fit). */
  hardClear() {
    this.gen++;
    this.clearTimers();
    for (const id of this.ids()) {
      const el = this.cardEl(id);
      el?.getAnimations({ subtree: true }).forEach(a => a.cancel());
      const col = this.colEl(id);
      if (col) { col.getAnimations().forEach(a => a.cancel()); col.style.opacity = 0; }
      Object.assign(this.cards[id], { loc: 'deck', slot: null, fan: -1 });
    }
    DEAL_SLOTS.forEach(s => this.slotEl(s.key)?.classList.remove('is-filled'));
    this.phase = 'idle'; this.filled = 0; this.extra2 = null; this.busy = false;
  }
  loadFit(slots, items) {
    this.hardClear();
    this.pendingLoad = slots;
    const forced = DEAL_SLOTS.map(s => slots[s.idx]).filter(Boolean);
    this.requestPool(samplePool(items, forced));
  }

  // ── drawing ──
  nextDraw() {
    for (let k = this.filled; k < DEAL_SLOTS.length; k++) {
      const s = DEAL_SLOTS[k];
      const id = this.deckIds().find(i => this.accepts(s.group, i));
      if (id) return { k, key: s.key, id };
    }
    return null;
  }
  draw() {
    const d = this.nextDraw();
    if (!d) return Promise.resolve(false);
    this.deckOrder = [d.id, ...this.deckOrder.filter(i => i !== d.id)];
    this.deckIds().forEach(i => this.place(i, this.poseFor(i)));
    this.cards[d.id].loc = 'slot'; this.cards[d.id].slot = d.key;
    this.filled = d.k + 1;
    const B = this.poseFor(d.id);
    this.deckIds().forEach(i => this.place(i, this.poseFor(i)));
    this.emit(); this.emitFit();
    const g = this.gen;
    return this.fly(d.id, B).then(() => { if (g !== this.gen) return false; this.land(d.id); this.slotEl(d.key)?.classList.add('is-filled'); return true; });
  }
  drawOne = () => {
    if (this.busy || this.phase === 'done' || !this.nextDraw()) return;
    this.phase = 'build';
    this.setBusy(true);
    const g = this.gen;
    this.draw().then(() => {
      if (g !== this.gen) return;
      if (!this.nextDraw()) this.later(() => this.complete(), 500);
      else this.setBusy(false);
    });
  };
  dealAll = () => {
    if (this.busy || this.phase === 'done' || !this.nextDraw()) return;
    this.phase = 'build';
    this.setBusy(true);
    const step = () => {
      if (!this.nextDraw()) { this.later(() => this.complete(), 650); return; }
      this.draw();
      this.later(step, 270);
    };
    step();
  };

  complete() {
    if (this.phase === 'done') return;
    const used = DEAL_SLOTS.map(s => this.ids().find(id => this.cards[id].slot === s.key && this.cards[id].loc === 'slot')).filter(Boolean);
    if (!used.length) { this.phase = 'idle'; this.setBusy(false); return; }
    this.phase = 'done';
    this.busy = true;
    this.emit();
    this.placeCollage(true, used);
    used.forEach((id, i) => { this.cards[id].loc = 'fan'; this.cards[id].fan = i; });
    const deckJobs = this.deckIds().map(id => { const p = this.poseFor(id); return this.fly(id, p, { dur: 520, smooth: true, arc: 0, z: 150 + p.z }); });
    const fanJobs = used.map((id, i) => this.fly(id, this.poseFor(id), { dur: 820, delay: 260 + i * 90, smooth: true, arc: 24, z: 600 + i }));
    const g = this.gen;
    Promise.all([...deckJobs, ...fanJobs]).then(() => { if (g === this.gen) this.setBusy(false); });
  }
  placeCollage(animate, used) {
    used = used || this.usedIds();
    const S = this.S();
    used.forEach((id, i) => {
      const el = this.colEl(id), slot = this.slotEl(this.cards[id].slot);
      if (!el || !slot) return;
      const a = this.rel(slot);
      Object.assign(el.style, { left: a.l + 'px', top: a.t + 'px', width: a.w + 'px', height: a.h + 'px' });
      if (animate && S > .01) {
        el.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 520, delay: 360 + i * 90, easing: EASE_LIFT, fill: 'backwards' });
      }
      el.style.opacity = 1;
    });
  }

  /** Fly everything back to the deck, reshuffle, re-sample, then optionally run `then`. */
  reset(then) {
    if (this.busy) return;
    this.clearTimers();
    const wasDone = this.phase === 'done';
    for (const id of this.ids()) {
      const el = this.colEl(id); if (!el) continue;
      if (el.style.opacity === '1' && this.S() > .01) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
      el.style.opacity = 0;
    }
    DEAL_SLOTS.forEach(s => this.slotEl(s.key)?.classList.remove('is-filled'));
    const out = this.ids().filter(id => this.cards[id].loc !== 'deck');
    this.phase = 'idle'; this.filled = 0; this.extra2 = null;
    this.busy = true;
    out.forEach(id => Object.assign(this.cards[id], { loc: 'deck', slot: null, fan: -1 }));
    this.deckOrder = shuffle(this.ids());
    this.emit(); this.emitFit();
    const jobs = this.deckOrder.map(id => {
      const moving = out.includes(id) || wasDone;
      if (!moving) { this.place(id, this.poseFor(id)); return Promise.resolve(); }
      return this.fly(id, this.poseFor(id), { dur: 650, delay: (out.length - out.indexOf(id)) * 40, arc: 30 });
    });
    const g = this.gen;
    Promise.all(jobs).then(() => {
      if (g !== this.gen) return;
      this.busy = false;
      this.afterSync = typeof then === 'function' ? then : null;
      this.requestPool(null);   // re-sample a fresh deck from the whole wardrobe
    });
  }
  redeal = () => this.reset(() => this.dealAll());

  // ── swap ──
  swap(id) {
    const c = this.cards[id];
    if (!c || c.loc !== 'fan' || this.busy) return;
    const el = this.cardEl(id), lift = el.querySelector('.deal-lift');
    const key = c.slot, group = SLOT_BY_KEY[key].group;
    const nid = this.deckIds().find(i => this.accepts(group, i));
    if (!nid) {
      lift.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
      return;
    }
    this.setBusy(true);
    const S = this.S();
    lift.style.transform = '';
    const tag = el.querySelector('.deal-swaptag'); tag.style.opacity = 0; tag.style.pointerEvents = 'none';
    const fl0 = el.querySelector('.deal-flip'); fl0.style.transition = ''; fl0.style.transform = this.F(this.pose[id]);
    const oldCol = this.colEl(id);
    if (oldCol) {
      if (S > .01) oldCol.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.94)' }], { duration: 550, easing: 'ease-in' });
      oldCol.style.opacity = 0;
    }

    this.deckOrder = [nid, ...this.deckOrder.filter(i => i !== nid && i !== id), id];
    const fanIdx = c.fan;
    Object.assign(c, { loc: 'deck', slot: null, fan: -1 });
    const nc = this.cards[nid];
    Object.assign(nc, { loc: 'fan', slot: key, fan: fanIdx });
    this.deckIds().forEach(i => { if (i !== id) this.place(i, this.poseFor(i)); });
    nc.loc = 'deck'; this.place(nid, this.poseFor(nid)); nc.loc = 'fan';
    this.emit(); this.emitFit();

    const back = this.fly(id, this.poseFor(id), { dur: 1100, smooth: true, arc: 60, z: 120 });
    const fwd = this.fly(nid, this.poseFor(nid), { dur: 1350, delay: 750, arc: 70, z: 700 });
    this.later(() => {
      const col = this.colEl(nid), slot = this.slotEl(key);
      if (!col || !slot) return;
      const a = this.rel(slot);
      Object.assign(col.style, { left: a.l + 'px', top: a.t + 'px', width: a.w + 'px', height: a.h + 'px', opacity: 1 });
      if (S > .01) col.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 800, easing: EASE_LIFT });
    }, 1600);
    const g = this.gen;
    Promise.all([back, fwd]).then(() => {
      if (g !== this.gen) return;
      this.deckIds().forEach(i => this.place(i, this.poseFor(i)));
      this.land(nid);
      this.setBusy(false);
    });
  }

  // ── pointer ──
  onEnter(id, el) {
    if (this.cards[id]?.loc !== 'fan') return;
    if (!prefersReducedMotion()) el.querySelector('.deal-lift').style.transform = 'translateY(-34px) scale(1.08)';
    el.style.zIndex = 800;
    if (!this.busy) {
      const t = el.querySelector('.deal-swaptag'); t.style.opacity = 1; t.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
    }
  }
  onMove(id, el, e) {
    const c = this.cards[id];
    if (!c) return;
    if (c.loc === 'deck') { el.style.cursor = this.busy || this.phase === 'done' ? '' : 'pointer'; return; }
    if (c.loc !== 'fan') return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - .5, ny = (e.clientY - r.top) / r.height - .5;
    const P = this.pose[id], flip = el.querySelector('.deal-flip');
    if (P && !this.busy && !prefersReducedMotion()) {
      flip.style.transition = 'transform .14s ease-out';
      flip.style.transform = this.F({ ...P, tx: -ny * 34, ty: nx * 38 });
    }
    el.style.setProperty('--px', `${(nx + .5) * 100}%`);
    el.style.setProperty('--py', `${(ny + .5) * 100}%`);
  }
  onLeave(id, el) {
    el.querySelector('.deal-lift').style.transform = '';
    const fl = el.querySelector('.deal-flip');
    if (this.cards[id]?.loc === 'fan' && this.pose[id] && !this.busy) {
      fl.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)';
      fl.style.transform = this.F(this.pose[id]);
    }
    clearTimeout(fl._t); fl._t = setTimeout(() => { fl.style.transition = ''; }, 500);
    const t = el.querySelector('.deal-swaptag'); t.style.opacity = 0; t.style.pointerEvents = 'none';
    el.style.cursor = '';
    el.style.removeProperty('--px'); el.style.removeProperty('--py');
    if (this.pose[id]) el.style.zIndex = this.pose[id].z;
  }
  onClick(id) {
    const c = this.cards[id]; if (!c) return;
    if (c.loc === 'deck') this.drawOne(); else if (c.loc === 'fan') this.swap(id);
  }

  destroy() {
    this.gen++;
    this.clearTimers();
    this.stage?.getAnimations?.({ subtree: true }).forEach(a => a.cancel());
  }
}

function DealCard({ item, cat, slotTag, ctlRef }) {
  const id = String(item.id);
  const img = parseImageUrls(item.image_url)[0];
  const acq = acquired(item);
  return (
    <div
      className="deal-card"
      data-card={id}
      onPointerEnter={e => ctlRef.current?.onEnter(id, e.currentTarget)}
      onPointerMove={e => ctlRef.current?.onMove(id, e.currentTarget, e)}
      onPointerLeave={e => ctlRef.current?.onLeave(id, e.currentTarget)}
      onClick={() => ctlRef.current?.onClick(id)}
    >
      <div className="deal-lift">
        <div className="deal-swaptag"><span>↻ SWAP</span></div>
        <div className="deal-flip">
          <div className="deal-plate" />
          {RING.map(([z, c]) => <div key={z} className="deal-dring" style={{ transform: `translateZ(${z}px)`, borderColor: c }} />)}
          <div className="deal-glass front" />
          <div className="deal-glass-glare" />
          <div className="deal-glass back" />

          <div className="deal-front">
            <div className="deal-label">
              <div className="deal-label-main">
                <div className="deal-mark"><span>GARDER0BE</span><span>№ {cat}</span></div>
                <div className="deal-brand">{item.brand || '—'}</div>
                <div className="deal-iname">{item.name || 'Untitled'}</div>
                <div className="deal-code"><div className="deal-barcode" /><div className="deal-sticker" /></div>
              </div>
              <div className="deal-acq">
                <div className="deal-acq-k">ACQ.</div>
                <div className="deal-acq-d">{acq.day}</div>
                {acq.year && <div className="deal-acq-y">{acq.year}</div>}
              </div>
            </div>
            <div className="deal-well">
              <div className="deal-item">
                <div className="deal-photo">
                  <div className="deal-photo-inset">
                    {img ? <img src={img} alt={item.name || ''} draggable="false" /> : <span className="deal-photo-none">NO IMAGE</span>}
                  </div>
                  <div className="deal-slottag">{slotTag}</div>
                </div>
                <div className="deal-meta"><span>{metaLine(item) || '—'}</span><span>{item.size || ''}</span></div>
                <div className="deal-pearl" />
                <div className="deal-sheen" data-glare="1" />
              </div>
            </div>
          </div>

          <div className="deal-backface">
            <div className="deal-backface-panel" />
            <div className="deal-pearl" />
            <div className="deal-sheen" />
            <div className="deal-backface-hair" />
          </div>
        </div>
      </div>
    </div>
  );
}

const FitDeck = forwardRef(function FitDeck(
  { items, fitName, onFitNameChange, onSlotsChange, onNewFit, onSave, onShare, saveLabel },
  ref,
) {
  const stageRef = useRef(null);
  const ctlRef = useRef(null);
  const itemsRef = useRef(items);
  const onSlotsRef = useRef(onSlotsChange);
  useLayoutEffect(() => { itemsRef.current = items; onSlotsRef.current = onSlotsChange; });

  const [pool, setPool] = useState(() => samplePool(items));
  const [ui, setUi] = useState({ phase: 'idle', busy: false, count: 0, deckCount: 0, canDraw: false });

  const catById = useMemo(() => new Map(items.map((it, i) => [String(it.id), catNo(i)])), [items]);

  useLayoutEffect(() => {
    const ctl = new DealController();
    ctlRef.current = ctl;
    ctl.stage = stageRef.current;
    ctl.emitUi = setUi;
    ctl.emitSlots = s => onSlotsRef.current?.(s);
    ctl.requestPool = p => setPool(p || samplePool(itemsRef.current));
    let rt = 0;
    const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => ctl.layout(), 80); });
    ro.observe(stageRef.current);
    if (document.fonts?.ready) document.fonts.ready.then(() => ctl.layout());
    return () => { ro.disconnect(); clearTimeout(rt); ctl.destroy(); ctlRef.current = null; };
  }, []);

  useLayoutEffect(() => { ctlRef.current?.syncPool(pool); }, [pool]);

  // New/removed wardrobe items: re-sample while the table is untouched.
  const firstItems = useRef(true);
  useEffect(() => {
    if (firstItems.current) { firstItems.current = false; return; }
    const ctl = ctlRef.current;
    if (ctl && ctl.phase === 'idle' && !ctl.busy && !ctl.usedIds().length) setPool(samplePool(items));
  }, [items]);

  useImperativeHandle(ref, () => ({
    loadFit: slots => ctlRef.current?.loadFit(slots, itemsRef.current),
    newFit: () => ctlRef.current?.reset(),
  }), []);

  const done = ui.phase === 'done';
  const empty = pool.length === 0;

  return (
    <div ref={stageRef} className={`deal-stage${done ? ' deal-done' : ''}`}>
      <div className="deal-left">
        <div className="deal-name-row">
          <span className="deal-name-k">FIT /</span>
          <input
            className="deal-name"
            aria-label="Fit name"
            value={fitName}
            onChange={e => onFitNameChange(e.target.value.toUpperCase())}
          />
          <span className="deal-count">{ui.count}/{DEAL_SLOTS.length}</span>
        </div>

        <div className="deal-board">
          <div className="deal-acc-col">
            <div className="deal-acc-k">ACC</div>
            {['ACC1', 'ACC2', 'ACC3', 'ACC4'].map(k => <div key={k} data-slot={k} className="deal-slot acc">+ ACC</div>)}
          </div>
          <div className="deal-center-col">
            <div data-slot="HAT" className="deal-slot hat">+ HAT</div>
            <div data-slot="TOP" className="deal-slot top">+ TOP</div>
            <div data-slot="BOTTOM" className="deal-slot bottom">+ BOTTOM</div>
            <div data-slot="SHOE" className="deal-slot shoe">+ SHOE</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div data-slot="BAG" className="deal-slot bag">+ BAG</div>
          </div>
        </div>

        {!done ? (
          <div className="deal-actions">
            <button className="deal-act" disabled={ui.busy || empty} onClick={() => ctlRef.current?.reset()}>RESHUFFLE</button>
            <button className="deal-act" disabled={ui.busy || !ui.canDraw} onClick={() => ctlRef.current?.drawOne()}>DRAW 1</button>
            <button className="deal-act primary" disabled={ui.busy || !ui.canDraw} onClick={() => ctlRef.current?.dealAll()}>DEAL THE FIT →</button>
          </div>
        ) : (
          <div className="deal-actions">
            <button className="deal-act" disabled={ui.busy} onClick={() => { const c = ctlRef.current; if (c && !c.busy) { onNewFit?.(); c.reset(); } }}>← NEW FIT</button>
            <button className="deal-act" disabled={ui.busy} onClick={() => ctlRef.current?.redeal()}>REDEAL</button>
            <button className="deal-act primary" disabled={ui.busy || ui.count === 0} onClick={onSave}>{saveLabel}</button>
            <button className="deal-act" disabled={ui.busy || ui.count === 0} onClick={onShare}>↑ SHARE</button>
          </div>
        )}
      </div>

      <div className="deal-right">
        <div className="deal-table">
          <div className="deal-anchor deck" />
          <div className="deal-anchor fan" />
          <div className="deal-anchor deck-done" />
          {empty && (
            <div className="deal-empty">Add tops, bottoms, shoes or accessories to your wardrobe to build a deck.</div>
          )}
        </div>
      </div>

      <div className="deal-layer">
        {pool.map(it => {
          const img = parseImageUrls(it.image_url)[0];
          return (
            <div key={`c-${it.id}`} className="deal-collage" data-collage={String(it.id)}>
              {img && <img src={img} alt={it.name || ''} draggable="false" />}
            </div>
          );
        })}
        {pool.map(it => (
          <DealCard
            key={it.id}
            item={it}
            cat={catById.get(String(it.id)) || '000'}
            slotTag={groupOf(it.type)}
            ctlRef={ctlRef}
          />
        ))}
      </div>
    </div>
  );
});

export default FitDeck;
