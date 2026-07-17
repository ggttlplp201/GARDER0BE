# Game Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-authoritative XP/levels/coins engine with achievements, daily quests, streaks, toasts, level-up modal, header HUD, STATS page, and a full backfill for existing users.

**Architecture:** All economy state lives in Postgres behind SECURITY DEFINER functions; XP is granted exclusively by DB triggers on real data changes plus two idempotent session RPCs (`record_daily_open`, `progress_quest`). The client (`useGame` hook, called once in `App.jsx` and prop-drilled like the rest of the app) reads state, listens to Realtime INSERTs on `xp_events`, and renders toasts/modal/HUD in the existing design language.

**Tech Stack:** React 19 + Vite (no router, no state lib), Supabase (Postgres + RLS + Realtime), plain CSS in `App.css`, Node built-in test runner (`node --test`) for the one pure-JS module.

**Spec:** `docs/superpowers/specs/2026-07-17-game-engine-core-design.md` — read it before starting.

## Global Constraints

- Git: author is **Leon <brownguest3123@gmail.com>** only. NEVER add `Co-Authored-By: Claude` or any AI trailer to commits.
- Commit only; never push.
- No new npm dependencies.
- New UI must reuse existing conventions: `app-header-meta` mono lines, `v-screen`/`v-body` page layout, `toast-stack`/`like-toast` toasts, `modal-bg`/`modal` overlays, uppercase mono labels. No visual redesign.
- All new tables: RLS enabled, client writes denied except `wear_events` INSERT (own rows). All internal SQL functions: `SECURITY DEFINER`, `SET search_path = public`, EXECUTE revoked from `public, anon, authenticated`.
- Level curve (single source of truth, mirrored JS/SQL): cumulative XP to reach level n (n ≥ 2) = `50·n·(n+1) − 100`; level 1 = 0. Level-up coin grant per level gained = `100 + 25·newLevel`.
- The SQL migration is one file, `supabase_gamification_migration.sql`, built up in clearly-delimited sections across Tasks 2–6. SQL cannot be executed until Task 8 (apply + smoke test); Tasks 2–6 verify by careful review + commit only.
- `npm run lint` and `npm test` must pass before every commit that touches JS.

---

### Task 1: Level math module (`levels.js`) + test runner

**Files:**
- Create: `src/lib/levels.js`
- Create: `tests/levels.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `xpToReach(level) → number`, `getLevelState(totalXp) → { level, xpIntoLevel, xpForNextLevel, pct }`. Consumed by `AppHeader` (Task 11), `StatsPage` (Task 12), `LevelUpModal` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/levels.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpToReach, getLevelState } from '../src/lib/levels.js';

test('xpToReach matches the curve (parity with SQL xp_to_reach)', () => {
  assert.equal(xpToReach(1), 0);
  assert.equal(xpToReach(2), 200);   // level 1→2 costs 200
  assert.equal(xpToReach(3), 500);   // 2→3 costs 300
  assert.equal(xpToReach(4), 900);   // 3→4 costs 400
  assert.equal(xpToReach(20), 50 * 20 * 21 - 100); // 20900
});

test('getLevelState at exact boundaries', () => {
  assert.deepEqual(getLevelState(0),   { level: 1, xpIntoLevel: 0, xpForNextLevel: 200, pct: 0 });
  assert.deepEqual(getLevelState(199), { level: 1, xpIntoLevel: 199, xpForNextLevel: 200, pct: 100 });
  assert.deepEqual(getLevelState(200), { level: 2, xpIntoLevel: 0, xpForNextLevel: 300, pct: 0 });
  assert.deepEqual(getLevelState(500), { level: 3, xpIntoLevel: 0, xpForNextLevel: 400, pct: 0 });
});

test('getLevelState mid-level', () => {
  const s = getLevelState(350); // level 2 spans 200..500
  assert.equal(s.level, 2);
  assert.equal(s.xpIntoLevel, 150);
  assert.equal(s.xpForNextLevel, 300);
  assert.equal(s.pct, 50);
});
```

- [ ] **Step 2: Add test script and run to verify failure**

In `package.json` scripts, after `"lint"`:

```json
"test": "node --test tests/"
```

Run: `npm test`
Expected: FAIL — cannot find module `../src/lib/levels.js`.

- [ ] **Step 3: Implement `src/lib/levels.js`**

```js
// Level curve — MUST stay in parity with xp_to_reach / level_for_xp in
// supabase_gamification_migration.sql
export function xpToReach(level) {
  return level <= 1 ? 0 : 50 * level * (level + 1) - 100;
}

export function getLevelState(totalXp) {
  let level = 1;
  while (xpToReach(level + 1) <= totalXp) level++;
  const base = xpToReach(level);
  const span = xpToReach(level + 1) - base;
  const into = totalXp - base;
  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    pct: Math.min(100, Math.round((into / span) * 100)),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test` — Expected: all 3 tests PASS.
Run: `npm run lint` — Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/levels.js tests/levels.test.js package.json
git commit -m "feat: level curve math with parity tests"
```

---

### Task 2: Migration §1 — tables, RLS, seed, realtime

**Files:**
- Create: `supabase_gamification_migration.sql`

**Interfaces:**
- Produces: tables `game_state`, `wallets`, `xp_events`, `wear_events`, `achievement_defs` (seeded), `user_achievements`, `daily_quests`. All later SQL tasks and the client read these exact names/columns.

- [ ] **Step 1: Create the file with header + tables + RLS + seed + realtime**

```sql
-- Gamification migration — run in the Supabase SQL editor.
-- Sections: 1 tables/RLS/seed · 2 economy engine · 3 triggers · 4 quests/streaks · 5 backfill
-- Spec: docs/superpowers/specs/2026-07-17-game-engine-core-design.md

-- ── §1 TABLES ───────────────────────────────────────────────────────────────

create table if not exists game_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  total_xp     int  not null default 0,
  streak_count int  not null default 0,
  best_streak  int  not null default 0,
  last_open_date date,
  updated_at   timestamptz not null default now()
);

create table if not exists wallets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  coins          int not null default 0,
  lifetime_spent int not null default 0
);

create table if not exists xp_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        int  not null,
  reason        text not null,
  ref_id        uuid,
  leveled_to    int,
  coins_awarded int,
  created_at    timestamptz not null default now()
);
create index if not exists idx_xp_events_user on xp_events(user_id, created_at desc);

create table if not exists wear_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references items(id) on delete cascade,
  worn_on    date not null default current_date,
  created_at timestamptz not null default now(),
  unique (item_id, worn_on)
);
create index if not exists idx_wear_events_user on wear_events(user_id, worn_on desc);

create table if not exists achievement_defs (
  id          text primary key,
  name        text not null,
  description text not null,
  metric      text not null,
  goal        int  not null,
  xp          int  not null,
  sort        int  not null
);

create table if not exists user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references achievement_defs(id),
  progress       int  not null default 0,
  unlocked_at    timestamptz,
  primary key (user_id, achievement_id)
);

create table if not exists daily_quests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  quest_date   date not null,
  quest_type   text not null,
  goal         int  not null,
  progress     int  not null default 0,
  xp_reward    int  not null,
  coin_reward  int  not null,
  completed_at timestamptz,
  unique (user_id, quest_date, quest_type)
);

