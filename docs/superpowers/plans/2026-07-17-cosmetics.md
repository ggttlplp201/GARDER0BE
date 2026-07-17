# Cosmetics Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Spend coins on profile frames + username effects, rendered everywhere a user appears, with a shop on the STATS page and a new coin icon.

**Architecture:** Postgres-authoritative economy (`buy_cosmetic` SECURITY DEFINER RPC + ownership-guard trigger on `profiles`). Equipped cosmetics ride on two new `profiles` columns so existing profile fetches carry them. Frames are inline SVG, effects are CSS; a JS registry (`cosmetics.js`) is the single source of visuals, seeded in parallel into a `cosmetic_defs` table for server-side validation.

**Tech Stack:** React 19 + Vite, Supabase (Postgres/RLS/RPC), plain CSS in `App.css`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-07-17-cosmetics-design.md`.

## Global Constraints

- Git author **Leon <brownguest3123@gmail.com>** only; NEVER add AI co-author trailers. Commit, never push.
- No new npm deps. Reuse existing `stats-*` / `v-screen` / `modal` visual language.
- New SQL: RLS on, client writes denied except via RPC; functions `SECURITY DEFINER SET search_path = public`, EXECUTE revoked except `buy_cosmetic` → `authenticated`.
- `thin_line` frame is free, implicitly owned by all, unbuyable; `equipped_frame` NULL renders as `thin_line`.
- Catalog ids must match between `cosmetics.js` and the `cosmetic_defs` seed (parity test).
- `npm run lint` + `npm test` green before every JS commit. SQL sections (T2–T3) verified by review + smoke test (T5), commit-only.
- Frames/effects theme-aware; `prefers-reduced-motion: reduce` freezes animation.

Catalog (ids · price · min_level): frames `thin_line`0/0, `dashed_ring`150/0, `ice_crystal`450/5, `crimson_flame`650/5, `gold_laurel`800/10, `onyx_halo`950/10, `royal_crown`1300/15, `angel_wings`1500/20 · effects `silver_shine`300/0, `gold_shine`500/8, `rainbow_shine`900/12.

---

### Task 1: Cosmetics registry + CoinIcon + parity test

**Files:** Create `src/lib/cosmetics.js`, `src/components/CoinIcon.jsx`, `tests/cosmetics.test.js`.

**Interfaces produced:** `COSMETICS` (map id→def), `FRAMES`/`NAME_EFFECTS` (ordered arrays), `frameOf(id)`, `CATALOG_IDS`. `<CoinIcon size />`. Consumed by Avatar/Username (T6), StatsPage shop (T9), migration seed parity (T1 test guards against drift).

- [ ] **Step 1: Write failing parity test** `tests/cosmetics.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COSMETICS, FRAMES, NAME_EFFECTS, CATALOG_IDS } from '../src/lib/cosmetics.js';

const EXPECTED = {
  thin_line: ['frame', 0, 0], dashed_ring: ['frame', 150, 0],
  ice_crystal: ['frame', 450, 5], crimson_flame: ['frame', 650, 5],
  gold_laurel: ['frame', 800, 10], onyx_halo: ['frame', 950, 10],
  royal_crown: ['frame', 1300, 15], angel_wings: ['frame', 1500, 20],
  silver_shine: ['name_effect', 300, 0], gold_shine: ['name_effect', 500, 8],
  rainbow_shine: ['name_effect', 900, 12],
};

test('every catalog id has matching def (parity with cosmetic_defs seed)', () => {
  for (const [id, [type, price, min]] of Object.entries(EXPECTED)) {
    const c = COSMETICS[id];
    assert.ok(c, `missing ${id}`);
    assert.equal(c.type, type);
    assert.equal(c.price, price);
    assert.equal(c.minLevel, min);
  }
  assert.deepEqual([...CATALOG_IDS].sort(), Object.keys(EXPECTED).sort());
});

test('frames render, effects have a class', () => {
  for (const f of FRAMES) assert.equal(typeof f.renderFrame, 'function');
  for (const e of NAME_EFFECTS) assert.equal(typeof e.nameEffectClass, 'string');
});
```

- [ ] **Step 2: Run — expect FAIL** (`npm test`, module missing).

- [ ] **Step 3: Implement `src/lib/cosmetics.js`.** Each frame `renderFrame(size)` returns an SVG string sized to `size` (drawn as an absolutely-positioned overlay slightly larger than the avatar). Keep strokes in `currentColor` or explicit tier colors; ornate = stark geometric. Structure:

```js
// Frame SVG builders. Each returns an <svg> string sized `s`, positioned over the
// avatar by Avatar.jsx (see .cos-frame CSS). Geometric/editorial, not painterly.
const ring = (s, attrs) => `<svg class="cos-frame-svg" viewBox="0 0 100 100" width="${s}" height="${s}" aria-hidden="true">${attrs}</svg>`;

