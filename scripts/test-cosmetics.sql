-- Cosmetics smoke test — paste into Supabase SQL editor AFTER both migrations.
-- Wraps everything in a transaction and ROLLS BACK: no data is kept.
-- NB: same-transaction now() is frozen; never order by created_at here.
begin;

do $$
declare
  v_user uuid;
  v_coins int; v_spent int; v_ok boolean;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then raise exception 'SMOKE: no users to test with'; end if;
  -- Impersonate the user so auth.uid() inside buy_cosmetic resolves to v_user
  -- (the SQL editor runs as postgres, where auth.uid() is otherwise null).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  -- clean slate for this user inside the txn
  delete from user_cosmetics where user_id = v_user;
  update profiles set equipped_frame = null, equipped_name_effect = null where id = v_user;
  perform ensure_game_rows(v_user);
  update game_state set total_xp = 21000 where user_id = v_user;  -- ~level 20
  update wallets set coins = 2000, lifetime_spent = 0 where user_id = v_user;

  -- 1. happy-path buy: dashed_ring (150)
  perform buy_cosmetic('dashed_ring');
  select coins, lifetime_spent into v_coins, v_spent from wallets where user_id = v_user;
  assert v_coins = 1850, format('expected 1850 coins, got %s', v_coins);
  assert v_spent = 150, format('expected 150 spent, got %s', v_spent);
  assert exists (select 1 from user_cosmetics where user_id = v_user and cosmetic_id = 'dashed_ring'),
         'dashed_ring not owned after buy';

  -- 2. double-buy rejected
  v_ok := false;
  begin perform buy_cosmetic('dashed_ring'); exception when others then v_ok := true; end;
  assert v_ok, 'double-buy was allowed';

  -- 3. free frame unbuyable
  v_ok := false;
  begin perform buy_cosmetic('thin_line'); exception when others then v_ok := true; end;
  assert v_ok, 'thin_line was buyable';

  -- 4. under-level rejected (angel_wings needs level 20)
  update game_state set total_xp = 0 where user_id = v_user;  -- level 1
  v_ok := false;
  begin perform buy_cosmetic('angel_wings'); exception when others then v_ok := true; end;
  assert v_ok, 'under-level buy was allowed';
  update game_state set total_xp = 21000 where user_id = v_user;  -- restore

  -- 5. insufficient coins rejected
  update wallets set coins = 10 where user_id = v_user;
  v_ok := false;
  begin perform buy_cosmetic('ice_crystal'); exception when others then v_ok := true; end;
  assert v_ok, 'insufficient-coins buy was allowed';
  update wallets set coins = 2000 where user_id = v_user;

  -- 6. equip guard: unowned rejected, owned ok, null ok
  v_ok := false;
  begin update profiles set equipped_frame = 'royal_crown' where id = v_user;
    exception when others then v_ok := true; end;
  assert v_ok, 'equipping unowned frame was allowed';
  update profiles set equipped_frame = 'dashed_ring' where id = v_user;  -- owned → ok
  update profiles set equipped_frame = null where id = v_user;           -- unequip → ok

  -- 7. Big Spender unlocks at 1000 lifetime spent
  update wallets set coins = 5000 where user_id = v_user;
  perform buy_cosmetic('ice_crystal');    -- 450  (total 600)
  perform buy_cosmetic('gold_laurel');    -- 800  (total 1400 ≥ 1000)
  assert (select unlocked_at from user_achievements
          where user_id = v_user and achievement_id = 'big_spender') is not null,
         'big_spender not unlocked after 1000 spent';

  raise notice 'COSMETICS SMOKE PASSED';
end $$;

rollback;