-- ── §1 RLS ──────────────────────────────────────────────────────────────────

alter table game_state        enable row level security;
alter table wallets           enable row level security;
alter table xp_events         enable row level security;
alter table wear_events       enable row level security;
alter table achievement_defs  enable row level security;
alter table user_achievements enable row level security;
alter table daily_quests      enable row level security;

-- game_state: own row, or public-profile rows (future profiles/leaderboards)
create policy "game_state_select" on game_state for select using (
  auth.uid() = user_id
  or exists (select 1 from profiles p where p.id = game_state.user_id and p.is_public = true)
);

create policy "wallets_select"      on wallets           for select using (auth.uid() = user_id);
create policy "xp_events_select"    on xp_events         for select using (auth.uid() = user_id);
create policy "wear_events_select"  on wear_events       for select using (auth.uid() = user_id);
create policy "wear_events_insert"  on wear_events       for insert with check (
  auth.uid() = user_id
  and exists (select 1 from items i where i.id = wear_events.item_id and i.user_id = auth.uid())
);
create policy "achievement_defs_select" on achievement_defs  for select using (true);
create policy "user_achievements_select" on user_achievements for select using (auth.uid() = user_id);
create policy "daily_quests_select" on daily_quests      for select using (auth.uid() = user_id);
-- No other write policies: mutations happen only inside SECURITY DEFINER functions.

-- ── §1 SEED ─────────────────────────────────────────────────────────────────

insert into achievement_defs (id, name, description, metric, goal, xp, sort) values
  ('first_steps',      'First Steps',      'Add your first item',            'items',          1,   50,  1),
  ('curator',          'Curator',          'Collection reaches 25 items',    'items',          25,  150, 2),
  ('archivist',        'Archivist',        'Collection reaches 100 items',   'items',          100, 400, 3),
  ('fit_check',        'Fit Check',        'Save your first outfit',         'outfits',        1,   50,  4),
  ('stylist',          'Stylist',          'Save 5 outfits',                 'outfits',        5,   150, 5),
  ('daily_driver',     'Daily Driver',     'Log wears 7 days in a row',      'wear_streak',    7,   200, 6),
  ('well_worn',        'Well Worn',        'Log 50 total wears',             'wears',          50,  250, 7),
  ('social_butterfly', 'Social Butterfly', 'Like 5 profiles',                'likes_given',    5,   75,  8),
  ('trendsetter',      'Trendsetter',      'Post 5 fits publicly',           'public_fits',    5,   150, 9),
  ('popular',          'Popular',          'Receive 25 likes',               'likes_received', 25,  300, 10),
  ('networker',        'Networker',        'Add 10 friends',                 'friends',        10,  150, 11),
  ('bargain_hunter',   'Bargain Hunter',   'Catch a wishlist price drop',    'price_drop',     1,   100, 12),
  ('big_spender',      'Big Spender',      'Spend 1,000 coins total',        'coins_spent',    1000, 100, 13),
  ('drip_lord',        'Drip Lord',        'Reach level 20',                 'level',          20,  500, 14)
on conflict (id) do nothing;

-- ── §1 REALTIME ─────────────────────────────────────────────────────────────

do $$ begin
  alter publication supabase_realtime add table public.xp_events;
exception when duplicate_object then null; end $$;
```

- [ ] **Step 2: Review against spec §2 (table/column names, RLS rules), then commit**

```bash
git add supabase_gamification_migration.sql
git commit -m "feat: gamification schema, RLS, achievement catalog"
```

---

### Task 3: Migration §2 — economy engine functions

**Files:**
- Modify: `supabase_gamification_migration.sql` (append)

**Interfaces:**
- Consumes: tables from Task 2.
- Produces (all internal, EXECUTE revoked): `xp_to_reach(int)→int`, `level_for_xp(int)→int`, `ensure_game_rows(uuid)`, `award_xp(uuid,int,text,uuid)`, `compute_metric(uuid,text)→int`, `check_achievements(uuid,text)`, `unlock_achievement(uuid,text)`, `advance_quest(uuid,text)`. Triggers (Task 4) and quests (Task 5) call these exact signatures.

- [ ] **Step 1: Append §2 to the migration file**

```sql
-- ── §2 ECONOMY ENGINE ───────────────────────────────────────────────────────

-- Cumulative XP required to reach level n. Parity: src/lib/levels.js xpToReach().
create or replace function xp_to_reach(p_level int) returns int
language sql immutable as $$
  select case when p_level <= 1 then 0 else 50 * p_level * (p_level + 1) - 100 end;
$$;

create or replace function level_for_xp(p_xp int) returns int
language plpgsql immutable as $$
declare n int := 1;
begin
  while xp_to_reach(n + 1) <= p_xp loop n := n + 1; end loop;
  return n;
end $$;

