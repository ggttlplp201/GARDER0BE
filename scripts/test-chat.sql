-- Chat/sharing/referrals smoke test — paste into Supabase SQL editor AFTER migrations.
-- Ends with `raise exception 'CHAT_SMOKE_PASSED'` so every mutation rolls back.
-- NB: same-transaction now() is frozen; never order by created_at here.
do $$
declare
  v_a uuid; v_b uuid; v_conv uuid; v_post uuid;
  v_lo uuid; v_readcol text; v_read timestamptz;
  v_xp0 int; v_xp1 int; v_coins0 int; v_coins1 int; v_ok boolean;
begin
  select id into v_a from auth.users limit 1;
  select id into v_b from auth.users where id <> v_a limit 1;
  if v_a is null or v_b is null then raise exception 'SMOKE: need two users'; end if;
  perform ensure_game_rows(v_a); perform ensure_game_rows(v_b);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);

  -- clean slate for the pair
  delete from friend_requests where (from_user_id=v_a and to_user_id=v_b) or (from_user_id=v_b and to_user_id=v_a);
  delete from conversations where user_low=least(v_a,v_b) and user_high=greatest(v_a,v_b);
  delete from xp_events where user_id=v_a and reason in ('share_fit','share_article','referral');
  delete from referrals where invitee_id=v_b;

  -- 1. not friends → rejected
  v_ok := false;
  begin perform get_or_create_conversation(v_b); exception when others then v_ok := true; end;
  assert v_ok, 'non-friend conversation was allowed';

  -- 2. friends → conversation created, idempotent
  insert into friend_requests (from_user_id, to_user_id, status) values (v_a, v_b, 'accepted');
  v_conv := get_or_create_conversation(v_b);
  assert v_conv is not null, 'conversation not created for friends';
  assert get_or_create_conversation(v_b) = v_conv, 'conversation not idempotent';

  -- 3. message insert + mark read updates the caller's column
  insert into messages (conversation_id, sender_id, type, body) values (v_conv, v_a, 'text', 'hi');
  perform mark_conversation_read(v_conv);
  v_lo := least(v_a, v_b);
  if v_a = v_lo then select low_last_read into v_read from conversations where id=v_conv;
  else select high_last_read into v_read from conversations where id=v_conv; end if;
  assert v_read is not null, 'mark_conversation_read did not set caller column';

  -- 4. share a fit → sender +10 xp / +20 coins; re-share same fit → no extra reward
  insert into outfit_posts (user_id, fit_name, image_url, slot_count, total_value)
    values (v_b, 'SMOKE FIT C', 'x', 1, 0) returning id into v_post;
  select total_xp into v_xp0 from game_state where user_id=v_a;
  select coins into v_coins0 from wallets where user_id=v_a;
  insert into messages (conversation_id, sender_id, type, payload)
    values (v_conv, v_a, 'fit', jsonb_build_object('postId', v_post));
  select total_xp, coins into v_xp1, v_coins1 from game_state g join wallets w on w.user_id=g.user_id where g.user_id=v_a;
  assert v_xp1 = v_xp0 + 10, format('expected +10 share_fit xp, got %s', v_xp1 - v_xp0);
  assert v_coins1 = v_coins0 + 20, format('expected +20 share_fit coins, got %s', v_coins1 - v_coins0);
  insert into messages (conversation_id, sender_id, type, payload)
    values (v_conv, v_a, 'fit', jsonb_build_object('postId', v_post));
  assert (select total_xp from game_state where user_id=v_a) = v_xp1, 're-share of same fit double-awarded';

  -- 5. share an article → +8 xp / +15 coins
  select total_xp into v_xp0 from game_state where user_id=v_a;
  insert into messages (conversation_id, sender_id, type, payload)
    values (v_conv, v_a, 'article', jsonb_build_object('url','https://x.test','title','T'));
  assert (select total_xp from game_state where user_id=v_a) = v_xp0 + 8, 'article share xp wrong';

  -- 6. daily cap: pad to 5 share rewards, then a further share grants nothing
  insert into xp_events (user_id, amount, reason, ref_id) values
    (v_a, 10, 'share_fit', gen_random_uuid()),
    (v_a, 10, 'share_fit', gen_random_uuid()),
    (v_a, 10, 'share_fit', gen_random_uuid());  -- now 5 total today (2 real + 3 pad)
  select total_xp into v_xp0 from game_state where user_id=v_a;
  insert into messages (conversation_id, sender_id, type, payload)
    values (v_conv, v_a, 'article', jsonb_build_object('url','https://y.test','title','T2'));
  assert (select total_xp from game_state where user_id=v_a) = v_xp0, 'daily cap not enforced';

  -- 7. referral: reward inviter once on confirm
  insert into referrals (inviter_id, invitee_id, status) values (v_a, v_b, 'pending');
  select total_xp into v_xp0 from game_state where user_id=v_a;
  select coins into v_coins0 from wallets where user_id=v_a;
  perform reward_referral(v_b);
  select total_xp, coins into v_xp1, v_coins1 from game_state g join wallets w on w.user_id=g.user_id where g.user_id=v_a;
  assert v_xp1 = v_xp0 + 50, format('expected +50 referral xp, got %s', v_xp1 - v_xp0);
  assert v_coins1 = v_coins0 + 100, format('expected +100 referral coins, got %s', v_coins1 - v_coins0);
  assert (select status from referrals where invitee_id=v_b) = 'rewarded', 'referral not marked rewarded';
  perform reward_referral(v_b);  -- second call
  assert (select total_xp from game_state where user_id=v_a) = v_xp1, 'referral rewarded twice';

  raise exception 'CHAT_SMOKE_PASSED';
end $$;
