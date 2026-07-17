# Game Engine Core — Design Spec
**Date:** 2026-07-17
**Sub-project 1 of 4** of the Social & Gamification layer (source brief: `GARDEROBE-social-features-spec.md`)

## Context & decomposition

The social/gamification brief spans ~10 subsystems. It is decomposed into four
sub-projects, each with its own spec → plan → implementation cycle:

1. **Game engine core** (this spec) — XP, levels, coins, achievements, daily quests,
   streaks, notifications, backfill.
2. **Cosmetics** — catalog, shop, buy/equip, profile frames + username effects rendered
   everywhere users appear.
3. **Profile showcase + fit likes + activity feed.**
4. **Chat + sharing/referrals** (share rewards, invite links).

Decisions locked during brainstorming:

- **Economy lives in Postgres** — SECURITY DEFINER functions + RLS; the client never
  writes XP/coin state directly.
- **XP is granted by DB triggers on real data changes**, not client-called award RPCs.
  Only idempotent once-per-day session RPCs are client-callable.
- **Full backfill**: existing users get XP/levels/coins/achievements computed from their
  current data at migration time.
- **Phase-1 XP sources and quests use only actions that exist today** (wear, add item,
  save outfit, daily open, browse Explore, like a profile, friend accepted, public fit
  posted, price drop). The engine is built so later sub-projects register new sources.
- **UI slots into the existing design language** — no visual redesign; new elements adopt
  current header/nav/toast/modal conventions.

## 1. Scope

**In:**
- XP engine with level curve; level-ups grant coins.
- Coins wallet (earn only; spending arrives with the cosmetics shop).
- `wear_events` ledger (wear dates; farm-resistant wear XP).
- Achievements: 12 of the brief's 14 active now; **Big Spender** ships in the catalog but
  is only progressable once the shop exists; share-based achievements deferred.
- Daily quests (3/day, deterministic roll) + login streak with 7-day milestone.
- XP toasts, achievement toasts, level-up modal, header HUD, new STATS page.
- One-time backfill for existing users.

**Out (later sub-projects):** cosmetics shop and rendering, profile showcase page, fit
likes, activity feed, chat, sharing/referral rewards, leaderboards.

## 2. Data model

New migration `supabase_gamification_migration.sql`:

| Table | Columns | RLS |
|---|---|---|
| `game_state` | `user_id PK→auth.users`, `total_xp int`, `streak_count int`, `last_open_date date`, `updated_at` | SELECT: own row, or any row whose profile `is_public` (future profiles/leaderboards). No client INSERT/UPDATE/DELETE. |
| `wallets` | `user_id PK`, `coins int`, `lifetime_spent int` | SELECT: own row only. No client writes. |
| `xp_events` | `id`, `user_id`, `amount int`, `reason text`, `ref_id uuid?`, `leveled_to int?`, `coins_awarded int?`, `created_at` | SELECT: own rows. No client writes. Realtime-enabled. |
| `wear_events` | `id`, `user_id`, `item_id FK`, `worn_on date`, `created_at`, **unique `(item_id, worn_on)`** | SELECT/INSERT: own rows (must own the item). No UPDATE/DELETE. |
| `achievement_defs` | `id text PK`, `name`, `description`, `metric text`, `goal int`, `xp int`, `sort int` | SELECT: everyone. Seeded by migration. |
| `user_achievements` | `user_id`, `achievement_id FK`, `progress int`, `unlocked_at timestamptz?`, PK `(user_id, achievement_id)` | SELECT: own rows. No client writes. |
| `daily_quests` | `id`, `user_id`, `quest_date date`, `quest_type text`, `goal int`, `progress int`, `xp_reward int`, `coin_reward int`, `completed_at?`, **unique `(user_id, quest_date, quest_type)`** | SELECT: own rows. No client writes. |

`items.wear_count` is kept and now maintained by a trigger on `wear_events` (existing
values remain as the pre-ledger baseline; `useItems.logWear` switches to inserting a
`wear_events` row).