create or replace function ensure_game_rows(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into game_state (user_id) values (p_user) on conflict (user_id) do nothing;
  insert into wallets    (user_id) values (p_user) on conflict (user_id) do nothing;
end $$;

-- Central XP entry point. One xp_events row per call; carries level-up info.
create or replace function award_xp(p_user uuid, p_amount int, p_reason text, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old_xp int; v_new_xp int; v_old_level int; v_new_level int;
  v_coins int := 0; v_lvl int;
begin
  perform ensure_game_rows(p_user);
  update game_state
     set total_xp = total_xp + p_amount, updated_at = now()
   where user_id = p_user
   returning total_xp - p_amount, total_xp into v_old_xp, v_new_xp;
  v_old_level := level_for_xp(v_old_xp);
  v_new_level := level_for_xp(v_new_xp);
  if v_new_level > v_old_level then
    for v_lvl in (v_old_level + 1) .. v_new_level loop
      v_coins := v_coins + 100 + 25 * v_lvl;
    end loop;
    update wallets set coins = coins + v_coins where user_id = p_user;
  end if;
  insert into xp_events (user_id, amount, reason, ref_id, leveled_to, coins_awarded)
  values (p_user, p_amount, p_reason, p_ref,
          case when v_new_level > v_old_level then v_new_level end,
          case when v_new_level > v_old_level then v_coins end);
  if v_new_level > v_old_level then
    perform check_achievements(p_user, 'level');  -- drip_lord; recursion stops once unlocked
  end if;
end $$;

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
    when 'likes_received' then (select count(*) from profile_likes where liked_user_id = p_user)
    when 'friends'        then (select count(*) from friend_requests where status = 'accepted' and (from_user_id = p_user or to_user_id = p_user))
    when 'public_fits'    then (select count(*) from outfit_posts where user_id = p_user)
    when 'level'          then (select level_for_xp(coalesce((select total_xp from game_state where user_id = p_user), 0)))
    when 'coins_spent'    then (select coalesce((select lifetime_spent from wallets where user_id = p_user), 0))
    else 0
  end;
end $$;

-- Recomputes all achievements on p_metric; unlocks at most once, never lowers progress.
create or replace function check_achievements(p_user uuid, p_metric text) returns void
language plpgsql security definer set search_path = public as $$
declare a record; v int;
begin
  v := compute_metric(p_user, p_metric);
  for a in select * from achievement_defs where metric = p_metric loop
    insert into user_achievements (user_id, achievement_id, progress)
    values (p_user, a.id, least(v, a.goal))
    on conflict (user_id, achievement_id) do update
      set progress = greatest(user_achievements.progress, excluded.progress);
    if v >= a.goal then
      update user_achievements set unlocked_at = now(), progress = a.goal
       where user_id = p_user and achievement_id = a.id and unlocked_at is null;
      if found then
        perform award_xp(p_user, a.xp, 'achievement:' || a.id, null);
      end if;
    end if;
  end loop;
end $$;

-- Direct unlock for event-style achievements (bargain_hunter) with no countable metric.
create or replace function unlock_achievement(p_user uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare a achievement_defs;
begin
  select * into a from achievement_defs where id = p_id;
  if not found then return; end if;
  insert into user_achievements (user_id, achievement_id, progress)
  values (p_user, p_id, a.goal)
  on conflict (user_id, achievement_id) do update set progress = a.goal;
  update user_achievements set unlocked_at = now()
   where user_id = p_user and achievement_id = p_id and unlocked_at is null;
  if found then
    perform award_xp(p_user, a.xp, 'achievement:' || p_id, null);
  end if;
end $$;

-- Advances today's quest of p_type; completion pays XP (via award_xp) + coins.
create or replace function advance_quest(p_user uuid, p_type text) returns void
language plpgsql security definer set search_path = public as $$
declare q daily_quests;
begin
  update daily_quests
     set progress = least(goal, progress + 1)
   where user_id = p_user and quest_date = current_date
     and quest_type = p_type and completed_at is null
   returning * into q;
  if found and q.progress >= q.goal then
    update daily_quests set completed_at = now() where id = q.id;
    update wallets set coins = coins + q.coin_reward where user_id = p_user;
    perform award_xp(p_user, q.xp_reward, 'quest:' || p_type, q.id);
  end if;
end $$;

revoke execute on function ensure_game_rows(uuid)                 from public, anon, authenticated;
revoke execute on function award_xp(uuid,int,text,uuid)           from public, anon, authenticated;
revoke execute on function compute_metric(uuid,text)              from public, anon, authenticated;
revoke execute on function check_achievements(uuid,text)          from public, anon, authenticated;
revoke execute on function unlock_achievement(uuid,text)          from public, anon, authenticated;
revoke execute on function advance_quest(uuid,text)               from public, anon, authenticated;
```

- [ ] **Step 2: Review — verify every function referenced exists in §2, signatures match the Interfaces block, curve parity with `levels.js`. Commit**

```bash
git add supabase_gamification_migration.sql
git commit -m "feat: XP/coin economy engine functions"
```

---

### Task 4: Migration §3 — XP triggers

**Files:**
- Modify: `supabase_gamification_migration.sql` (append)

**Interfaces:**
- Consumes: `award_xp`, `advance_quest`, `check_achievements`, `unlock_achievement` (Task 3).
- Produces: triggers on `items`, `wear_events`, `saved_fits`, `friend_requests`, `profile_likes`, `outfit_posts`, `wishlist_price_history`. `xp_events.reason` values the client maps to labels: `item_added`, `wear_logged`, `outfit_saved`, `friend_accepted`, `like_received`, `daily_open`, `quest:<type>`, `achievement:<id>`, `backfill`.

- [ ] **Step 1: Append §3 to the migration file**

```sql
-- ── §3 XP TRIGGERS ──────────────────────────────────────────────────────────

-- +25 for adding an owned item (or converting wishlist→owned). Deduped per item
-- via xp_events so toggling status can't be farmed.
create or replace function trg_items_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'INSERT' and coalesce(new.status,'owned') <> 'wishlist')
     or (tg_op = 'UPDATE' and coalesce(old.status,'owned') = 'wishlist'
         and coalesce(new.status,'owned') <> 'wishlist') then
    if not exists (select 1 from xp_events
                   where user_id = new.user_id and reason = 'item_added' and ref_id = new.id) then
      perform award_xp(new.user_id, 25, 'item_added', new.id);
      perform advance_quest(new.user_id, 'add_item');
    end if;
    perform check_achievements(new.user_id, 'items');
  end if;
  return new;
end $$;
drop trigger if exists items_xp on items;
create trigger items_xp after insert or update of status on items
  for each row execute function trg_items_xp();

-- +12 per wear (unique per item/day via table constraint); maintains items.wear_count.
create or replace function trg_wear_events_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update items set wear_count = coalesce(wear_count,0) + 1 where id = new.item_id;
  perform award_xp(new.user_id, 12, 'wear_logged', new.item_id);
  perform advance_quest(new.user_id, 'log_wear');
  perform check_achievements(new.user_id, 'wears');
  perform check_achievements(new.user_id, 'wear_streak');
  return new;
end $$;
drop trigger if exists wear_events_xp on wear_events;
create trigger wear_events_xp after insert on wear_events
  for each row execute function trg_wear_events_xp();

-- +20 per saved outfit.
create or replace function trg_saved_fits_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform award_xp(new.user_id, 20, 'outfit_saved', new.id);
  perform advance_quest(new.user_id, 'save_outfit');
  perform check_achievements(new.user_id, 'outfits');
  return new;
end $$;
drop trigger if exists saved_fits_xp on saved_fits;
create trigger saved_fits_xp after insert on saved_fits
  for each row execute function trg_saved_fits_xp();

-- +15 to BOTH users on acceptance; deduped per pair so unfriend/re-friend can't farm.
create or replace function trg_friend_accept_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.status,'') <> 'accepted' and new.status = 'accepted' then
    if not exists (select 1 from xp_events where user_id = new.from_user_id
                   and reason = 'friend_accepted' and ref_id = new.to_user_id) then
      perform award_xp(new.from_user_id, 15, 'friend_accepted', new.to_user_id);
    end if;
    if not exists (select 1 from xp_events where user_id = new.to_user_id
                   and reason = 'friend_accepted' and ref_id = new.from_user_id) then
      perform award_xp(new.to_user_id, 15, 'friend_accepted', new.from_user_id);
    end if;
    perform check_achievements(new.from_user_id, 'friends');
    perform check_achievements(new.to_user_id, 'friends');
  end if;
  return new;
end $$;
drop trigger if exists friend_accept_xp on friend_requests;
create trigger friend_accept_xp after update on friend_requests
  for each row execute function trg_friend_accept_xp();

-- +5 to the liked user (deduped per liker/liked pair so unlike/re-like can't farm);
-- the liker's quest + achievement also advance.
create or replace function trg_profile_likes_xp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from xp_events where user_id = new.liked_user_id
                 and reason = 'like_received' and ref_id = new.user_id) then
    perform award_xp(new.liked_user_id, 5, 'like_received', new.user_id);
  end if;
  perform check_achievements(new.liked_user_id, 'likes_received');
  perform advance_quest(new.user_id, 'like_profile');
  perform check_achievements(new.user_id, 'likes_given');
  return new;
end $$;
drop trigger if exists profile_likes_xp on profile_likes;
create trigger profile_likes_xp after insert on profile_likes
  for each row execute function trg_profile_likes_xp();

-- Trendsetter progress on public fit posts (no XP here — share rewards are sub-project 4).
create or replace function trg_outfit_posts_ach() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform check_achievements(new.user_id, 'public_fits');
  return new;
end $$;
drop trigger if exists outfit_posts_ach on outfit_posts;
create trigger outfit_posts_ach after insert on outfit_posts
  for each row execute function trg_outfit_posts_ach();

-- Bargain Hunter: a new price observation undercutting the source's previous one.
create or replace function trg_price_drop_ach() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prev numeric; v_user uuid;
begin
  select observed_price into v_prev
    from wishlist_price_history
   where source_id = new.source_id and id <> new.id
   order by observed_at desc limit 1;
  if v_prev is not null and new.observed_price < v_prev then
    select user_id into v_user from wishlist_price_sources where id = new.source_id;
    if v_user is not null then
      perform unlock_achievement(v_user, 'bargain_hunter');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists price_drop_ach on wishlist_price_history;
create trigger price_drop_ach after insert on wishlist_price_history
  for each row execute function trg_price_drop_ach();
```

- [ ] **Step 2: Review — each spec §3 trigger present; reasons match the list in this task's Interfaces block. Commit**

```bash
git add supabase_gamification_migration.sql
git commit -m "feat: XP triggers on real data changes"
```

---

### Task 5: Migration §4 — daily quests, streaks, session RPCs

**Files:**
- Modify: `supabase_gamification_migration.sql` (append)

**Interfaces:**
- Consumes: `ensure_game_rows`, `award_xp`, `advance_quest` (Task 3).
- Produces: internal `roll_daily_quests(uuid)`, `daily_open_for(uuid)→jsonb`; **client-callable RPCs** `record_daily_open()→jsonb` returning `{ game_state, wallet, quests, was_first_open }`, and `progress_quest(p_type text)`. `useGame` (Task 9) calls `sb.rpc('record_daily_open')` and `sb.rpc('progress_quest', { p_type: 'browse_explore' })`.

- [ ] **Step 1: Append §4 to the migration file**

```sql
-- ── §4 DAILY QUESTS & STREAKS ───────────────────────────────────────────────

-- Deterministic 3-of-5 roll per user per day: stable ordering by md5(user‖date‖type).
create or replace function roll_daily_quests(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into daily_quests (user_id, quest_date, quest_type, goal, xp_reward, coin_reward)
  select p_user, current_date, t.quest_type, t.goal, t.xp_reward, t.coin_reward
    from (values
      ('log_wear',       2, 30, 10),
      ('add_item',       1, 25, 10),
      ('save_outfit',    1, 25, 10),
      ('like_profile',   1, 15,  5),
      ('browse_explore', 1, 15,  5)
    ) as t(quest_type, goal, xp_reward, coin_reward)
   order by md5(p_user::text || current_date::text || t.quest_type)
   limit 3
  on conflict (user_id, quest_date, quest_type) do nothing;
end $$;

-- Internal core so the smoke script can exercise it for an arbitrary user.
create or replace function daily_open_for(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_state game_state; v_first boolean := false;
begin
  perform ensure_game_rows(p_user);
  select * into v_state from game_state where user_id = p_user for update;
  if v_state.last_open_date is distinct from current_date then
    v_first := true;
    if v_state.last_open_date = current_date - 1 then
      update game_state
         set streak_count = streak_count + 1,
             best_streak  = greatest(best_streak, streak_count + 1),
             last_open_date = current_date, updated_at = now()
       where user_id = p_user;
    else
      update game_state
         set streak_count = 1, best_streak = greatest(best_streak, 1),
             last_open_date = current_date, updated_at = now()
       where user_id = p_user;
    end if;
    perform award_xp(p_user, 10, 'daily_open', null);
    -- 7-day login-streak milestone: +50 coins, fires once per run (streak hits exactly 7)
    if (select streak_count from game_state where user_id = p_user) = 7 then
      update wallets set coins = coins + 50 where user_id = p_user;
    end if;
    perform roll_daily_quests(p_user);
  end if;
  return jsonb_build_object(
    'game_state', (select to_jsonb(g) from game_state g where g.user_id = p_user),
    'wallet',     (select to_jsonb(w) from wallets w where w.user_id = p_user),
    'quests',     (select coalesce(jsonb_agg(to_jsonb(q) order by q.quest_type), '[]'::jsonb)
                     from daily_quests q where q.user_id = p_user and q.quest_date = current_date),
    'was_first_open', v_first);
end $$;

-- RPC: idempotent per day; first call of the day grants +10 XP, advances streak, rolls quests.
create or replace function record_daily_open() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return daily_open_for(auth.uid());
end $$;

-- RPC: only self-reportable quest type; farmable only to the quest's daily completion.
create or replace function progress_quest(p_type text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_type <> 'browse_explore' then raise exception 'quest type % is not self-reportable', p_type; end if;
  perform advance_quest(auth.uid(), p_type);
end $$;

revoke execute on function roll_daily_quests(uuid) from public, anon, authenticated;
revoke execute on function daily_open_for(uuid)    from public, anon, authenticated;
grant  execute on function record_daily_open()     to authenticated;
grant  execute on function progress_quest(text)    to authenticated;
```

- [ ] **Step 2: Review — reward ranges within spec (15–40 XP, 5–15 coins), idempotency, whitelist. Commit**

```bash
git add supabase_gamification_migration.sql
git commit -m "feat: daily quests, streaks, session RPCs"
```

---

### Task 6: Migration §5 — backfill

**Files:**
- Modify: `supabase_gamification_migration.sql` (append)

**Interfaces:**
- Consumes: `ensure_game_rows`, `award_xp`, `check_achievements` (Task 3).
- Produces: one-time idempotent backfill (guarded by `xp_events.reason='backfill'` per user).

- [ ] **Step 1: Append §5 to the migration file**

```sql
-- ── §5 BACKFILL (one-time, idempotent) ─────────────────────────────────────
-- XP for existing activity; award_xp derives level + cumulative level-up coins.
-- Achievement checks then unlock anything already earned (their XP stacks on top).

do $$
declare u record; v_xp int; m text;
begin
  for u in select id from auth.users loop
    if exists (select 1 from xp_events where user_id = u.id and reason = 'backfill') then
      continue;
    end if;
    perform ensure_game_rows(u.id);
    select coalesce((select count(*) from items
                      where user_id = u.id and coalesce(status,'owned') <> 'wishlist'), 0) * 25
         + coalesce((select sum(coalesce(wear_count,0)) from items where user_id = u.id), 0) * 12
         + coalesce((select count(*) from saved_fits where user_id = u.id), 0) * 20
         + coalesce((select count(*) from friend_requests
                      where status = 'accepted' and (from_user_id = u.id or to_user_id = u.id)), 0) * 15
         + coalesce((select count(*) from profile_likes where liked_user_id = u.id), 0) * 5
      into v_xp;
    if v_xp > 0 then
      perform award_xp(u.id, v_xp, 'backfill', null);
    else
      -- still mark as backfilled so the guard holds
      insert into xp_events (user_id, amount, reason) values (u.id, 0, 'backfill');
    end if;
    foreach m in array array['items','outfits','wears','likes_given','likes_received',
                             'friends','public_fits','level'] loop
      perform check_achievements(u.id, m);
    end loop;
    -- wear_streak intentionally skipped: no historical wear dates exist pre-ledger
  end loop;
end $$;
```

- [ ] **Step 2: Review — formula matches spec §6; guard makes re-runs no-ops. Commit**

```bash
git add supabase_gamification_migration.sql
git commit -m "feat: gamification backfill for existing users"
```

---

### Task 7: SQL smoke script

**Files:**
- Create: `scripts/test-gamification.sql`

**Interfaces:**
- Consumes: everything from Tasks 2–6. Runs as `postgres` in the Supabase SQL editor inside a transaction that always rolls back.

- [ ] **Step 1: Write the script**

```sql
-- Gamification smoke test — paste into Supabase SQL editor AFTER the migration.
-- Wraps everything in a transaction and ROLLS BACK: no data is kept.
begin;

do $$
declare
  v_user uuid;
  v_item uuid;
  v_xp int; v_xp2 int; v_coins int; v_level int;
  v_state jsonb;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then raise exception 'SMOKE: no users to test with'; end if;

  -- clean slate for this user inside the txn
  delete from daily_quests where user_id = v_user;
  delete from user_achievements where user_id = v_user;
  delete from xp_events where user_id = v_user;
  delete from wear_events where user_id = v_user;
  update game_state set total_xp = 0, streak_count = 0, best_streak = 0, last_open_date = null where user_id = v_user;
  update wallets set coins = 0, lifetime_spent = 0 where user_id = v_user;
  perform ensure_game_rows(v_user);

  -- 1. item insert → +25 and first_steps (+50) fire
  insert into items (user_id, name, status, price) values (v_user, 'SMOKE ITEM', 'owned', 0)
    returning id into v_item;
  select total_xp into v_xp from game_state where user_id = v_user;
  assert v_xp = 75, format('expected 75 xp after item+achievement, got %s', v_xp);

  -- 2. same item cannot re-award (wishlist toggle farm)
  update items set status = 'wishlist' where id = v_item;
  update items set status = 'owned' where id = v_item;
  select total_xp into v_xp2 from game_state where user_id = v_user;
  assert v_xp2 = v_xp, format('item toggle farmed xp: %s -> %s', v_xp, v_xp2);

  -- 3. wear event → +12, wear_count bumped; same-day duplicate rejected
  insert into wear_events (user_id, item_id) values (v_user, v_item);
  select total_xp into v_xp2 from game_state where user_id = v_user;
  assert v_xp2 = v_xp + 12, format('expected +12 wear xp, got %s', v_xp2 - v_xp);
  assert (select wear_count from items where id = v_item) = 1, 'wear_count not incremented';
  begin
    insert into wear_events (user_id, item_id) values (v_user, v_item);
    raise exception 'SMOKE: duplicate same-day wear was allowed';
  exception when unique_violation then null;
  end;

  -- 4. level-up grants coins: push to exactly level 2 (200 xp boundary)
  select total_xp into v_xp from game_state where user_id = v_user;
  perform award_xp(v_user, 200 - v_xp + 1, 'smoke', null);
  select coins into v_coins from wallets where user_id = v_user;
  select level_for_xp(total_xp) into v_level from game_state where user_id = v_user;
  assert v_level = 2, format('expected level 2, got %s', v_level);
  assert v_coins = 150, format('expected 150 coins (100+25*2), got %s', v_coins);
  assert (select leveled_to from xp_events where user_id = v_user order by created_at desc limit 1) = 2,
         'xp_events missing leveled_to';

  -- 5. daily open: first call awards +10 and rolls exactly 3 quests; second call is a no-op
  select total_xp into v_xp from game_state where user_id = v_user;
  v_state := daily_open_for(v_user);
  assert (v_state->>'was_first_open')::boolean, 'first open not detected';
  assert (select total_xp from game_state where user_id = v_user) = v_xp + 10, 'daily open xp wrong';
  assert (select count(*) from daily_quests where user_id = v_user and quest_date = current_date) = 3,
         'expected 3 quests';
  v_state := daily_open_for(v_user);
  assert not (v_state->>'was_first_open')::boolean, 'second open re-awarded';

  -- 6. streak continuation & reset
  update game_state set last_open_date = current_date - 1, streak_count = 3 where user_id = v_user;
  perform daily_open_for(v_user);
  assert (select streak_count from game_state where user_id = v_user) = 4, 'streak did not continue';
  update game_state set last_open_date = current_date - 2, streak_count = 9 where user_id = v_user;
  perform daily_open_for(v_user);
  assert (select streak_count from game_state where user_id = v_user) = 1, 'streak did not reset';

  -- 7. quest completion pays out (force a log_wear quest and complete it)
  delete from daily_quests where user_id = v_user;
  insert into daily_quests (user_id, quest_date, quest_type, goal, progress, xp_reward, coin_reward)
  values (v_user, current_date, 'log_wear', 1, 0, 30, 10);
  select total_xp into v_xp from game_state where user_id = v_user;
  select coins into v_coins from wallets where user_id = v_user;
  perform advance_quest(v_user, 'log_wear');
  assert (select completed_at from daily_quests where user_id = v_user and quest_type = 'log_wear') is not null,
         'quest not completed';
  assert (select total_xp from game_state where user_id = v_user) = v_xp + 30, 'quest xp wrong';
  assert (select coins from wallets where user_id = v_user) = v_coins + 10, 'quest coins wrong';

  -- 8. achievement unlocks exactly once
  select total_xp into v_xp from game_state where user_id = v_user;
  perform check_achievements(v_user, 'items');
  assert (select total_xp from game_state where user_id = v_user) = v_xp, 'achievement re-awarded';

  raise notice 'SMOKE TEST PASSED';
end $$;

rollback;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/test-gamification.sql
git commit -m "test: gamification SQL smoke script"
```

---

### Task 8: Apply migration + run smoke test

**Files:** none (database operation)

- [ ] **Step 1: Apply `supabase_gamification_migration.sql` to the project's Supabase instance**

Preferred: use the Supabase MCP tools (load via ToolSearch; authenticate if needed; invoke the `supabase:supabase` skill for guidance) to execute the migration SQL. If MCP access is unavailable, STOP and ask Leon to paste `supabase_gamification_migration.sql` into the Supabase SQL editor and report the result.

Expected: success, no errors. (Re-running is safe: `create table if not exists`, `create or replace`, seeded `on conflict do nothing`, guarded backfill.)

- [ ] **Step 2: Run `scripts/test-gamification.sql` the same way**

Expected output: notice `SMOKE TEST PASSED`, then rollback. If any assert fires, fix the migration section it points at, re-apply, re-run — do not proceed to client tasks with a failing smoke test.

- [ ] **Step 3: Verify RLS from the client's perspective**

Run as a quick check (SQL editor):

```sql
select count(*) from pg_policies
 where tablename in ('game_state','wallets','xp_events','wear_events',
                     'achievement_defs','user_achievements','daily_quests');
```

Expected: 9 policies (7 selects + wear_events insert + game_state public select are the same 9 rows created in §1).

---

### Task 9: `useGame` hook

**Files:**
- Create: `src/hooks/useGame.js`

**Interfaces:**
- Consumes: `sb` from `src/lib/supabase.js`; RPCs `record_daily_open` / `progress_quest`; Realtime on `xp_events`.
- Produces: `useGame(user)` → `{ gameState, wallet, quests, achievements, defs, notifications, shiftNotification, levelUp, clearLevelUp, refresh }`. Consumed by `App.jsx` (Task 10), which prop-drills to `AppHeader`, `StatsPage`, `GameToasts`, `LevelUpModal`.
  - `gameState`: `{ user_id, total_xp, streak_count, best_streak, last_open_date }` or `null`
  - `wallet`: `{ coins, lifetime_spent }` or `null`
  - `quests`: array of `daily_quests` rows for today
  - `defs`: `achievement_defs` rows ordered by `sort`; `achievements`: map `{ [achievement_id]: { progress, unlocked_at } }`
  - `notifications`: FIFO array of `xp_events` rows; `shiftNotification()` removes the head
  - `levelUp`: the latest `xp_events` row with `leveled_to`, or `null`; `clearLevelUp()` resets it

- [ ] **Step 1: Implement the hook**

```js
import { useState, useEffect, useCallback } from 'react';
import { sb } from '../lib/supabase';

export function useGame(user) {
  const [gameState, setGameState]         = useState(null);
  const [wallet, setWallet]               = useState(null);
  const [quests, setQuests]               = useState([]);
  const [defs, setDefs]                   = useState([]);
  const [achievements, setAchievements]   = useState({});
  const [notifications, setNotifications] = useState([]);
  const [levelUp, setLevelUp]             = useState(null);

  const loadAchievements = useCallback(async () => {
    if (!user) return;
    const [{ data: ad }, { data: ua }] = await Promise.all([
      sb.from('achievement_defs').select('*').order('sort'),
      sb.from('user_achievements').select('*').eq('user_id', user.id),
    ]);
    setDefs(ad || []);
    const map = {};
    (ua || []).forEach(r => { map[r.achievement_id] = r; });
    setAchievements(map);
  }, [user]);

  // Light refresh: state + wallet + today's quests (no daily-open side effects)
  const refresh = useCallback(async () => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: gs }, { data: w }, { data: q }] = await Promise.all([
      sb.from('game_state').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('wallets').select('*').eq('user_id', user.id).maybeSingle(),
      sb.from('daily_quests').select('*').eq('user_id', user.id).eq('quest_date', today).order('quest_type'),
    ]);
    if (gs) setGameState(gs);
    if (w) setWallet(w);
    setQuests(q || []);
  }, [user]);

  // Session start: daily open (idempotent) returns full state in one round trip
  useEffect(() => {
    if (!user) {
      setGameState(null); setWallet(null); setQuests([]);
      setNotifications([]); setLevelUp(null);
      return;
    }
    sb.rpc('record_daily_open').then(({ data, error }) => {
      if (error) { console.error(error); refresh(); return; }
      setGameState(data.game_state);
      setWallet(data.wallet);
      setQuests(data.quests || []);
    });
    loadAchievements();
  }, [user, refresh, loadAchievements]);

  // Realtime: every XP event drives toasts, level-up modal, and a state refresh
  useEffect(() => {
    if (!user) return;
    const ch = sb.channel('xp-events-' + user.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'xp_events', filter: `user_id=eq.${user.id}` },
        payload => {
          const ev = payload.new;
          if (ev.reason === 'backfill') return;
          setNotifications(q => [...q, ev]);
          if (ev.leveled_to) setLevelUp(ev);
          refresh();
          if (ev.reason.startsWith('achievement:')) loadAchievements();
        })
      .subscribe();
    return () => sb.removeChannel(ch);
  }, [user, refresh, loadAchievements]);

  const shiftNotification = useCallback(() => setNotifications(q => q.slice(1)), []);
  const clearLevelUp = useCallback(() => setLevelUp(null), []);

  return { gameState, wallet, quests, achievements, defs, notifications, shiftNotification, levelUp, clearLevelUp, refresh };
}
```

- [ ] **Step 2: Lint and commit**

Run: `npm run lint` — Expected: clean.

```bash
git add src/hooks/useGame.js
git commit -m "feat: useGame hook — state, realtime XP events, notification queue"
```

---

### Task 10: GameToasts + LevelUpModal + App wiring

**Files:**
- Create: `src/components/GameToasts.jsx`
- Create: `src/components/LevelUpModal.jsx`
- Modify: `src/App.jsx` (import + call `useGame`, render both components)
- Modify: `src/App.css` (append toast/modal styles)

**Interfaces:**
- Consumes: `useGame` return values (Task 9), `getLevelState` (Task 1), CSS classes `toast-stack`, `like-toast`, `modal-bg`, `modal`, `modal-actions`.
- Produces: `<GameToasts queue shift defs />`, `<LevelUpModal event onClose />`.

- [ ] **Step 1: Create `src/components/GameToasts.jsx`**

```jsx
import { useEffect } from 'react';

