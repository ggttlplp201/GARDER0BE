-- Chat/sharing/referrals migration — run in Supabase SQL editor. Safe to re-run.
-- Requires the gamification/cosmetics/social migrations (uses award_xp, ensure_game_rows,
-- friend_requests, outfit_posts, profiles, wallets, uniq_xp_events_dedupe).
-- Spec: docs/superpowers/specs/2026-07-18-chat-sharing-design.md

-- ── TABLES ──────────────────────────────────────────────────────────────────
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  low_last_read timestamptz,
  high_last_read timestamptz,
  created_at timestamptz not null default now(),
  unique (user_low, user_high),
  check (user_low < user_high)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text','fit','item','article')),
  body text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_messages_conv on messages(conversation_id, created_at);

create table if not exists referrals (
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','rewarded')),
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists last_active timestamptz;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table referrals     enable row level security;

do $$ begin create policy "conversations_select" on conversations for select
  using (auth.uid() in (user_low, user_high)); exception when duplicate_object then null; end $$;
do $$ begin create policy "messages_select" on messages for select using (exists (
  select 1 from conversations c where c.id = messages.conversation_id and auth.uid() in (c.user_low, c.user_high)));
  exception when duplicate_object then null; end $$;
do $$ begin create policy "messages_insert" on messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.user_low, c.user_high))
  and exists (
    select 1 from conversations c
    join friend_requests fr on fr.status = 'accepted'
      and ((fr.from_user_id = c.user_low and fr.to_user_id = c.user_high)
        or (fr.from_user_id = c.user_high and fr.to_user_id = c.user_low))
    where c.id = conversation_id));
  exception when duplicate_object then null; end $$;
do $$ begin create policy "referrals_select" on referrals for select
  using (auth.uid() in (inviter_id, invitee_id)); exception when duplicate_object then null; end $$;

-- ── CONVERSATION RPCS ───────────────────────────────────────────────────────
create or replace function get_or_create_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lo uuid; v_hi uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_other = auth.uid() then raise exception 'cannot message yourself'; end if;
  if not exists (select 1 from friend_requests where status='accepted'
      and ((from_user_id=auth.uid() and to_user_id=p_other) or (from_user_id=p_other and to_user_id=auth.uid()))) then
    raise exception 'not friends';
  end if;
  v_lo := least(auth.uid(), p_other); v_hi := greatest(auth.uid(), p_other);
  insert into conversations (user_low, user_high) values (v_lo, v_hi)
    on conflict (user_low, user_high) do nothing;
  select id into v_id from conversations where user_low=v_lo and user_high=v_hi;
  return v_id;
end $$;

create or replace function mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c conversations;
begin
  select * into c from conversations where id = p_conversation;
  if not found or auth.uid() not in (c.user_low, c.user_high) then return; end if;
  if auth.uid() = c.user_low then
    update conversations set low_last_read = now() where id = p_conversation;
  else
    update conversations set high_last_read = now() where id = p_conversation;
  end if;
end $$;

-- ── MESSAGE TRIGGER: last_message_at + share rewards ────────────────────────
create or replace function trg_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_reason text; v_xp int; v_coins int; v_today int;
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.type = 'fit' then
    v_ref := nullif(new.payload->>'postId','')::uuid;
    -- only reward for a real, existing fit post (blocks arbitrary-UUID farming)
    if v_ref is null or not exists (select 1 from outfit_posts where id = v_ref) then return new; end if;
    v_reason := 'share_fit'; v_xp := 10; v_coins := 20;
  elsif new.type = 'article' then
    v_reason := 'share_article'; v_xp := 8; v_coins := 15; v_ref := null;
  else
    return new;
  end if;
  -- serialize this sender's reward processing so the daily cap can't be raced
  perform pg_advisory_xact_lock(hashtext(new.sender_id::text)::bigint);
  select count(*) into v_today from xp_events
   where user_id = new.sender_id and reason like 'share\_%' and created_at::date = current_date;
  if v_today >= 5 then return new; end if;
  if v_reason = 'share_fit' and v_ref is not null
     and exists (select 1 from xp_events where user_id=new.sender_id and reason='share_fit' and ref_id=v_ref) then
    return new;
  end if;
  begin
    perform award_xp(new.sender_id, v_xp, v_reason, v_ref);
    update wallets set coins = coins + v_coins where user_id = new.sender_id;
  exception when unique_violation then null;
  end;
  return new;
end $$;
drop trigger if exists messages_after_insert on messages;
create trigger messages_after_insert after insert on messages
  for each row execute function trg_messages_after_insert();

drop index if exists uniq_xp_events_dedupe;
create unique index if not exists uniq_xp_events_dedupe on xp_events (user_id, reason, ref_id)
  where reason in ('item_added','friend_accepted','like_received','fit_like_received','share_fit');

-- ── REFERRALS ───────────────────────────────────────────────────────────────
create or replace function reward_referral(p_invitee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inviter uuid;
begin
  -- FOR UPDATE serializes concurrent reward attempts for the same invitee
  select inviter_id into v_inviter from referrals
   where invitee_id = p_invitee and status = 'pending' for update;
  if v_inviter is null then return; end if;
  perform ensure_game_rows(v_inviter);
  perform award_xp(v_inviter, 50, 'referral', p_invitee);
  update wallets set coins = coins + 100 where user_id = v_inviter;
  update referrals set status = 'rewarded' where invitee_id = p_invitee;
end $$;

create or replace function handle_referral_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  begin v_ref := (new.raw_user_meta_data->>'ref')::uuid; exception when others then v_ref := null; end;
  if v_ref is not null and v_ref <> new.id and exists (select 1 from auth.users where id = v_ref) then
    insert into referrals (inviter_id, invitee_id) values (v_ref, new.id) on conflict (invitee_id) do nothing;
    if new.email_confirmed_at is not null then perform reward_referral(new.id); end if;
  end if;
  return new;
end $$;
drop trigger if exists referral_signup on auth.users;
create trigger referral_signup after insert on auth.users
  for each row execute function handle_referral_signup();

create or replace function handle_referral_confirm() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform reward_referral(new.id);
  end if;
  return new;
end $$;
drop trigger if exists referral_confirm on auth.users;
create trigger referral_confirm after update on auth.users
  for each row execute function handle_referral_confirm();

-- ── LEAST-PRIVILEGE + REALTIME ──────────────────────────────────────────────
revoke execute on function trg_messages_after_insert()      from public, anon, authenticated;
revoke execute on function reward_referral(uuid)            from public, anon, authenticated;
revoke execute on function handle_referral_signup()         from public, anon, authenticated;
revoke execute on function handle_referral_confirm()        from public, anon, authenticated;
revoke execute on function get_or_create_conversation(uuid) from public, anon;
revoke execute on function mark_conversation_read(uuid)     from public, anon;
grant  execute on function get_or_create_conversation(uuid) to authenticated;
grant  execute on function mark_conversation_read(uuid)     to authenticated;

do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