const FRAME_DEFS = {
  thin_line:    { name: 'Thin Line',    price: 0,    minLevel: 0,
    render: s => ring(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1.5"/>`) },
  dashed_ring:  { name: 'Dashed Ring',  price: 150,  minLevel: 0,
    render: s => ring(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>`) },
  ice_crystal:  { name: 'Ice Crystal',  price: 450,  minLevel: 5,
    render: s => ring(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="#7db8d8" stroke-width="2"/>` +
      Array.from({length:12},(_,i)=>{const a=i*30*Math.PI/180;const x1=50+46*Math.cos(a),y1=50+46*Math.sin(a),x2=50+50*Math.cos(a),y2=50+50*Math.sin(a);return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#a9d6ec" stroke-width="1.5"/>`}).join('')) },
  crimson_flame:{ name: 'Crimson Flame',price: 650,  minLevel: 5,
    render: s => ring(s, `<circle cx="50" cy="50" r="48" fill="none" stroke="#c0392b" stroke-width="2.5" class="cos-anim-flicker"/>`) },
  gold_laurel:  { name: 'Gold Laurel',  price: 800,  minLevel: 10,
    render: s => ring(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#c9a227" stroke-width="1.5"/>` +
      // two laurel arcs of short strokes on left/right
      [ -1, 1 ].map(side=>Array.from({length:7},(_,i)=>{const a=(120+ i*8)*Math.PI/180;const bx=50+47*Math.cos(a)*1+ (side<0?0:0);const by=50+47*Math.sin(a);const x=50+ side*47*Math.cos(a); const y=50+47*Math.sin(a); return `<line x1="${x}" y1="${y}" x2="${x+side*6*Math.sin(a)}" y2="${y-6*Math.cos(a)}" stroke="#c9a227" stroke-width="2"/>`}).join('')).join('')) },
  onyx_halo:    { name: 'Onyx Halo',    price: 950,  minLevel: 10,
    render: s => ring(s, `<circle cx="50" cy="50" r="49" fill="none" stroke="#222" stroke-width="3"/><circle cx="50" cy="50" r="45" fill="none" stroke="#555" stroke-width="1" class="cos-anim-spin"/>`) },
  royal_crown:  { name: 'Royal Crown',  price: 1300, minLevel: 15,
    render: s => ring(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#c9a227" stroke-width="2"/><path d="M38 8 L44 16 L50 6 L56 16 L62 8 L60 20 L40 20 Z" fill="#c9a227" transform="translate(0,-2)"/>`) },
  angel_wings:  { name: 'Angel Wings',  price: 1500, minLevel: 20,
    render: s => ring(s, `<circle cx="50" cy="50" r="47" fill="none" stroke="#ddd" stroke-width="1.5"/>` +
      [ -1, 1 ].map(side=>`<path d="M50 40 q ${side*30} -6 ${side*40} 8 q ${-side*18} -2 ${-side*28} 6 q ${side*12} -2 ${side*20} 4" fill="none" stroke="#e8e8e8" stroke-width="1.5" transform="translate(${side>0?0:0},0)"/>`).join('')) },
};

const NAME_EFFECT_DEFS = {
  silver_shine:  { name: 'Silver Shine',  price: 300, minLevel: 0,  cls: 'cos-fx-silver' },
  gold_shine:    { name: 'Gold Shine',    price: 500, minLevel: 8,  cls: 'cos-fx-gold' },
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
export function frameOf(id) { const c = COSMETICS[id || DEFAULT_FRAME]; return c && c.type === 'frame' ? c : COSMETICS[DEFAULT_FRAME]; }
export function nameEffectOf(id) { const c = id && COSMETICS[id]; return c && c.type === 'name_effect' ? c : null; }
```

- [ ] **Step 4: Implement `src/components/CoinIcon.jsx`.**

```jsx
export default function CoinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.1em', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="7"  fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M14.2 9.3a3.2 3.2 0 1 0 0 5.4" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 5: Run `npm test` + `npm run lint` — expect PASS/clean.** Adjust SVG only if the parity test fails.

- [ ] **Step 6: Commit.** `git add src/lib/cosmetics.js src/components/CoinIcon.jsx tests/cosmetics.test.js && git commit -m "feat: cosmetics registry, coin icon, parity test"`

---

### Task 2: Migration §1 — tables, RLS, seed, profile columns

**Files:** Create `supabase_cosmetics_migration.sql`.

- [ ] **Step 1: Write §1.**

```sql
-- Cosmetics migration — run in the Supabase SQL editor. Safe to re-run.
-- Spec: docs/superpowers/specs/2026-07-17-cosmetics-design.md

-- ── §1 TABLES / COLUMNS ─────────────────────────────────────────────────────
create table if not exists cosmetic_defs (
  id        text primary key,
  type      text not null check (type in ('frame','name_effect')),
  name      text not null,
  price     int  not null,
  min_level int  not null default 0,
  sort      int  not null
);

create table if not exists user_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references cosmetic_defs(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table profiles add column if not exists equipped_frame text;
alter table profiles add column if not exists equipped_name_effect text;

alter table cosmetic_defs  enable row level security;
alter table user_cosmetics enable row level security;

create policy "cosmetic_defs_select"  on cosmetic_defs  for select using (true);
create policy "user_cosmetics_select" on user_cosmetics for select using (auth.uid() = user_id);
-- No client writes on user_cosmetics: ownership only via buy_cosmetic().

insert into cosmetic_defs (id, type, name, price, min_level, sort) values
  ('thin_line','frame','Thin Line',0,0,1),
  ('dashed_ring','frame','Dashed Ring',150,0,2),
  ('ice_crystal','frame','Ice Crystal',450,5,3),
  ('crimson_flame','frame','Crimson Flame',650,5,4),
  ('gold_laurel','frame','Gold Laurel',800,10,5),
  ('onyx_halo','frame','Onyx Halo',950,10,6),
  ('royal_crown','frame','Royal Crown',1300,15,7),
  ('angel_wings','frame','Angel Wings',1500,20,8),
  ('silver_shine','name_effect','Silver Shine',300,0,1),
  ('gold_shine','name_effect','Gold Shine',500,8,2),
  ('rainbow_shine','name_effect','Rainbow Shine',900,12,3)
on conflict (id) do nothing;
```

- [ ] **Step 2: Review ids/prices/levels match the catalog table above. Commit.**

---

### Task 3: Migration §2 — buy RPC + equip-guard trigger

**Files:** Modify `supabase_cosmetics_migration.sql` (append).

**Interfaces:** `buy_cosmetic(text)` RPC (client-callable). Consumes `level_for_xp`, `game_state`, `wallets`, `check_achievements` from the gamification migration.

- [ ] **Step 1: Append §2.**

```sql
-- ── §2 BUY + EQUIP GUARD ────────────────────────────────────────────────────
create or replace function buy_cosmetic(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare c cosmetic_defs; v_level int; v_coins int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into c from cosmetic_defs where id = p_id;
  if not found then raise exception 'unknown cosmetic %', p_id; end if;
  if p_id = 'thin_line' then raise exception 'thin_line is free and already owned'; end if;
  if exists (select 1 from user_cosmetics where user_id = auth.uid() and cosmetic_id = p_id) then
    raise exception 'already owned'; end if;
  select level_for_xp(coalesce((select total_xp from game_state where user_id = auth.uid()),0)) into v_level;
  if v_level < c.min_level then raise exception 'requires level %', c.min_level; end if;
  perform ensure_game_rows(auth.uid());
  select coins into v_coins from wallets where user_id = auth.uid();
  if coalesce(v_coins,0) < c.price then raise exception 'insufficient coins'; end if;
  update wallets set coins = coins - c.price, lifetime_spent = lifetime_spent + c.price
   where user_id = auth.uid();
  insert into user_cosmetics (user_id, cosmetic_id) values (auth.uid(), p_id);
  perform check_achievements(auth.uid(), 'coins_spent');
end $$;

revoke execute on function buy_cosmetic(text) from public, anon;
grant  execute on function buy_cosmetic(text) to authenticated;

-- Ownership guard: equipping is a plain profiles UPDATE, so verify the equipped
-- ids are owned (NULL = unequip/default; thin_line is free/universal).
create or replace function trg_profiles_equip_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.equipped_frame is not null and new.equipped_frame <> 'thin_line'
     and not exists (select 1 from user_cosmetics
                     where user_id = new.id and cosmetic_id = new.equipped_frame) then
    raise exception 'frame % not owned', new.equipped_frame;
  end if;
  if new.equipped_name_effect is not null
     and not exists (select 1 from user_cosmetics
                     where user_id = new.id and cosmetic_id = new.equipped_name_effect) then
    raise exception 'name effect % not owned', new.equipped_name_effect;
  end if;
  return new;
end $$;
drop trigger if exists profiles_equip_guard on profiles;
create trigger profiles_equip_guard before insert or update on profiles
  for each row execute function trg_profiles_equip_guard();
```

- [ ] **Step 2: Review. Commit.**

---

### Task 4: SQL smoke script

**Files:** Create `scripts/test-cosmetics.sql` (txn wrapped, ROLLBACK).

- [ ] **Step 1: Write it** — asserts, on a picked `auth.users` row, with gamification rows ensured:
  1. seed wallet coins=2000, total_xp for level ~20; `buy_cosmetic('dashed_ring')` → coins 1850, lifetime_spent +150, row exists.
  2. `buy_cosmetic('dashed_ring')` again raises `already owned`.
  3. `buy_cosmetic('thin_line')` raises.
  4. under-level: set total_xp=0, `buy_cosmetic('angel_wings')` raises `requires level 20`.
  5. insufficient: set coins=10, level high, `buy_cosmetic('ice_crystal')` raises `insufficient coins`.
  6. equip guard: `update profiles set equipped_frame='royal_crown'` (unowned) raises; `='dashed_ring'` (owned) succeeds; `=null` succeeds.
  7. big spender: buy enough to push lifetime_spent ≥1000, assert `user_achievements` has `big_spender` unlocked.
  Use `begin … exception when others` blocks around the expected-raise cases (assert they raised). End `raise notice 'COSMETICS SMOKE PASSED'; rollback;`. NB: same-transaction `now()` is frozen — never `order by created_at`.

- [ ] **Step 2: Commit.**

---

### Task 5: Apply migration + smoke

- [ ] **Step 1:** Apply `supabase_cosmetics_migration.sql` via Supabase MCP if authenticated; else STOP and leave a clear note for Leon to paste it + `scripts/test-cosmetics.sql`. Re-runnable.
- [ ] **Step 2:** Run smoke; expect `COSMETICS SMOKE PASSED`. Fix the flagged section and re-run on failure.
- [ ] **Step 3:** Anon RLS spot-check via REST (curl with anon key): `user_cosmetics` returns `[]`; direct insert 42501; `buy_cosmetic` rpc as anon → `not authenticated`; `cosmetic_defs` returns 11 rows.

---

### Task 6: Shared Avatar + Username components + CSS

**Files:** Create `src/components/Avatar.jsx`, `src/components/Username.jsx`; modify `src/App.css`.

**Interfaces produced:** `<Avatar url size frame />` (frame id, NULL→thin_line), `<Username name effect className />`.

- [ ] **Step 1: `Avatar.jsx`** — image/placeholder circle + frame overlay:

```jsx
import { frameOf } from '../lib/cosmetics';

export default function Avatar({ url, size = 60, frame }) {
  const f = frameOf(frame);
  return (
    <div className="cos-avatar" style={{ width: size, height: size }}>
      {url
        ? <img src={url} alt="" className="cos-avatar-img" />
        : <div className="cos-avatar-ph">
            <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>
          </div>}
      <span className="cos-frame" dangerouslySetInnerHTML={{ __html: f.renderFrame(size) }} />
    </div>
  );
}
```

- [ ] **Step 2: `Username.jsx`.**

```jsx
import { nameEffectOf } from '../lib/cosmetics';
export default function Username({ name, effect, className = '' }) {
  const fx = nameEffectOf(effect);
  return <span className={`${className}${fx ? ' ' + fx.nameEffectClass : ''}`}>{name}</span>;
}
```

- [ ] **Step 3: Append CSS to `App.css`** — `.cos-avatar` (relative, round, overflow visible so frame can exceed), `.cos-avatar-img`/`.cos-avatar-ph` (round, clip), `.cos-frame` (absolute, centered, ~112% size, pointer-events none), `.cos-frame-svg` overflow visible; name-effect classes `.cos-fx-silver`/`.cos-fx-gold`/`.cos-fx-rainbow` (gradient `background-clip:text; color:transparent;` + `@keyframes cos-shine`); frame anims `.cos-anim-flicker`/`.cos-anim-spin`; all wrapped so `@media (prefers-reduced-motion: reduce){ .cos-anim-*, .cos-fx-* { animation: none } }`.

- [ ] **Step 4: lint; commit.** (Visual verified in T10.)

---

### Task 7: useGame cosmetics state

**Files:** Modify `src/hooks/useGame.js`.

**Interfaces produced (added to return):** `ownedCosmetics` (Set), `equipped` ({frame, name_effect}), `buyCosmetic(id)`, `equipCosmetic(id)`, `unequip('frame'|'name_effect')`.

- [ ] **Step 1:** On load (in the existing user effect) fetch `user_cosmetics` ids → `ownedCosmetics`, and the user's `profiles.equipped_frame, equipped_name_effect` → `equipped`. Guard with the existing `cancelled` flag.
- [ ] **Step 2:** `buyCosmetic(id)` = `sb.rpc('buy_cosmetic',{p_id:id})`; on success refetch owned + `refresh()` (wallet). Returns `{error}` for the UI to surface the raised message.
- [ ] **Step 3:** `equipCosmetic(id)` / `unequip(type)` = `sb.from('profiles').update({ equipped_frame|equipped_name_effect: id|null }).eq('id', user.id)`; on success set local `equipped`. (Upsert if no row: `upsert({id:user.id, ...})`.)
- [ ] **Step 4:** lint; commit.

---

### Task 8: Wire render sites + coin icon

**Files:** Modify `src/components/ExplorePage.jsx`, `FriendsPage.jsx`, `ProfilePanel.jsx`, `AppHeader.jsx`, `StatsPage.jsx`, `src/App.jsx`.

- [ ] **Step 1: ExplorePage** — delete local `Avatar` (line ~258), import shared `Avatar` + `Username`; pass `frame={p.equipped_frame}` at each `<Avatar>`; wrap names in `<Username name=… effect={p.equipped_name_effect}/>`. Ensure profile `select('*')` (already used) carries the new columns; for the `id, username, avatar_url` narrowed selects (feed posts ~427), add `equipped_frame, equipped_name_effect`.
- [ ] **Step 2: FriendsPage** — replace `DesignAvatar` with shared `Avatar`, pass frames; add the two columns to its `profiles.select('id, username, avatar_url, location')` (line ~51); wrap names in `<Username>`.
- [ ] **Step 3: ProfilePanel / own profile header** — show own equipped frame on the avatar; (loadout editing itself lives in the STATS shop, T9).
- [ ] **Step 4: AppHeader** — HUD avatar button uses `<Avatar>` with own `equipped_frame`; swap the `¢` in the level line for `<CoinIcon/>`. Thread `equipped` in from `App.jsx` (pass `game.equipped`).
- [ ] **Step 5: StatsPage** — swap `¢` occurrences for `<CoinIcon/>` in the header sub and quest rows.
- [ ] **Step 6: App.jsx** — pass `game.equipped` to `AppHeader`.
- [ ] **Step 7: lint; commit.**

---

### Task 9: SHOP section on StatsPage

**Files:** Modify `src/components/StatsPage.jsx`, `src/App.css`.

- [ ] **Step 1:** Below achievements, render **LOADOUT** (current frame + effect on a sample `<Avatar>`/`<Username>` with unequip buttons) then **FRAMES** and **NAME EFFECTS** grids from `FRAMES`/`NAME_EFFECTS`. Each card: live preview, name, `price` + `<CoinIcon/>`, and state button computed from `game`:
  - owned (or `thin_line`) → `EQUIP` (or `EQUIPPED` if currently equipped) → calls `equipCosmetic`.
  - not owned, `level < minLevel` → disabled `LVL {minLevel}`.
  - not owned, `coins < price` → disabled `NEED COINS`.
  - else → `BUY` → `buyCosmetic`, show raised error inline on failure.
  Level derived via `getLevelState(gameState.total_xp).level`.
- [ ] **Step 2:** CSS `.shop-grid` (reuse `.stats-ach-grid` pattern), `.shop-card`, `.shop-card-preview`, `.shop-btn` states (disabled greyed).
- [ ] **Step 3:** lint; commit.

---

### Task 10: Final verification + Codex review

- [ ] **Step 1:** `npm run lint` + `npm test` green.
- [ ] **Step 2:** Browser E2E on demo account: STATS shop renders; buy an affordable frame → EQUIP → frame shows on HUD avatar + STATS loadout + profile header; buy+equip a name effect → shine renders; a locked item shows LVL/NEED COINS; coin icon renders in HUD + STATS. Console clean.
- [ ] **Step 3:** Spec walk-through — confirm every §1–§9 requirement implemented; note the deliberate globe-pin (canvas) descope.
- [ ] **Step 4:** Codex review of the full diff (`~/.local/bin/codex exec --sandbox read-only`), verify findings, apply safe ones, surface risky ones. Commit fixes.