const REASON_LABELS = {
  wear_logged: 'WEAR LOGGED', item_added: 'ITEM ADDED', outfit_saved: 'OUTFIT SAVED',
  daily_open: 'DAILY CHECK-IN', friend_accepted: 'FRIEND ADDED', like_received: 'LIKE RECEIVED',
};
const QUEST_LABELS = {
  log_wear: 'LOG A WEAR', add_item: 'ADD AN ITEM', save_outfit: 'SAVE AN OUTFIT',
  like_profile: 'LIKE A PROFILE', browse_explore: 'BROWSE EXPLORE',
};

function label(ev, defs) {
  if (ev.reason.startsWith('achievement:')) {
    const def = defs.find(d => d.id === ev.reason.slice('achievement:'.length));
    return `ACHIEVEMENT — ${(def?.name || 'UNLOCKED').toUpperCase()}`;
  }
  if (ev.reason.startsWith('quest:')) {
    return `QUEST COMPLETE — ${QUEST_LABELS[ev.reason.slice('quest:'.length)] || 'DONE'}`;
  }
  return REASON_LABELS[ev.reason] || ev.reason.replace(/_/g, ' ').toUpperCase();
}

// Drains the FIFO queue one toast at a time so stacked rewards read cleanly.
export default function GameToasts({ queue, shift, defs }) {
  const current = queue[0] || null;
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(shift, 2600);
    return () => clearTimeout(t);
  }, [current, shift]);
  if (!current) return null;
  const isAchievement = current.reason.startsWith('achievement:');
  return (
    <div className="toast-stack game-toast-stack">
      <div className="like-toast game-toast" onClick={shift}>
        <span className="game-toast-xp">+{current.amount} XP</span>
        <span className={`game-toast-label${isAchievement ? ' achievement' : ''}`}>
          {label(current, defs)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/LevelUpModal.jsx`**

```jsx
export default function LevelUpModal({ event, onClose }) {
  if (!event) return null;
  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal levelup-modal" onClick={e => e.stopPropagation()}>
        <div className="levelup-kicker">LEVEL UP</div>
        <div className="levelup-level">LVL {event.leveled_to}</div>
        <div className="levelup-coins">+{event.coins_awarded} COINS</div>
        <div className="modal-actions">
          <button onClick={onClose}>NICE</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Append styles to `src/App.css`**

```css
/* ── Gamification toasts & level-up modal ─────────────────────────────── */
.game-toast { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.game-toast-xp { font-weight: bold; font-size: 12px; letter-spacing: 0.04em; flex-shrink: 0; }
.game-toast-label { font-size: 11px; letter-spacing: 0.06em; color: var(--text2); }
.game-toast-label.achievement { color: var(--text); font-weight: bold; }
.levelup-modal { text-align: center; }
.levelup-kicker { font-size: 10px; letter-spacing: 0.2em; color: var(--text3); }
.levelup-level { font-size: 2.4rem; font-weight: bold; margin: 10px 0 4px; }
.levelup-coins { font-size: 13px; letter-spacing: 0.08em; color: var(--text2); margin-bottom: 8px; }
```

- [ ] **Step 4: Wire into `src/App.jsx`**

Add imports next to the other component imports:

```js
import { useGame } from './hooks/useGame';
import GameToasts from './components/GameToasts';
import LevelUpModal from './components/LevelUpModal';
```

Inside `App()`, right after the `useItems` line:

```js
const game = useGame(user);
```

At the bottom of the returned JSX, next to `<NotifToast …/>`:

```jsx
<GameToasts queue={game.notifications} shift={game.shiftNotification} defs={game.defs} />
<LevelUpModal event={game.levelUp} onClose={game.clearLevelUp} />
```

- [ ] **Step 5: Verify in the running app**

Run: `npm run lint` (clean) and `npm run dev`. Log in; the daily-open RPC fires — first open of the day shows a `+10 XP · DAILY CHECK-IN` toast (arriving via Realtime). No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/GameToasts.jsx src/components/LevelUpModal.jsx src/App.jsx src/App.css
git commit -m "feat: XP toasts and level-up modal wired to realtime XP events"
```

---

### Task 11: Header HUD

**Files:**
- Modify: `src/components/AppHeader.jsx`
- Modify: `src/App.jsx` (pass props)
- Modify: `src/App.css` (append)

**Interfaces:**
- Consumes: `game.gameState`, `game.wallet` (Task 9), `getLevelState` (Task 1).
- Produces: a fourth `app-header-meta` line + 2px XP bar. No layout changes.

- [ ] **Step 1: Update `AppHeader.jsx`**

Add to imports: `import { getLevelState } from '../lib/levels';`

Change the signature to accept the new props:

```js
export default function AppHeader({ onDark, avatarUrl, location, userName, onProfileOpen, onViewProfile, gameState, wallet }) {
```

Inside the component, before `return`:

```js
const lvl = gameState ? getLevelState(gameState.total_xp) : null;
```

In the JSX, inside `<div className="app-header-meta">`, after the date/time line:

```jsx
{lvl && (
  <div className="app-header-lvl">
    LVL {lvl.level} · {lvl.xpIntoLevel}/{lvl.xpForNextLevel} XP{wallet ? ` · ${wallet.coins.toLocaleString()} ¢` : ''}
  </div>
)}
```

Immediately after the closing `</div>` of `app-header-meta` (still inside `app-header-right`), add the bar:

```jsx
{lvl && (
  <div className="app-xp-bar" aria-label={`Level ${lvl.level} progress`}>
    <div className="app-xp-fill" style={{ width: `${lvl.pct}%` }} />
  </div>
)}
```

Note: `app-header-right` is a flex row of meta/globe/controls — wrap the meta block and bar together so the bar sits under the text:

```jsx
<div className="app-header-meta-col">
  <div className="app-header-meta">…existing lines + new lvl line…</div>
  {lvl && <div className="app-xp-bar">…</div>}
</div>
```

(Replace the bare `app-header-meta` div with this wrapper; keep everything else identical.)

- [ ] **Step 2: Append styles to `src/App.css`**

```css
/* ── Header XP HUD ────────────────────────────────────────────────────── */
.app-header-meta-col { display: flex; flex-direction: column; gap: 4px; }
.app-header-lvl { white-space: nowrap; }
.app-xp-bar { height: 2px; background: var(--border-light); width: 100%; }
.app-xp-fill { height: 100%; background: var(--text); transition: width 0.4s ease; }
```

- [ ] **Step 3: Pass props in `App.jsx`**

```jsx
<AppHeader
  …existing props…
  gameState={game.gameState}
  wallet={game.wallet}
/>
```

- [ ] **Step 4: Verify visually**

`npm run dev` → header shows e.g. `LVL 3 · 120/400 XP · 850 ¢` with a hairline bar; dark mode still fine; mobile width doesn't overflow (the line is inside the existing meta block which already handles small screens). `npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppHeader.jsx src/App.jsx src/App.css
git commit -m "feat: header level/XP/coins HUD"
```

---

### Task 12: STATS page + nav tab

**Files:**
- Create: `src/components/StatsPage.jsx`
- Modify: `src/components/AppNav.jsx` (7th tab)
- Modify: `src/App.jsx` (route)
- Modify: `src/App.css` (append)

**Interfaces:**
- Consumes: `game` object (Task 9), `getLevelState` (Task 1), layout classes `v-screen`, `v-screen-header`, `v-screen-title`, `v-screen-sub`, `v-body`, `v-empty`.
- Produces: page key `'stats'`.

- [ ] **Step 1: Create `src/components/StatsPage.jsx`**

```jsx
import { getLevelState } from '../lib/levels';

const QUEST_LABELS = {
  log_wear: 'LOG A WEAR', add_item: 'ADD AN ITEM', save_outfit: 'SAVE AN OUTFIT',
  like_profile: 'LIKE A PROFILE', browse_explore: 'BROWSE EXPLORE',
};

function Bar({ pct }) {
  return (
    <div className="stats-bar"><div className="stats-bar-fill" style={{ width: `${pct}%` }} /></div>
  );
}

export default function StatsPage({ game }) {
  const { gameState, wallet, quests, defs, achievements } = game;
  const lvl = gameState ? getLevelState(gameState.total_xp) : null;

  return (
    <div className="v-screen">
      <div className="v-screen-header">
        <div>
          <div className="v-screen-title">STATS</div>
          <div className="v-screen-sub">
            {lvl ? `LEVEL ${lvl.level} · ${gameState.total_xp.toLocaleString()} XP · ${(wallet?.coins ?? 0).toLocaleString()} ¢` : 'LOADING…'}
          </div>
        </div>
      </div>

      <div className="v-body" style={{ padding: '0 36px 24px' }}>
        <div className="friends-section-label">TODAY'S QUESTS</div>
        {quests.length === 0 && <div className="v-empty">No quests rolled yet — check back after your first open today.</div>}
        {quests.map(q => (
          <div key={q.id} className="stats-quest-row">
            <div className="stats-quest-info">
              <div className="stats-quest-name">
                {QUEST_LABELS[q.quest_type] || q.quest_type.toUpperCase()}
                {q.completed_at && ' ✓'}
              </div>
              <Bar pct={Math.round((q.progress / q.goal) * 100)} />
            </div>
            <div className="stats-quest-reward">
              {q.progress}/{q.goal} · +{q.xp_reward} XP · +{q.coin_reward} ¢
            </div>
          </div>
        ))}

        <div className="friends-section-label" style={{ marginTop: 24 }}>STREAK</div>
        <div className="stats-streak">
          {gameState ? `${gameState.streak_count} DAY${gameState.streak_count === 1 ? '' : 'S'} · BEST ${gameState.best_streak}` : '—'}
        </div>

        <div className="friends-section-label" style={{ marginTop: 24 }}>ACHIEVEMENTS</div>
        <div className="stats-ach-grid">
          {defs.map(d => {
            const ua = achievements[d.id];
            const unlocked = !!ua?.unlocked_at;
            const progress = ua?.progress ?? 0;
            return (
              <div key={d.id} className={`stats-ach${unlocked ? ' unlocked' : ''}`}>
                <div className="stats-ach-name">{d.name.toUpperCase()}</div>
                <div className="stats-ach-desc">{d.description}</div>
                {unlocked
                  ? <div className="stats-ach-meta">
                      {new Date(ua.unlocked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()} · +{d.xp} XP
                    </div>
                  : <>
                      <Bar pct={Math.round((progress / d.goal) * 100)} />
                      <div className="stats-ach-meta">{progress}/{d.goal} · +{d.xp} XP</div>
                    </>
                }
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append styles to `src/App.css`**

```css
/* ── Stats page ───────────────────────────────────────────────────────── */
.stats-quest-row { display: flex; align-items: center; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border-light); }
.stats-quest-info { flex: 1; min-width: 0; }
.stats-quest-name { font-size: 12px; font-weight: bold; letter-spacing: 0.06em; margin-bottom: 6px; }
.stats-quest-reward { font-size: 11px; color: var(--text2); letter-spacing: 0.04em; white-space: nowrap; }
.stats-bar { height: 3px; background: var(--border-light); width: 100%; }
.stats-bar-fill { height: 100%; background: var(--text); transition: width 0.3s ease; }
.stats-streak { font-size: 13px; font-weight: bold; letter-spacing: 0.08em; padding: 8px 0; }
.stats-ach-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.stats-ach { border: 1px solid var(--border-light); padding: 14px; opacity: 0.55; }
.stats-ach.unlocked { opacity: 1; border-color: var(--border); }
.stats-ach-name { font-size: 12px; font-weight: bold; letter-spacing: 0.08em; margin-bottom: 4px; }
.stats-ach-desc { font-size: 11px; color: var(--text2); margin-bottom: 8px; }
.stats-ach-meta { font-size: 10px; color: var(--text3); letter-spacing: 0.05em; margin-top: 6px; }
```

- [ ] **Step 3: Add the nav tab in `AppNav.jsx`**

Append to `NAV_ITEMS` after the `friends` entry:

```js
{
  k: 'stats', label: 'STATS',
  icon: (
    <Icon>
      <line x1="6" y1="20" x2="6" y2="12" />
      <line x1="12" y1="20" x2="12" y2="6" />
      <line x1="18" y1="20" x2="18" y2="14" />
    </Icon>
  ),
},
```

- [ ] **Step 4: Route it in `App.jsx`**

Import `StatsPage` with the other components, then inside `app-main` after the friends page block:

```jsx
{page === 'stats' && <StatsPage game={game} />}
```

- [ ] **Step 5: Verify visually**

`npm run dev` → STATS tab appears; quests show with progress bars; achievements grid shows locked (greyed, progress) vs unlocked. `npm run lint` clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatsPage.jsx src/components/AppNav.jsx src/App.jsx src/App.css
git commit -m "feat: stats page with quests, streak, achievements"
```

---

### Task 13: Wear ledger client + browse-Explore quest

**Files:**
- Modify: `src/hooks/useItems.js:102-108` (`logWear`)
- Modify: `src/components/ExplorePage.jsx` (report browse quest once per visit)

**Interfaces:**
- Consumes: `wear_events` table + RLS insert policy (Task 2), `progress_quest` RPC (Task 5).
- Produces: `logWear(id)` now inserts a `wear_events` row (DB trigger maintains `wear_count` + XP); same-day duplicates revert the optimistic bump silently.

- [ ] **Step 1: Replace `logWear` in `src/hooks/useItems.js`**

```js
  async function logWear(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const next = (item.wear_count || 0) + 1;
    setItems(prev => prev.map(i => i.id === id ? { ...i, wear_count: next } : i));
    // The wear_events trigger increments items.wear_count and awards XP.
    const { error } = await sb.from('wear_events').insert({ user_id: user.id, item_id: id });
    if (error) {
      // 23505 = already logged today (one wear per item per day)
      setItems(prev => prev.map(i => i.id === id ? { ...i, wear_count: item.wear_count || 0 } : i));
      if (error.code !== '23505') console.error(error);
    }
  }
```

- [ ] **Step 2: Report the browse-Explore quest in `ExplorePage.jsx`**

In the default `ExplorePage` component (`src/components/ExplorePage.jsx:541`), add an effect near the top of the component (once per mount, fire-and-forget):

```js
useEffect(() => {
  if (!user) return;
  sb.rpc('progress_quest', { p_type: 'browse_explore' }).then(({ error }) => {
    if (error && !/not self-reportable/.test(error.message)) console.error(error);
  });
}, [user]);
```

(`useEffect` is already imported in the file; `sb` too.)

- [ ] **Step 3: Verify in the running app**

`npm run dev` → log a wear from item detail: `+12 XP · WEAR LOGGED` toast, wear count bumps once; logging again the same day silently keeps the count. Open Explore: browse quest progresses on STATS. `npm run lint` clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useItems.js src/components/ExplorePage.jsx
git commit -m "feat: wear ledger logging and browse-explore quest reporting"
```

---

### Task 14: Final verification pass

**Files:** none

- [ ] **Step 1: Automated checks**

Run: `npm run lint` and `npm test` — both clean/passing.

- [ ] **Step 2: Manual E2E (dev server, real Supabase)**

1. Fresh login → first open of day: `+10 XP · DAILY CHECK-IN` toast; STATS shows 3 quests + streak.
2. Add an owned item → `+25 XP · ITEM ADDED` toast; if it's the account's first, `ACHIEVEMENT — FIRST STEPS` follows; header XP bar advances.
3. Log a wear → `+12 XP`; log again same item same day → no toast, count unchanged after refresh.
4. Save an outfit in OUTFITS → `+20 XP`.
5. Complete a rolled quest → `QUEST COMPLETE` toast; STATS marks it ✓; coins increase in header.
6. If near a level boundary (or by adding items), cross it → level-up modal with coin grant; header LVL increments.
7. Verify a second account's likes/friend-accepts still work and award XP to the right users.
8. Backfilled account: header shows a non-trivial level immediately; STATS achievements reflect history; no toast flood on login.

- [ ] **Step 3: Spec walk-through**

Re-read `docs/superpowers/specs/2026-07-17-game-engine-core-design.md` section by section and confirm each requirement is implemented (per the Spec-Driven Phase Workflow). Note any gaps and fix before declaring done.

- [ ] **Step 4: Codex review**

This is multi-file logic touching data/auth — run a Codex review of the full diff per the Codex Review Policy, verify findings against the code, apply only clearly-correct safe fixes, surface risky ones.
