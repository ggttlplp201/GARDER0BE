# Cosmetics — Design Spec
**Date:** 2026-07-17
**Sub-project 2 of 4** of the Social & Gamification layer (source brief: `GARDEROBE-social-features-spec.md`)

## Context

Sub-project 1 (game engine core) shipped: XP/levels/coins wallet, achievements, quests,
streaks, STATS page. This sub-project spends coins on **cosmetics** — profile frames and
username effects — and renders them everywhere a user appears.

Decisions locked during brainstorming:
- **Frames built in code** as inline SVG + CSS (no image assets); stark geometric
  interpretations matching GARDEROBE's editorial mono aesthetic, not painterly QQ art.
- **Shop lives in a new SHOP section on the STATS page** (no new nav tab).
- **Equipped cosmetics travel on the `profiles` table** (two nullable columns) so existing
  profile fetches carry them for free.
- **Economy stays Postgres-authoritative** (SECURITY DEFINER RPC + RLS), same as sub-project 1.
- **Balanced price curve**; **one free starter frame** (Thin Line) universal to all users;
  **8 frames + 3 name effects**.
- **New:** a small SVG **coin icon** replaces the `¢` glyph in the HUD and STATS.

## 1. Scope

**In:** coin shop UI, `buy_cosmetic` RPC, equip/unequip via ownership-guarded profile write,
shared `<Avatar>` + `<Username>` components rendering equipped cosmetics at all user-visible
sites, level-gating, coin icon, wiring the existing **Big Spender** achievement
(`wallets.lifetime_spent`).

**Out:** rarity, trading, real-money. Chat render sites are wired when chat ships
(sub-project 4). No leaderboard.

## 2. Data model (`supabase_cosmetics_migration.sql`)

| Table / column | Shape | RLS |
|---|---|---|
| `cosmetic_defs` | `id text PK`, `type text ('frame'\|'name_effect')`, `name text`, `price int`, `min_level int default 0`, `sort int` | SELECT: everyone. Seeded by migration. |
| `user_cosmetics` | `user_id uuid`, `cosmetic_id text → cosmetic_defs`, `acquired_at timestamptz`, PK `(user_id, cosmetic_id)` | SELECT: own rows. **No client writes** (buy via RPC). |
| `profiles.equipped_frame` | `text` nullable | Existing profiles policies (owner UPDATE); equip guarded by trigger below. |
| `profiles.equipped_name_effect` | `text` nullable | Same. |

The **visual** for each cosmetic id lives in `src/lib/cosmetics.js` (a JS render registry);
`cosmetic_defs` holds only what the server must validate (price, min_level, type).

**Starter frame:** `thin_line` (price 0, min_level 0) is treated as **implicitly owned by
everyone** and is the default when `equipped_frame` is NULL. It needs no ownership row and no
backfill: the render layer maps NULL → `thin_line`, and the shop/buy layer special-cases it as
always-owned. This is robust for brand-new users with no `profiles` row yet.

## 3. Economy (Postgres, SECURITY DEFINER)

- **`buy_cosmetic(p_id text)`** — client-callable RPC. Validates in order: `auth.uid()` set;
  cosmetic exists; `p_id <> 'thin_line'` (free, unbuyable); not already owned; user level ≥
  `min_level` (level derived from `game_state.total_xp` via `level_for_xp`); wallet coins ≥
  price. On success, atomically: deduct coins, add price to `lifetime_spent`, insert
  `user_cosmetics`, then `perform check_achievements(uid, 'coins_spent')` (unlocks Big Spender
  at 1,000). Raises a descriptive exception on any failed check (client shows the message).
  EXECUTE granted to `authenticated`.
- **Equip / unequip** reuses the existing profile write — no new RPC. Owners already may
  UPDATE their own `profiles` row (ProfilePanel does). A **BEFORE INSERT OR UPDATE trigger on
  `profiles`** (`trg_profiles_equip_guard`) rejects any `equipped_frame` /
  `equipped_name_effect` value that is non-NULL, not `thin_line`, and not present in that
  user's `user_cosmetics`. NULL is always allowed (= unequip / fall back to default). This
  keeps ownership authoritative even though the columns live on a client-writable table.

## 4. Rendering — shared components

- **`src/lib/cosmetics.js`** — the render registry: `COSMETICS[id] = { id, type, name,
  renderFrame(size) | nameEffectClass }` plus `FRAMES` / `NAME_EFFECTS` ordered lists. Single
  source for visuals; the migration's `cosmetic_defs` seed and this registry must list the
  same ids (a unit test asserts parity).
- **`src/components/Avatar.jsx`** — `<Avatar url frame size>`: image-or-placeholder circle
  plus the equipped frame's SVG overlay scaled to `size`. `frame` NULL → `thin_line`. Replaces
  the duplicated `DesignAvatar` copy-pasted in `FriendsPage` and `ExplorePage` (targeted
  cleanup — both import the shared one).
- **`src/components/Username.jsx`** — `<Username name effect>`: name text with the equipped
  effect's CSS class (Silver/Gold/Rainbow shine). NULL effect → plain text.