## 3. Economy engine (Postgres)

All functions SECURITY DEFINER with explicit ownership checks.

### Level curve
- Level 1→2 costs 200 XP; each subsequent level costs 100 more (2→3 = 300, …).
- Cumulative XP to reach level *n* (n ≥ 2): `50·n·(n+1) − 100`.
- Level-up coin grant: `100 + 25·newLevel` per level gained.
- Defined once in SQL (`xp_to_reach(level)`, `level_for_xp(total_xp)`), mirrored in
  `src/lib/levels.js` (`getLevelState(totalXp) → { level, xpIntoLevel, xpForNextLevel,
  pct }`) with a parity unit test.

### `award_xp(p_user, p_amount, p_reason, p_ref)` — internal only
Not exposed as an RPC (revoked from `authenticated`). Called by triggers and the session
RPCs. Atomically: bump `game_state.total_xp`; if level increased, credit coins for each
level gained; insert one `xp_events` row carrying `leveled_to`/`coins_awarded` when a
level-up occurred (the client's only signal — one Realtime event per action).

### XP triggers (client cannot fake XP)
| Trigger | Award |
|---|---|
| `items` INSERT with `status='owned'`; `items` UPDATE wishlist→owned | +25 add-item |
| `wear_events` INSERT | +12 wear (unique per item/day) |
| `saved_fits` INSERT | +20 outfit |
| `friend_requests` UPDATE → `accepted` | +15 to **both** users |
| `profile_likes` INSERT | +5 to the liked user |

Each trigger also advances matching daily quests and calls achievement checks.

### Session RPCs (the only client-callable entry points)
- **`record_daily_open()`** — idempotent per day. First call: +10 XP, streak increment
  (reset if a day was missed), rolls today's quests, returns
  `{ game_state, wallet, quests, was_first_open }`. Subsequent calls return state only.
- **`progress_quest(quest_type)`** — only accepts `'browse_explore'` (whitelist).
  Increments today's quest if present and incomplete; farmable only to that quest's
  completion, at most once per day.

### Daily quests
- Rolled inside `record_daily_open()`: 3 quests picked deterministically from
  `hash(user_id, date)` — pool: `log_wear` (goal 1–3), `add_item` (1), `save_outfit` (1),
  `like_profile` (1), `browse_explore` (1). Rewards 15–40 XP + 5–15 coins by quest.
- Completion grants the reward through `award_xp` + wallet credit; `xp_events` reason
  `quest:<type>` drives the toast.

### Streak
- Maintained by `record_daily_open()`. 7-day login-streak milestone grants a +50 coin
  bonus, once per streak run (distinct from the **Daily Driver** achievement, which
  tracks 7 consecutive days of *wears*).

### Achievements
`check_achievements(p_user, p_metric)` recomputes the metric from source-of-truth data
and upserts `user_achievements`, unlocking (once) with its XP via `award_xp`.

| id | Metric source | Goal / XP |
|---|---|---|
| first_steps | owned items count | 1 / 50 |
| curator | owned items count | 25 / 150 |
| archivist | owned items count | 100 / 400 |
| fit_check | saved_fits count | 1 / 50 |
| stylist | saved_fits count | 5 / 150 |
| daily_driver | wear_events on 7 consecutive days | 7 / 200 |
| well_worn | Σ items.wear_count | 50 / 250 |
| social_butterfly | profile_likes given | 5 / 75 |
| popular | profile_likes received | 25 / 300 |
| networker | accepted friends | 10 / 150 |
| trendsetter | outfit_posts count | 5 / 150 |
| bargain_hunter | price-drop detected (trigger on `wishlist_price_history` when a new observation undercuts the source's previous price) | 1 / 100 |
| big_spender | `wallets.lifetime_spent` | 1000 / 100 — in catalog now, progressable from sub-project 2 |
| drip_lord | level | 20 / 500 |

## 4. Client integration

- **`useGame(user)`** hook + small `GameContext` provider in `App.jsx` (same hand-rolled
  hook style as `useItems`; no state library). Responsibilities: call
  `record_daily_open()` on login; fetch game_state/wallet/quests/achievements; subscribe
  to Realtime INSERTs on `xp_events` (own rows, mirroring the existing
  `profile_likes`/`friend_requests` channels); maintain a FIFO notification queue.
- **`GameToasts`** — rendered next to the existing `NotifToast`, reusing
  `toast-stack`/`like-toast` styling: `+12 XP · WEAR LOGGED`, `ACHIEVEMENT — CURATOR
  +150 XP`. Drains one toast at a time so stacked rewards read cleanly.
- **`LevelUpModal`** — triggered by an `xp_events` row with `leveled_to`; follows the
  `AddItemModal` overlay/modal conventions: `LEVEL 12`, `+400 COINS`. (Cosmetic-unlock
  line appended in sub-project 2.)
- `useItems.logWear` now inserts into `wear_events` (optimistic `wear_count` bump kept;
  unique-violation on same-day wear surfaces as a quiet no-XP success).

## 5. UI surfaces (minimal-change placement)

- **Header (`AppHeader`)** — add a fourth line to the existing `app-header-meta` mono
  block: `LVL 12 · 340/1400 XP · 1,250 ¢`, plus a 2px XP progress bar under the meta
  block. No layout or style system changes.
- **Nav (`AppNav`)** — add a 7th tab `STATS` following the exact icon/label pattern; the
  `COLLECTION VALUE` footer line is untouched. No badge initially.
- **`StatsPage`** — new page using the standard `v-screen` header/body layout:
  1. **TODAY'S QUESTS** — 3 rows with progress bars + rewards (`design-people-row`-style
     rows).
  2. **STREAK** — current streak count + best.
  3. **ACHIEVEMENTS** — grid; earned show date + XP, locked greyed with progress bars.
- Coin balance appears in the header line and on StatsPage; it is private (own data
  only), matching the brief.

## 6. Backfill (one-time, inside the migration)

Per existing user, in one pass with toasts suppressed (`reason='backfill'`, and the
client ignores backfill events):

1. XP = owned items·25 + Σ wear_count·12 + saved_fits·20 + accepted friends·15 +
   likes received·5.
2. Set `game_state.total_xp`; derive level; credit the wallet with all cumulative
   level-up grants.
3. Seed `user_achievements` from current metrics; unlock those already met
   (`unlocked_at = now()`), record progress for the rest.
4. Initialize `wallets` and `game_state` rows for all users (and on-signup via trigger on
   `profiles` insert / first `record_daily_open()` upsert for new users).

## 7. Security

- Every new table denies client writes by default; the only client INSERT is
  `wear_events` (own rows, item ownership enforced, unique per item/day).
- `award_xp` and internal helpers have EXECUTE revoked from `authenticated`; only
  `record_daily_open()` and `progress_quest()` are exposed, both idempotent per day.
- Triggers run with definer rights; all reward paths originate from real data changes
  covered by the existing hardened RLS (items, saved_fits, friend_requests,
  profile_likes).
- Like-XP via alt accounts is accepted as low-risk for now; revisit with leaderboards.

## 8. Testing & verification

- **Unit (JS):** `levels.js` parity fixtures (level boundaries, pct math) against values
  produced by the SQL functions.
- **SQL smoke script** (`scripts/test-gamification.sql`): seed a test user; assert
  trigger awards, quest completion, level-up coin grant, idempotent daily open, streak
  reset, achievement unlock-once, backfill math.
- **Manual E2E:** add item → toast; log wear twice same day → one XP award; complete a
  quest → reward toast; force a level-up → modal; next-day open → streak+quests re-roll.
- Frontend lint + existing test suites must stay green.
