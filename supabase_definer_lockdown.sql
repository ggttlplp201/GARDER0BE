-- Least-privilege hardening for the gamification/cosmetics/social layer.
-- Run in the Supabase SQL editor AFTER the three feature migrations. Safe to re-run.
-- Postgres grants EXECUTE to PUBLIC by default; this revokes it on internal/trigger
-- functions so they aren't reachable via /rest/v1/rpc. Triggers still fire — the
-- invoker's EXECUTE grant is not checked when a trigger runs.

-- Trigger functions — never meant to be RPC-callable.
revoke execute on function public.trg_items_xp()             from public, anon, authenticated;
revoke execute on function public.trg_wear_events_xp()       from public, anon, authenticated;
revoke execute on function public.trg_saved_fits_xp()        from public, anon, authenticated;
revoke execute on function public.trg_friend_accept_xp()     from public, anon, authenticated;
revoke execute on function public.trg_profile_likes_xp()     from public, anon, authenticated;
revoke execute on function public.trg_outfit_posts_ach()     from public, anon, authenticated;
revoke execute on function public.trg_price_drop_ach()       from public, anon, authenticated;
revoke execute on function public.trg_profiles_equip_guard() from public, anon, authenticated;
revoke execute on function public.trg_fit_likes_xp()         from public, anon, authenticated;
revoke execute on function public.trg_profiles_pins_guard()  from public, anon, authenticated;

-- Client RPCs — authenticated only (drop the implicit PUBLIC/anon grant).
revoke execute on function public.record_daily_open()        from public, anon;
revoke execute on function public.progress_quest(text)       from public, anon;
revoke execute on function public.fit_like_counts(uuid[])    from public, anon;
grant  execute on function public.record_daily_open()        to authenticated;
grant  execute on function public.progress_quest(text)       to authenticated;
grant  execute on function public.fit_like_counts(uuid[])    to authenticated;

-- Pin a stable search_path on the pure-math helpers (clears the linter warning).
alter function public.xp_to_reach(int)  set search_path = public;
alter function public.level_for_xp(int) set search_path = public;
