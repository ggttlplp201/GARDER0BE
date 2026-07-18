# Chat, Sharing & Referrals — Implementation Plan

> Execute task-by-task; checkbox steps. Spec: `docs/superpowers/specs/2026-07-18-chat-sharing-design.md`.

**Goal:** 1:1 chat with shared fit/item/article cards, presence, unread; share-to-chat rewards; invite-link referrals.

**Architecture:** `conversations`/`messages`/`referrals` tables; friends-only chat via `get_or_create_conversation` RPC; Realtime delivery gated by RLS; share + referral rewards through Postgres triggers reusing the gamification economy. Client: `useChat` hook, a CHAT nav tab with list/thread/composer, share pickers, invite links, and a `last_active` presence heartbeat.

**Tech Stack:** React 19 + Vite, Supabase (Postgres/RLS/RPC/Realtime), plain CSS, `node --test`. Migration applied to prod via the Supabase connector.

## Global Constraints
- Git author **Leon <brownguest3123@gmail.com>** only; no AI trailers. Commit, never push.
- No new npm deps. Reuse `v-screen`/`design-people-*`/`modal`/shared `Avatar`/`Username`.
- New SQL: RLS on; functions `SECURITY DEFINER SET search_path = public`; least-privilege grants (revoke default PUBLIC on triggers; grant `authenticated` on client RPCs).
- `npm run lint` + `npm test` green before every JS commit.

---

### Task 1: Migration (`supabase_chat_migration.sql`)

Requires gamification/cosmetics/social migrations (uses `award_xp`, `ensure_game_rows`, `check_achievements`, `friend_requests`, `outfit_posts`, `profiles`, `wallets`, `uniq_xp_events_dedupe`).

- [ ] **Step 1: Write the migration** — tables + RLS + `profiles.last_active`:

```sql
-- Chat/sharing/referrals migration — run in Supabase SQL editor. Safe to re-run.
-- Spec: docs/superpowers/specs/2026-07-18-chat-sharing-design.md

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
```

- [ ] **Step 2: Append functions/triggers:**

```sql
-- Friends-only conversation resolver
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

-- last_message_at bump + share rewards (fit/article) to the sender
create or replace function trg_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_reason text; v_xp int; v_coins int; v_today int;
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.type = 'fit' then
    v_reason := 'share_fit'; v_xp := 10; v_coins := 20;
    v_ref := nullif(new.payload->>'postId','')::uuid;
  elsif new.type = 'article' then
    v_reason := 'share_article'; v_xp := 8; v_coins := 15; v_ref := null;
  else
    return new;
  end if;
  -- daily cap: at most 5 share rewards/day
  select count(*) into v_today from xp_events
   where user_id = new.sender_id and reason like 'share\_%' and created_at::date = current_date;
  if v_today >= 5 then return new; end if;
  -- fit dedupe by ref; article relies on the daily cap
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

-- extend dedupe backstop for fit shares
drop index if exists uniq_xp_events_dedupe;
create unique index if not exists uniq_xp_events_dedupe on xp_events (user_id, reason, ref_id)
  where reason in ('item_added','friend_accepted','like_received','fit_like_received','share_fit');

-- Referral: reward the inviter (once) when the invitee is confirmed
create or replace function reward_referral(p_invitee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_inviter uuid;
begin
  select inviter_id into v_inviter from referrals where invitee_id = p_invitee and status = 'pending';
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

-- least-privilege
revoke execute on function trg_messages_after_insert()   from public, anon, authenticated;
revoke execute on function reward_referral(uuid)          from public, anon, authenticated;
revoke execute on function handle_referral_signup()       from public, anon, authenticated;
revoke execute on function handle_referral_confirm()      from public, anon, authenticated;
grant  execute on function get_or_create_conversation(uuid) to authenticated;
grant  execute on function mark_conversation_read(uuid)     to authenticated;
revoke execute on function get_or_create_conversation(uuid) from public, anon;
revoke execute on function mark_conversation_read(uuid)     from public, anon;

do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
```

- [ ] **Step 3: Review; commit.**

---

### Task 2: SQL smoke (`scripts/test-chat.sql`)

- [ ] Txn-free DO block ending in `raise exception 'CHAT_SMOKE_PASSED'` (so prod mutations roll back). Two users v_a, v_b; make them friends (insert accepted friend_requests if absent — capture whether inserted so the assertions hold). Assert:
  1. non-friends: `get_or_create_conversation` raises when no friendship (temporarily test with a third/removed friendship) — or assert it succeeds for friends and returns a stable id on second call.
  2. impersonate v_a; `get_or_create_conversation(v_b)` → id; insert a text message; `mark_conversation_read` sets `low`/`high_last_read` for v_a.
  3. share fit: insert message type 'fit' payload `{postId: <v_b's outfit_post>}` from v_a → v_a xp +10, coins +20; re-insert same fit → no extra reward (dedupe).
  4. share article: type 'article' → +8 xp / +15 coins.
  5. daily cap: after 5 share rewards, the 6th grants nothing.
  6. referral: `insert into referrals(v_a as inviter, v_b as invitee,'pending')`; `perform reward_referral(v_b)` → v_a +50 xp / +100 coins, referral status 'rewarded'; second call no-op.
  Impersonate via `set_config('request.jwt.claims', json_build_object('sub', <uuid>)::text, true)`. Never `order by created_at`.
