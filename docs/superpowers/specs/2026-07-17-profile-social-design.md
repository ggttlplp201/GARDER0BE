# Profile Showcase, Fit Likes & Activity Feed — Design Spec
**Date:** 2026-07-17
**Sub-project 3 of 4** of the Social & Gamification layer (source brief: `GARDEROBE-social-features-spec.md`)

## Context

Sub-projects 1 (game engine) and 2 (cosmetics) shipped. This adds the social surface:
fit likes, a friends activity feed, and an enriched profile showcase. `profile_likes`
(profile-level) and `outfit_posts` (public fits) already exist; the current Explore "FEED"
tab is external articles, and the profile view is minimal (header + owned count).

Decisions locked during brainstorming:
- **Feed = query-time merge** of friends' existing rows (no `feed_events` table / fan-out).
- **Fit likes** grant the fit owner **+5 XP** (farm-safe, once per liker) and count toward
  the **Popular** achievement (profile + fit likes combined).
- **Pins** stored as `profiles.pinned_item_ids uuid[]` (cap 3), riding existing profile fetches.
- Economy stays Postgres-authoritative; render reuses the shared `Avatar`/`Username`.

## 1. Scope

**In:** `fit_likes` (table + like button/count on posts and feed), friends **ACTIVITY**
feed on the Friends page (items added, fits posted, achievements unlocked), enriched
**ProfileView** showcase (level badge, collection value, stats, achievements grid, cosmetics
loadout, up to 3 pinned items), pin/unpin from item detail, own-profile view entry.

**Out:** sharing feed items (sub-project 4 / chat), level-up feed events (would require
relaxing private `xp_events` RLS — deferred), public *wardrobe* likes (only fits are
likeable here), real-time feed push (feed is fetched on open + manual refresh).

## 2. Data model (`supabase_social_migration.sql`)

| Table / column | Shape | RLS |
|---|---|---|
| `fit_likes` | `user_id uuid`, `post_id uuid → outfit_posts(id) on delete cascade`, `created_at`, PK `(user_id, post_id)` | SELECT: everyone (public counts). INSERT/DELETE: `auth.uid() = user_id`. |
| `profiles.pinned_item_ids` | `uuid[]` nullable | Existing owner-UPDATE policy; validated by a guard trigger (≤3, own items). |

RLS change — **`user_achievements` SELECT** is relaxed so a visitor can see a public
profile's badges (required by the showcase and the achievement feed):
`using (auth.uid() = user_id OR exists (select 1 from profiles p where p.id =
user_achievements.user_id and p.is_public = true))`.

`compute_metric('likes_received')` is updated (create-or-replace `compute_metric`) to
`count(profile_likes where liked_user_id = p_user) + count(fit_likes join outfit_posts on
post_id = id where outfit_posts.user_id = p_user)`. All other metrics unchanged.

## 3. Fit-like XP + guards (Postgres)

- **`trg_fit_likes_xp`** (AFTER INSERT on `fit_likes`): resolve the post owner from
  `outfit_posts`; if the owner exists and isn't the liker, award **+5 XP** with reason
  `fit_like_received` and `ref_id = liker id`, deduped so a given liker awards a given owner
  at most once (`not exists (xp_events where user_id = owner and reason = 'fit_like_received'
  and ref_id = liker)`) — matches the profile-like anti-farm model. Then
  `check_achievements(owner, 'likes_received')` (advances Popular). Self-likes: allowed for
  the count, no XP.
- **`trg_profiles_pins_guard`** (BEFORE INSERT OR UPDATE on `profiles`): if
  `pinned_item_ids` is non-null, reject when `array_length > 3` or when any id is not an
  item owned by `new.id`. Independent of the cosmetics equip-guard trigger.

## 4. Fit likes UI

On each `OutfitsFeed` post card (and each fit card in the activity feed): a heart button
with the like count, filled when `likedByMe`. Toggle = insert/delete an own `fit_likes` row
(same direct-write pattern as `profile_likes`). Like state batch-loaded with the posts
(`fit_likes` counts grouped by `post_id`, plus the viewer's own likes). Optimistic toggle.

## 5. Activity feed (query-time merge)

New **ACTIVITY** tab on the **FriendsPage** (joins FRIENDS · REQUESTS · LIKES). A `useFeed`
loader:
1. Resolve accepted friend ids (own `friend_requests`).
2. In parallel, fetch friends' recent public rows: `items` (owned, created_at desc — "added
   an item"), `outfit_posts` ("posted a fit"), `user_achievements` (unlocked_at desc, joined
   to `achievement_defs` for name/xp — "unlocked an achievement"). Each capped (~20) and
   filtered to friends whose profile is public (items/achievements respect the privacy
   toggle via existing RLS; outfit_posts are already public).
