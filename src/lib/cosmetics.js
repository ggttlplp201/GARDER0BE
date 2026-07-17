// Cosmetics registry — single source of truth for the VISUAL of each cosmetic.
// The `cosmetic_defs` seed in supabase_cosmetics_migration.sql must list the same
// ids / type / price / min_level (guarded by tests/cosmetics.test.js).
//
// Frames render as an inline <svg> overlay (viewBox 0 0 100 100) that Avatar.jsx
// positions slightly larger than the avatar (see .cos-frame CSS). Style is stark /
// editorial geometric, not painterly. Name effects are CSS gradient-text classes.

const svg = (s, inner) =>
  `<svg class="cos-frame-svg" viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true">${inner}</svg>`;

// Evenly spaced radial ticks (used by Ice Crystal facets).
function ticks(count, rIn, rOut, stroke, width) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = (i * 360 / count) * Math.PI / 180;
    const x1 = 50 + rIn * Math.cos(a), y1 = 50 + rIn * Math.sin(a);
    const x2 = 50 + rOut * Math.cos(a), y2 = 50 + rOut * Math.sin(a);
    out += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${width}"/>`;
  }
  return out;
}

// A single laurel branch: small leaves along an arc. dir = -1 (left) or +1 (right).
function laurel(dir) {
  let out = '';
  for (let i = 0; i < 6; i++) {
    // arc sweeps up the side from bottom (~110°) toward the top
    const a = ((90 + dir * (20 + i * 12))) * Math.PI / 180;
    const cx = 50 + 47 * Math.cos(a), cy = 50 + 47 * Math.sin(a);
    const lx = cx - dir * 6 * Math.sin(a), ly = cy + 6 * Math.cos(a);
    out += `<path d="M${cx.toFixed(1)} ${cy.toFixed(1)} Q${((cx + lx) / 2 + dir * 2).toFixed(1)} ${((cy + ly) / 2).toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)}" fill="none" stroke="#c9a227" stroke-width="2" stroke-linecap="round"/>`;
  }
  return out;
}

// A stylized wing on one side. dir = -1 (left) / +1 (right).
function wing(dir) {
  const m = (x, y) => `${(50 + dir * x).toFixed(1)} ${y.toFixed(1)}`;
  return `<path d="M${m(38, 52)} C ${m(58, 40)} ${m(78, 46)} ${m(86, 60)} C ${m(74, 54)} ${m(62, 56)} ${m(52, 62)} C ${m(66, 58)} ${m(76, 62)} ${m(80, 72)} C ${m(66, 66)} ${m(54, 66)} ${m(44, 70)} Z" fill="none" stroke="#e6e6e6" stroke-width="1.4" stroke-linejoin="round"/>`;
}

const FRAME_DEFS = {
  thin_line: { name: 'Thin Line', price: 0, minLevel: 0,
    render: s => svg(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1.5"/>`) },
  dashed_ring: { name: 'Dashed Ring', price: 150, minLevel: 0,
    render: s => svg(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>`) },
  ice_crystal: { name: 'Ice Crystal', price: 450, minLevel: 5,
    render: s => svg(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="#7db8d8" stroke-width="2"/>` + ticks(12, 45, 50, '#a9d6ec', 1.6)) },
  crimson_flame: { name: 'Crimson Flame', price: 650, minLevel: 5,
    render: s => svg(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="#c0392b" stroke-width="2.5" class="cos-anim-flicker"/>`) },
  gold_laurel: { name: 'Gold Laurel', price: 800, minLevel: 10,
    render: s => svg(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#c9a227" stroke-width="1.5"/>${laurel(-1)}${laurel(1)}`) },
  onyx_halo: { name: 'Onyx Halo', price: 950, minLevel: 10,
    render: s => svg(s, `<circle cx="50" cy="50" r="49" fill="none" stroke="#222" stroke-width="3"/><circle cx="50" cy="50" r="44" fill="none" stroke="#666" stroke-width="1" stroke-dasharray="2 6" class="cos-anim-spin"/>`) },
  royal_crown: { name: 'Royal Crown', price: 1300, minLevel: 15,
    render: s => svg(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#c9a227" stroke-width="2"/><path d="M40 12 L44 19 L50 9 L56 19 L60 12 L58 24 L42 24 Z" fill="#c9a227"/>`) },
  angel_wings: { name: 'Angel Wings', price: 1500, minLevel: 20,
    render: s => svg(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#dddddd" stroke-width="1.5"/>${wing(-1)}${wing(1)}`) },
};

const NAME_EFFECT_DEFS = {
  silver_shine: { name: 'Silver Shine', price: 300, minLevel: 0, cls: 'cos-fx-silver' },
  gold_shine: { name: 'Gold Shine', price: 500, minLevel: 8, cls: 'cos-fx-gold' },
  rainbow_shine: { name: 'Rainbow Shine', price: 900, minLevel: 12, cls: 'cos-fx-rainbow' },
};

export const COSMETICS = {};
for (const [id, d] of Object.entries(FRAME_DEFS))
  COSMETICS[id] = { id, type: 'frame', name: d.name, price: d.price, minLevel: d.minLevel, renderFrame: d.render };
for (const [id, d] of Object.entries(NAME_EFFECT_DEFS))
  COSMETICS[id] = { id, type: 'name_effect', name: d.name, price: d.price, minLevel: d.minLevel, nameEffectClass: d.cls };

export const FRAMES = Object.keys(FRAME_DEFS).map(id => COSMETICS[id]);
export const NAME_EFFECTS = Object.keys(NAME_EFFECT_DEFS).map(id => COSMETICS[id]);
export const CATALOG_IDS = new Set(Object.keys(COSMETICS));
export const DEFAULT_FRAME = 'thin_line';

export function frameOf(id) {
  const c = COSMETICS[id || DEFAULT_FRAME];
  return c && c.type === 'frame' ? c : COSMETICS[DEFAULT_FRAME];
}
export function nameEffectOf(id) {
  const c = id && COSMETICS[id];
  return c && c.type === 'name_effect' ? c : null;
}
