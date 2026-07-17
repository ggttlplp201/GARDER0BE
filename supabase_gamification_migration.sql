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
create policy "achievement_defs_select"  on achievement_defs  for select using (true);
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