3. Normalize to a common `{ type, actorId, ts, payload }`, merge, sort by `ts` desc,
   paginate client-side (load-more). Enrich actors from a single `profiles` fetch (username,
   avatar, equipped cosmetics).
4. Render rows with the actor's `<Avatar>`/`<Username>`: item rows show the item thumbnail;
   fit rows render the fit and are **likeable** (reuse §4); achievement rows show the badge +
   XP. Empty state when no friends / no activity.

Level-up feed items are intentionally omitted (private `xp_events`).

## 6. Profile showcase (enriched `ProfileView` in ExplorePage)

Extend the existing `ProfileView`:
- **Header:** `<Avatar>` + frame, `<Username>` + effect (done), a **level badge** (from the
  profile's `game_state.total_xp` via `getLevelState`; `game_state` is public-profile
  readable), **collection value** (sum of their owned items' prices), and **coin balance**
  **own-profile only** (`wallets` is own-row RLS, so it naturally only resolves for self).
- **Showcase:** up to 3 **pinned items** from `pinned_item_ids`, rendered as thumbnails
  (clickable where the item is the viewer's own). Hidden if none.
- **Stats row:** item count, fits posted (`outfit_posts` count), total wears (Σ
  `items.wear_count`), likes received (profile + fit), friends count (own profile / where
  readable).
- **Achievements:** compact grid of unlocked achievements (now readable for public profiles).
- **Cosmetics loadout:** equipped frame + effect shown (from the profile row).
- Respects the existing public/private discovery toggle (private profiles aren't in Explore).

**Own-profile entry:** a "VIEW PUBLIC PROFILE" button in `ProfilePanel` opens `ProfileView`
for the current user (so you can see your showcase, coin balance, and manage pins).

## 7. Pin management

`ItemDetailView` gains a **PIN** / **PINNED** toggle (owned items only) that adds/removes the
item id in `profiles.pinned_item_ids` (client upsert; capped at 3 with a friendly message
when full; the DB guard is the backstop). Threaded via a callback from `App.jsx` that knows
the current pinned set, or read fresh from the profile row.

## 8. State / hooks

- A small `useProfileData(profileId, viewerId)` (or inline in `ProfileView`) fetches the
  profile row, their `game_state`, items, `outfit_posts` count, achievements, and like
  totals in parallel and derives the showcase view model.
- Fit-like helpers (`toggleFitLike(postId)`) live where posts render (OutfitsFeed + feed),
  using direct `fit_likes` writes.
- Pins: `pinnedItemIds` for the current user surfaced from the profile row; a
  `setPinned(ids)` writes the array.

## 9. Testing & verification

- **SQL smoke** (`scripts/test-social.sql`, rolled-back txn, impersonates a user via
  `set_config('request.jwt.claims', …)`): fit like → owner +5 XP + Popular progress;
  self-like → no XP; re-like by same liker → no double XP; `likes_received` metric counts
  both sources; pins guard rejects >3 and non-owned ids, accepts ≤3 owned; `user_achievements`
  readable for a public profile, hidden for a private one.
- **Manual E2E** (demo account): like a fit → count increments, heart fills; open ACTIVITY
  → friends' items/fits/achievements appear time-sorted; open a profile → level badge, stats,
  achievements, loadout, pins render; pin an item from detail → appears in showcase; own
  profile shows coin balance.
- Frontend lint + existing JS tests stay green; build clean.

## 10. Security

- `fit_likes` writes are own-row only; the +5 XP goes to the *owner* via a definer trigger,
  deduped per liker (farm-safe, consistent with profile likes). No self-like XP.
- Pins can only reference the owner's items (guard trigger); array capped at 3.
- Relaxing `user_achievements` SELECT exposes only unlocked-achievement rows of **public**
  profiles — the same visibility the showcase intentionally grants; private profiles stay
  hidden.
- Feed reads rely on existing per-table RLS (items/achievements gated by the profile privacy
  toggle; outfit_posts already public), so the feed can't leak private users' activity.
