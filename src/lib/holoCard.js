// Maps a real wardrobe item onto the grading-label fields of a holo slab card.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** ACQ. column: { day: 'MAR 02', year: '2026' } from the item's created_at. */
export function acquired(item) {
  const d = item?.created_at ? new Date(item.created_at) : null;
  if (!d || Number.isNaN(d.getTime())) return { day: '—', year: '' };
  return { day: `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`, year: String(d.getFullYear()) };
}

/** Stable 8-digit serial derived from the item id (numeric or uuid). */
export function serialFor(id) {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return String(10000000 + ((h >>> 0) % 90000000));
}

/** 'TYPE · CONDITION' meta line. */
export function metaLine(item) {
  return [item?.type, item?.condition].filter(Boolean).join(' · ').toUpperCase();
}

export const catNo = idx => String((idx ?? 0) + 1).padStart(3, '0');
