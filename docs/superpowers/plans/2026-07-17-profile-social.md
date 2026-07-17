# Profile Showcase, Fit Likes & Activity Feed — Implementation Plan

> Execute task-by-task; checkbox steps. Spec: `docs/superpowers/specs/2026-07-17-profile-social-design.md`.

**Goal:** Fit likes (with owner XP + Popular), a friends activity feed, and an enriched profile showcase.

**Architecture:** One SQL migration (`fit_likes` + pins guard + `user_achievements` RLS relax + `compute_metric` update + fit-like XP trigger). Client: fit-like buttons, an ACTIVITY tab on FriendsPage doing a query-time merge, an enriched ProfileView, and a PIN toggle in ItemDetailView. Reuses shared `Avatar`/`Username` and the `getLevelState` helper.

**Tech Stack:** React 19 + Vite, Supabase (Postgres/RLS/RPC), plain CSS, `node --test`.

## Global Constraints
- Git author **Leon <brownguest3123@gmail.com>** only; no AI trailers. Commit, never push.
- No new npm deps. Reuse `stats-*`/`v-screen`/`design-people-*`/`explore-*` styles.
- New SQL: RLS on; functions `SECURITY DEFINER SET search_path = public`. SQL verified by review + smoke (S3, blocked on user), commit-only.
- `npm run lint` + `npm test` green before every JS commit.

---

### Task 1: Migration (`supabase_social_migration.sql`)

Requires the gamification + cosmetics migrations (uses `award_xp`, `check_achievements`, `compute_metric`, `outfit_posts`, `profiles`).

- [ ] **Step 1: Write the full migration:**

```sql
-- Social migration — run in Supabase SQL editor. Safe to re-run.
-- Spec: docs/superpowers/specs/2026-07-17-profile-social-design.md

-- ── fit_likes ───────────────────────────────────────────────────────────────
create table if not exists fit_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    uuid not null references outfit_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists idx_fit_likes_post on fit_likes(post_id);
alter table fit_likes enable row level security;
do $$ begin create policy "fit_likes_select" on fit_likes for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "fit_likes_insert" on fit_likes for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin create policy "fit_likes_delete" on fit_likes for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- ── profiles.pinned_item_ids ────────────────────────────────────────────────
alter table profiles add column if not exists pinned_item_ids uuid[];

-- ── user_achievements: allow public-profile reads (showcase + feed) ──────────
drop policy if exists "user_achievements_select" on user_achievements;
create policy "user_achievements_select" on user_achievements for select using (
  auth.uid() = user_id
  or exists (select 1 from profiles p where p.id = user_achievements.user_id and p.is_public = true)
);

-- ── likes_received now counts profile + fit likes ───────────────────────────
create or replace function compute_metric(p_user uuid, p_metric text) returns int
language plpgsql security definer set search_path = public as $$
begin
  return case p_metric
    when 'items'          then (select count(*) from items where user_id = p_user and coalesce(status,'owned') <> 'wishlist')
    when 'outfits'        then (select count(*) from saved_fits where user_id = p_user)
    when 'wears'          then (select coalesce(sum(coalesce(wear_count,0)),0) from items where user_id = p_user)
    when 'wear_streak'    then coalesce((
      with days as (select distinct worn_on from wear_events where user_id = p_user),
      runs as (select worn_on, worn_on - (row_number() over (order by worn_on))::int as grp from days)
      select max(cnt)::int from (select count(*) as cnt from runs group by grp) s), 0)
    when 'likes_given'    then (select count(*) from profile_likes where user_id = p_user)
    when 'likes_received' then (
      (select count(*) from profile_likes where liked_user_id = p_user)
      + (select count(*) from fit_likes fl join outfit_posts op on op.id = fl.post_id where op.user_id = p_user))
    when 'friends'        then (select count(*) from friend_requests where status = 'accepted' and (from_user_id = p_user or to_user_id = p_user))
    when 'public_fits'    then (select count(*) from outfit_posts where user_id = p_user)
    when 'level'          then (select level_for_xp(coalesce((select total_xp from game_state where user_id = p_user), 0)))
    when 'coins_spent'    then (select coalesce((select lifetime_spent from wallets where user_id = p_user), 0))
    else 0
  end;
end $$;

-- ── fit-like XP to owner (farm-safe, once per liker) + Popular ──────────────
create or replace function trg_fit_likes_xp() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from outfit_posts where id = new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    if not exists (select 1 from xp_events where user_id = v_owner
                   and reason = 'fit_like_received' and ref_id = new.user_id) then
      perform award_xp(v_owner, 5, 'fit_like_received', new.user_id);
    end if;
    perform check_achievements(v_owner, 'likes_received');
  end if;
  return new;
end $$;
drop trigger if exists fit_likes_xp on fit_likes;
create trigger fit_likes_xp after insert on fit_likes
  for each row execute function trg_fit_likes_xp();

-- ── pins guard: ≤3, own items only ──────────────────────────────────────────
create or replace function trg_profiles_pins_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pinned_item_ids is not null then
    if coalesce(array_length(new.pinned_item_ids, 1), 0) > 3 then
      raise exception 'at most 3 pinned items'; end if;
    if exists (select 1 from unnest(new.pinned_item_ids) pid
               where not exists (select 1 from items where id = pid and user_id = new.id)) then
      raise exception 'can only pin your own items'; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_pins_guard on profiles;
create trigger profiles_pins_guard before insert or update on profiles
  for each row execute function trg_profiles_pins_guard();
```

