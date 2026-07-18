-- Gamification hardening — post-review fixes (2026-07-17).
-- Run in the Supabase SQL editor AFTER supabase_gamification_migration.sql.
-- Safe to re-run.

-- 1. Pin wear logging to today and to owned items.
--    worn_on was client-writable (backdated rows could farm wear XP and the
--    Daily Driver streak), and wishlist items were wearable.
drop policy if exists "wear_events_insert" on wear_events;
create policy "wear_events_insert" on wear_events for insert with check (
  auth.uid() = user_id
  and worn_on = current_date
  and exists (
    select 1 from items i
    where i.id = wear_events.item_id
      and i.user_id = auth.uid()
      and coalesce(i.status, 'owned') <> 'wishlist'
  )
);

-- 2. Unique backstop for the trigger dedupe guards: the `if not exists`
--    checks in trg_items_xp / trg_friend_accept_xp / trg_profile_likes_xp
--    are race-prone under concurrency without a constraint behind them.
create unique index if not exists uniq_xp_events_dedupe
  on xp_events (user_id, reason, ref_id)
  where reason in ('item_added', 'friend_accepted', 'like_received');