- [ ] Commit.

---

### Task 3: Apply migration + smoke + advisor (via Supabase connector)

- [ ] Apply `supabase_chat_migration.sql` with `apply_migration` (project `xvqgrxoccucycagzizae`).
- [ ] Run the smoke DO block via `execute_sql` (terminal `raise exception` guarantees rollback); expect `CHAT_SMOKE_PASSED`.
- [ ] Run `get_advisors` (security); if new definer functions are flagged, they're already revoked — confirm the count didn't grow. Add revokes to `supabase_definer_lockdown.sql` if any new trigger fn appears.

---

### Task 4: `useChat` hook + presence

**Files:** Create `src/hooks/useChat.js`; modify `src/App.jsx`.

- [ ] `useChat(user)` returns `{ conversations, activeId, messages, openConversation, sendMessage, markRead, totalUnread, closeConversation }`.
  - `loadConversations()`: select conversations where participant; for each, fetch the other party's profile (username, avatar_url, equipped_frame, equipped_name_effect, last_active), the latest message (per conv), and compute unread = messages in conv after my `*_last_read` not sent by me. Batch: one `messages` fetch ordered desc capped, reduce client-side. Online = `last_active > now-120s`.
  - `openConversation(otherId)`: `sb.rpc('get_or_create_conversation',{p_other:otherId})` → set activeId, load its messages (order created_at asc), `markRead`.
  - `sendMessage(convId,{type,body,payload})`: insert into `messages`; optimistic append.
  - `markRead(convId)`: `sb.rpc('mark_conversation_read',{p_conversation:convId})`; recompute unread.
  - Realtime: channel on `messages` INSERT (RLS-gated); on event, if for activeId append + markRead, else bump list/unread; reload conversations list.
- [ ] Presence heartbeat in `App.jsx`: `useEffect` with `setInterval(60s)` while `document.visibilityState==='visible'` → `sb.from('profiles').upsert({id:user.id, last_active:new Date().toISOString()},{onConflict:'id'})`; run once on mount. Clear on unmount.
- [ ] lint; commit.

---

### Task 5: ChatPage + nav tab

**Files:** Create `src/components/ChatPage.jsx`; modify `src/components/AppNav.jsx`, `src/App.jsx`, `src/App.css`.

- [ ] `AppNav`: add 8th tab `CHAT` (speech-bubble icon); badge from `totalUnread` (thread through like `requestCount`).
- [ ] `ChatPage`: two modes — list (no activeId) and thread (activeId set).
  - List rows (`design-people-row` style): `<Avatar frame>` + presence dot, `<Username effect>`, last-message preview (text or "shared a fit/item/article"), relative time, unread badge. Empty state.
  - Thread: header (← back, avatar, name, online text); message list (bubbles: own right, other left; day separators); shared cards — fit (image+name, click → nothing/lightbox), item (thumb+name), article (title+link, opens url in new tab). Composer: text input + SEND (Enter to send).
- [ ] `App.jsx`: route `page === 'chat'` → `<ChatPage game/chat/... />`; pass `chat.totalUnread` to AppNav; clear badge on tab open.
- [ ] CSS: `.chat-*` (list rows, bubbles, composer, presence dot `.presence-dot.online`). Reuse existing tokens.
- [ ] lint; commit.

---

### Task 6: Share-to-chat + invite links

**Files:** modify `src/components/ExplorePage.jsx` (OutfitsFeed fit share, articles feed share), `src/components/ProfilePanel.jsx`, `src/hooks/useAuth.js`, `src/App.jsx`.

- [ ] **Friend picker** (small shared component or inline modal): lists the user's accepted friends; on pick, `openConversation(friendId)` then `sendMessage(convId,{type,payload})` and navigate to CHAT. Add a "share to friend" affordance to each `OutfitsFeed` post (fit payload `{postId,image_url,fit_name}`) and each Explore article (article payload `{url,title,image}`).
- [ ] **Invite link** in `ProfilePanel`: button copies `${location.origin}/?ref=${user.id}` to clipboard, with the "+100 coins when a friend joins" note.
- [ ] **Signup ref wiring**: in `App.jsx` (or a small util) read `?ref=` on load → `sessionStorage`; `useAuth.signUp` reads it and passes `options.data = { ref }`. Ignore self/unknown (server-enforced).
- [ ] lint; commit.

---

### Task 7: Verification + Codex review

- [ ] `npm run lint` + `npm test` + `npm run build` green.
- [ ] Browser render (demo): CHAT tab empty state; invite-link copy; presence heartbeat writes `last_active` (check via connector `select last_active`); share picker opens.
- [ ] Spec walk-through; note two-account round-trip covered by SQL smoke.
- [ ] Codex review (`~/.local/bin/codex exec --sandbox read-only`) of the full diff; verify + apply safe fixes; commit.
