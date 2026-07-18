-- Social migration — run in Supabase SQL editor. Safe to re-run.
-- Requires supabase_gamification_migration.sql + supabase_cosmetics_migration.sql
-- (uses award_xp, check_achievements, compute_metric, level_for_xp, outfit_posts, profiles).
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
  or (unlocked_at is not null
      and exists (select 1 from profiles p where p.id = user_achievements.user_id and p.is_public = true))
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
      -- unique_violation backstop: on a concurrent double-award, the loser is
      -- caught here so the like still succeeds without a second award.
      begin
        perform award_xp(v_owner, 5, 'fit_like_received', new.user_id);
      exception when unique_violation then null;
      end;
    end if;
    perform check_achievements(v_owner, 'likes_received');
  end if;
  return new;
end $$;
drop trigger if exists fit_likes_xp on fit_likes;
create trigger fit_likes_xp after insert on fit_likes
  for each row execute function trg_fit_likes_xp();

-- Extend the xp_events dedupe backstop to cover fit-like awards (concurrency-safe).
drop index if exists uniq_xp_events_dedupe;
create unique index if not exists uniq_xp_events_dedupe
  on xp_events (user_id, reason, ref_id)
  where reason in ('item_added', 'friend_accepted', 'like_received', 'fit_like_received');

-- Bounded fit-like counts (avoids transferring every liker row to the client).
create or replace function fit_like_counts(p_ids uuid[])
returns table(post_id uuid, cnt bigint)
language sql stable security definer set search_path = public as $$
  select post_id, count(*) from fit_likes where post_id = any(p_ids) group by post_id;
$$;
grant execute on function fit_like_counts(uuid[]) to authenticated;

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
