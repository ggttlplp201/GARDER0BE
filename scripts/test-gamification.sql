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
  -- (created_at is now(), frozen per-transaction — never order by it here;
  -- the 'smoke' reason uniquely identifies the level-up award instead)
  assert (select leveled_to from xp_events where user_id = v_user and reason = 'smoke') = 2,
         'xp_events missing leveled_to';
  assert (select coins_awarded from xp_events where user_id = v_user and reason = 'smoke') = 150,
         'xp_events missing coins_awarded';

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