- **`src/components/CoinIcon.jsx`** — `<CoinIcon size>`: a small SVG coin. Stark editorial
  mark: an outer struck circle with a concentric inner ring and a centered serif “G”
  monogram (GARDEROBE), `currentColor` so it inherits text color in light/dark. Replaces the
  `¢` glyph in `AppHeader` and `StatsPage`.
- **Frames** are inline SVG (rings, facets, laurel, crown, wings) sized by `size`; **effects**
  are CSS gradient-text animations. All theme-aware; `@media (prefers-reduced-motion: reduce)`
  freezes animated frames/effects to a static state.

**Render sites wired:** profile header (own + others), FriendsPage rows, ExplorePage people
list + feed rows, globe pins (`DesignHouseGlobe`), own header HUD avatar. Every one of these
already selects from `profiles`, so it gains `equipped_frame` / `equipped_name_effect` with no
new query. Chat deferred.

## 5. Catalog (concrete)

**Frames** (`type='frame'`):
| id | name | price | min_level |
|---|---|---|---|
| thin_line | Thin Line | 0 (free, default) | 0 |
| dashed_ring | Dashed Ring | 150 | 0 |
| ice_crystal | Ice Crystal | 450 | 5 |
| crimson_flame | Crimson Flame | 650 | 5 |
| gold_laurel | Gold Laurel | 800 | 10 |
| onyx_halo | Onyx Halo | 950 | 10 |
| royal_crown | Royal Crown | 1300 | 15 |
| angel_wings | Angel Wings | 1500 | 20 |

**Name effects** (`type='name_effect'`):
| id | name | price | min_level |
|---|---|---|---|
| silver_shine | Silver Shine | 300 | 0 |
| gold_shine | Gold Shine | 500 | 8 |
| rainbow_shine | Rainbow Shine | 900 | 12 |

Prices pace against level-up coin grants (`100 + 25·level`), so tier-1 is reachable by
level 3–4 and the ornate top tier is a genuine level-15–20 goal.

## 6. UI — SHOP section on STATS

Appended below the achievements grid on `StatsPage`:
- **LOADOUT** line: currently equipped frame + name effect shown on a sample avatar/name,
  each with an unequip control (unequip = write NULL).
- **FRAMES** row and **NAME EFFECTS** row. Each cosmetic is a card: live preview (the frame
  rendered on a sample avatar, or the effect rendered on a sample name), name, price with the
  coin icon, and a state button:
  - **BUY** — owned=false, level met, coins ≥ price.
  - **LVL N** (disabled) — level not met.
  - **NEED COINS** (disabled) — level met, can't afford.
  - **EQUIP** / **EQUIPPED** — owned (or thin_line).
- Buying calls `buy_cosmetic`; on success the wallet/ownership refresh via the existing
  `useGame` refresh + a new ownership fetch. Equipping writes the profile column and updates
  local state so the change is visible immediately across the app.
- All styled in the existing `stats-*` / `v-screen` language; no redesign.

## 7. State / hooks

- `useGame` gains `ownedCosmetics` (set of ids from `user_cosmetics`) and `equipped`
  (`{ frame, name_effect }` from the user's `profiles` row), fetched on load and refreshed
  after buy/equip. Exposes `buyCosmetic(id)`, `equipCosmetic(id)`, `unequip(type)`.
- Equipped values are also surfaced to `AppHeader` (own HUD avatar) and threaded into the
  profile/friends/explore render sites from their existing profile data.

## 8. Testing & verification

- **Unit (JS):** `cosmetics.js` ↔ `cosmetic_defs` id/type parity fixture; every catalog id
  has a render entry and a valid type.
- **SQL smoke** (`scripts/test-cosmetics.sql`, wrapped in a rolled-back txn): buy happy-path
  (coins deducted, lifetime_spent up, row inserted); insufficient-coins reject; under-level
  reject; double-buy reject; buy `thin_line` reject; equip-unowned trigger reject; equip-owned
  succeeds; Big Spender unlock at 1,000 lifetime spent.
- **Manual E2E** (demo account): buy an affordable frame → EQUIP → confirm it renders on the
  header HUD avatar, the STATS loadout, and the profile header; equip a name effect → confirm
  shine renders; verify a locked cosmetic shows LVL/NEED COINS correctly; confirm a second
  account sees your equipped frame on your public profile.
- Frontend lint + existing JS tests stay green.

## 9. Security

- `user_cosmetics` denies all client writes; ownership only grows via `buy_cosmetic`
  (SECURITY DEFINER, level + balance checked server-side). Coins can't go negative (guarded).
- Equipping is ownership-enforced by the `profiles` trigger, so a user cannot equip an unowned
  cosmetic even by writing the column directly.
- `equipped_frame` / `equipped_name_effect` are public (like `username` / `avatar_url`) — they
  are cosmetic pointers, not sensitive data.
- `cosmetic_defs` is read-only to clients (seeded by migration).