- [ ] **Step 2: Review; commit.**

---

### Task 2: SQL smoke script (`scripts/test-social.sql`)

- [ ] **Step 1:** Txn-wrapped, ROLLBACK. Pick two users v_a (owner), v_b (liker); ensure game rows; impersonate via `set_config('request.jwt.claims', json_build_object('sub', v_b::text)::text, true)`. Create a v_a outfit_posts row. Then assert:
  1. insert fit_likes(v_b, post) → v_a total_xp +5; `compute_metric(v_a,'likes_received')` ≥ 1.
  2. delete + re-insert same (v_b,post) → no additional XP (dedup by ref_id=liker).
  3. impersonate v_a, self-like own post → no XP to v_a beyond step 1.
  4. pins: impersonate v_a; `update profiles set pinned_item_ids = array[<own item>]` ok; `= array[<4 items>]` raises; `= array[<other user's item>]` raises.
  5. `user_achievements` visible for a public profile, not for a private one (toggle `is_public`).
  End `raise notice 'SOCIAL SMOKE PASSED'; rollback;`. Never `order by created_at` (frozen now()).
- [ ] **Step 2: Commit.**

---

### Task 3: Apply + smoke — **blocked on user** (Supabase SQL editor). Leave a clear note.

---

### Task 4: Fit likes UI

**Files:** `src/components/ExplorePage.jsx` (OutfitsFeed).

- [ ] Batch-load like data with posts: after fetching `outfit_posts`, query `fit_likes` for those post ids → counts per post + set of the viewer's liked post ids. Add `{ likeCount, likedByMe }` to each enriched post.
- [ ] Add a heart button + count to each post card footer. `toggleFitLike(post)`: optimistic update; insert `{ user_id, post_id }` or delete own row. Reuse the heart SVG already used for profile likes.
- [ ] lint; commit.

---

### Task 5: Activity feed (ACTIVITY tab on FriendsPage)

**Files:** `src/components/FriendsPage.jsx` (+ small styles in `App.css`).

- [ ] Add a 4th tab `ACTIVITY`. On activate, run the merge loader:
  - friend ids from the accepted `friend_requests` already loaded.
  - parallel: `items` (in friendIds, order created_at desc, limit 20, status owned), `outfit_posts` (in friendIds, created_at desc, limit 20), `user_achievements` (in friendIds, unlocked_at not null, order unlocked_at desc, limit 20) joined to `achievement_defs` (fetch defs once).
  - normalize to `{ id, type: 'item'|'fit'|'achievement', actorId, ts, payload }`, merge, sort ts desc, slice to a page size (10) with load-more.
  - actor profiles from the existing `profileMap` (extend the profiles select to include `equipped_frame, equipped_name_effect` — already added in sub-project 2).
- [ ] Render rows in `design-people-row`-style: actor `<Avatar>`/`<Username>` + a line ("added ITEM", "posted a fit", "unlocked ACHIEVEMENT +XP"); fit rows show the fit image and a fit-like heart (reuse Task 4 toggle). Empty state.
- [ ] lint; commit.

---

### Task 6: Profile showcase enrichment

**Files:** `src/components/ExplorePage.jsx` (ProfileView), `src/components/ProfilePanel.jsx` (+ App.jsx entry), `App.css`.

- [ ] In `ProfileView`, fetch in parallel alongside items: the profile's `game_state` (total_xp), `outfit_posts` count, unlocked `user_achievements` + defs, and like totals (`profile_likes` where liked_user_id + `fit_likes` on their posts). Derive `getLevelState`.
- [ ] Header: add a level badge (`LVL n`), collection value (Σ owned prices), and coin balance **only when `profile.id === user.id`** (fetch `wallets` for self).
- [ ] Sections: pinned items (thumbnails from `pinned_item_ids`, resolve from their items), stats row (items / fits / wears / likes / friends), compact achievements grid (unlocked only, reuse `stats-ach` styles).
- [ ] Cosmetics loadout line: equipped frame + effect preview (reuse Avatar/Username).
- [ ] `ProfilePanel`: add a "VIEW PUBLIC PROFILE" button → close panel, `onViewProfile({ id: user.id, ...ownProfileRow })`. Thread through `App.jsx` (it already has `handleViewFriendProfile`).
- [ ] lint; commit.

---

### Task 7: Pin/unpin from item detail

**Files:** `src/components/ItemDetailView.jsx`, `src/App.jsx`.

- [ ] Add a `PIN`/`PINNED` toggle (owned items only) beside LOG WEAR. It reads the current user's `pinned_item_ids` (fetch once / pass from App) and writes the updated array via `profiles.upsert({ id, pinned_item_ids })`. Cap at 3 with an inline message when full; DB guard is the backstop.
- [ ] lint; commit.

---

### Task 8: Verification + Codex review

- [ ] `npm run lint` + `npm test` + `npm run build` green.
- [ ] Browser E2E (demo): render checks for feed/showcase/like button (buy/like round-trips need the migration; verify render + graceful degradation).
- [ ] Spec walk-through; note deferrals (level-up feed).
- [ ] Codex review (`~/.local/bin/codex exec --sandbox read-only`); verify + apply safe fixes; commit.
