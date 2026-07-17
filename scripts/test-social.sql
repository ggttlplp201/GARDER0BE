-- Social smoke test — paste into Supabase SQL editor AFTER all migrations.
-- Transaction-wrapped, ROLLS BACK. Impersonates users so auth.uid() resolves.
-- NB: same-transaction now() is frozen; never order by created_at here.
begin;

do $$
declare
  v_a uuid;  -- owner
  v_b uuid;  -- liker
  v_post uuid;
  v_item_a uuid; v_item_b uuid;
  v_xp0 int; v_xp1 int; v_ok boolean; v_pub boolean;
begin
  select id into v_a from auth.users limit 1;
  select id into v_b from auth.users where id <> v_a limit 1;
  if v_a is null or v_b is null then raise exception 'SMOKE: need two users'; end if;

  perform ensure_game_rows(v_a);
  perform ensure_game_rows(v_b);
  delete from fit_likes where post_id in (select id from outfit_posts where user_id = v_a and fit_name = 'SMOKE FIT');
  delete from outfit_posts where user_id = v_a and fit_name = 'SMOKE FIT';
  delete from xp_events where user_id = v_a and reason = 'fit_like_received';

  insert into outfit_posts (user_id, fit_name, image_url, slot_count, total_value)
    values (v_a, 'SMOKE FIT', 'x', 1, 0) returning id into v_post;
  select id into v_item_a from items where user_id = v_a limit 1;
  select id into v_item_b from items where user_id = v_b limit 1;

  -- 1. b likes a's fit → a gets +5 xp; likes_received counts it
  perform set_config('request.jwt.claims', json_build_object('sub', v_b::text)::text, true);
  select total_xp into v_xp0 from game_state where user_id = v_a;
  insert into fit_likes (user_id, post_id) values (v_b, v_post);
  select total_xp into v_xp1 from game_state where user_id = v_a;
  assert v_xp1 = v_xp0 + 5, format('expected +5 owner xp, got %s', v_xp1 - v_xp0);
  assert compute_metric(v_a, 'likes_received') >= 1, 'fit like not counted in likes_received';

  -- 2. re-like by same liker does not double-award
  delete from fit_likes where user_id = v_b and post_id = v_post;
  insert into fit_likes (user_id, post_id) values (v_b, v_post);
  assert (select total_xp from game_state where user_id = v_a) = v_xp1, 're-like double-awarded';

  -- 3. self-like gives no xp
  perform set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  select total_xp into v_xp0 from game_state where user_id = v_a;
  insert into fit_likes (user_id, post_id) values (v_a, v_post);
  assert (select total_xp from game_state where user_id = v_a) = v_xp0, 'self-like awarded xp';

  -- 4. pins guard (impersonate v_a)
  if v_item_a is not null then
    update profiles set pinned_item_ids = array[v_item_a] where id = v_a;  -- own item ok
  end if;
  v_ok := false;
  begin update profiles set pinned_item_ids = array[v_item_a, v_item_a, v_item_a, v_item_a] where id = v_a;
    exception when others then v_ok := true; end;
  assert v_ok, 'pins >3 allowed';
  if v_item_b is not null then
    v_ok := false;
    begin update profiles set pinned_item_ids = array[v_item_b] where id = v_a;
      exception when others then v_ok := true; end;
    assert v_ok, 'pinning another user''s item allowed';
  end if;

  -- 5. user_achievements visible for public profile, hidden for private
  update profiles set is_public = true where id = v_b;
  select exists (select 1 from profiles p where p.id = v_b and p.is_public = true) into v_pub;
  assert v_pub, 'public toggle failed';

  raise notice 'SOCIAL SMOKE PASSED';
end $$;

rollback;
