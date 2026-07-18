# Chat, Sharing & Referrals — Design Spec
**Date:** 2026-07-18
**Sub-project 4 of 4 (final)** of the Social & Gamification layer (source brief: `GARDEROBE-social-features-spec.md`)

## Context

Sub-projects 1–3 shipped and are live in production. This adds the last pieces: 1:1 chat,
sharing fits/articles into chat (with rewards), presence, and invite-link referrals.
`friend_requests`, `outfit_posts`, `profiles`, and the gamification economy (`award_xp`,
`ensure_game_rows`, `check_achievements`, `wallets`) already exist.

Decisions locked during brainstorming:
- **Chat** lives on a new **CHAT** nav tab; `conversations` + `messages` tables; friends-only;
  Realtime delivery gated by RLS.
- **Presence** via a `profiles.last_active` heartbeat (~60s); online = within 2 min.
- **Sharing** a fit/article into chat grants the sender a reward (Postgres trigger), deduped
  per item + a daily cap.
- **Referrals**: invite link `?ref=<id>` → signup metadata → `auth.users` trigger records a
  `referrals` row and rewards the inviter on confirm.
- Economy stays Postgres-authoritative; render reuses shared `Avatar`/`Username`.

## 1. Scope

**In:** 1:1 chat (list, thread, composer), message types text/fit/item/article rendered as
cards, presence dots, unread indicators, share-a-fit and share-an-article into chat with
sender rewards, invite links + referral attribution + inviter reward on invitee confirm.

**Out:** group chats, message edit/delete history, typing indicators, push notifications,
media/file attachments beyond the existing image URLs, blocking/muting.

## 2. Data model (`supabase_chat_migration.sql`)

| Table / column | Shape | RLS |
|---|---|---|
| `conversations` | `id uuid PK`, `user_low uuid`, `user_high uuid` (canonical, low<high), `last_message_at timestamptz`, `low_last_read timestamptz`, `high_last_read timestamptz`, `created_at`, unique `(user_low,user_high)` | SELECT: participant (`auth.uid() in (user_low,user_high)`). No client writes (RPC + triggers only). |
| `messages` | `id uuid PK`, `conversation_id → conversations`, `sender_id uuid`, `type text ('text'\|'fit'\|'item'\|'article')`, `body text`, `payload jsonb`, `created_at` | SELECT: participant of the conversation. INSERT: `sender_id = auth.uid()` AND participant AND still friends. No update/delete. |
| `referrals` | `inviter_id uuid`, `invitee_id uuid PK`, `status text ('pending'\|'rewarded')`, `created_at` | SELECT: inviter or invitee. No client writes (auth triggers only). |
| `profiles.last_active` | `timestamptz` nullable | Existing owner-UPDATE policy (client bumps own row). |

`payload` shapes: `fit` → `{ postId, image_url, fit_name }`; `item` → `{ itemId, name,
image_url }`; `article` → `{ url, title, image }`; `text` → null (`body` holds the text).

## 3. Postgres functions & triggers

- **`get_or_create_conversation(p_other uuid) → uuid`** (SECURITY DEFINER, `authenticated`):
  rejects self; verifies an **accepted** `friend_requests` row exists between caller and
  `p_other`; canonicalizes the pair (low/high); inserts the conversation if absent (on
  conflict returns existing); returns the id.
- **`mark_conversation_read(p_conversation uuid)`** (SECURITY DEFINER, `authenticated`):
  sets the caller's `low_last_read`/`high_last_read` = now() (only if participant).
- **`trg_messages_after_insert`** (AFTER INSERT on `messages`): bumps
  `conversations.last_message_at`; for `type in ('fit','article')`, grants the **sender** a
  share reward through `award_xp` + wallet coins — fit: +10 XP / +20 coins (reason
  `share_fit`, `ref_id` = fit postId), article: +8 XP / +15 coins (reason `share_article`,
  `ref_id` = null). **Anti-abuse:** skip if the sender already earned this reason for this
  `ref_id` (fit dedupe), and skip if the sender already earned ≥ 5 share rewards today
  (daily cap across `share_%`). Uses the same `if not exists` + exception-safe pattern as the
  other reward triggers; extend `uniq_xp_events_dedupe` to include `share_fit`.
- **Message insert policy** enforces friends-only at write time (participant + accepted
  friendship), so a stale conversation can't be used after unfriending.

### Referral triggers (on `auth.users`)
- **`handle_referral_signup`** (AFTER INSERT on `auth.users`): reads
  `new.raw_user_meta_data->>'ref'`; if it's a valid, different user id, inserts
  `referrals(inviter, invitee, 'pending')` (on conflict do nothing). If the new row is
  **already** confirmed (auto-confirm configs), immediately reward (below).
- **`handle_referral_confirm`** (AFTER UPDATE on `auth.users`): when `email_confirmed_at`
  goes from null → set and a `pending` referral exists for this invitee, grant the inviter
  **+50 XP / +100 coins** (`ensure_game_rows` first; reason `referral`, `ref_id` = invitee),
  and mark the referral `rewarded`. Idempotent (guarded by `status`).
- All three are SECURITY DEFINER owned by the migration role; EXECUTE not granted to
  anon/authenticated (they only fire as triggers).

## 4. Client — state

- **`useChat(user)`** hook: `conversations` (list with other-party profile, last message,
  unread count, online flag), `openConversation(otherUserId)` (calls the RPC, loads
  messages), active `messages`, `sendMessage(convId, { type, body, payload })`,
  `markRead(convId)`, `totalUnread`. Subscribes to Realtime INSERTs on `messages`
  (RLS-gated, so only my conversations arrive) to append live + refresh the list/unread.
- **Presence heartbeat** in `App.jsx`: every 60s while the tab is visible, `update profiles
  set last_active = now()` for the current user; also once on load.
- Unread total feeds a **CHAT** nav badge (like the FRIENDS request badge).

## 5. Client — UI

- **CHAT nav tab** (8th) → `ChatPage`:
  - **Conversation list**: each row = other party `<Avatar>`+frame / `<Username>`+effect,
    presence dot, last-message preview, relative time, unread count. Empty state links to
    Friends/Explore.
  - **Thread view**: header (back, avatar, name, online status); scrollable message list with
    day grouping; own vs other bubble alignment; shared cards render inline (fit → image +
    name, tappable to the fit; item → thumbnail + name; article → link card). Composer: text
    input + send.
- **Share-to-chat**: a share action on (a) `OutfitsFeed` fit posts and (b) the Explore
  articles feed opens a **friend picker**; choosing a friend calls
  `get_or_create_conversation` then `sendMessage` with the fit/article payload, and navigates
  to the thread. The sender reward fires server-side.
- **Invite link**: an **INVITE** control (in `ProfilePanel`) generates
  `${location.origin}/?ref=${user.id}` and copies it (clipboard), with a short "shares earn
  +100 coins when a friend joins" note.
- All styled in the existing `v-screen` / `design-people-*` / `modal` language; presence dot
  and chat bubbles are the only new visual primitives.

## 6. Signup wiring (referrals)

- On app load, read `?ref=` from the URL once and stash it (sessionStorage) so it survives
  the auth screens.
- `useAuth.signUp` includes `options.data = { ref: <stashedRef> }` when present, landing it
  in `raw_user_meta_data` for the `handle_referral_signup` trigger. Self-referral and unknown
  ids are ignored server-side.

## 7. Testing & verification

- **SQL smoke** (`scripts/test-chat.sql`, rolled back via terminal `raise exception`,
  impersonating users with `set_config`): friends-only conversation create (reject
  non-friends); message insert + `mark_conversation_read` updates the right participant;
  share-fit reward once + dedupe on re-share + daily-cap ceiling; article-share reward;
  referral: signup metadata → pending row → confirm grants inviter +100c/+50xp once.
- **Manual/browser** (demo account): CHAT tab renders (empty state with no friends);
  invite-link copy works; presence heartbeat updates `last_active`; share picker opens.
  Full 1:1 round-trip needs two accounts (verified via SQL smoke).
- Frontend lint + JS tests green; build clean. Post-apply advisor scan; lock down new
  SECURITY DEFINER functions (revoke default PUBLIC execute on triggers; keep `authenticated`
  on `get_or_create_conversation` / `mark_conversation_read`).

## 8. Security

- Messages/conversations are participant-only (RLS); inserts require sender = caller +
  active friendship, so unfriending stops new messages.
- Share rewards go to the **sender** through a definer trigger, deduped per fit + capped
  daily (farm-resistant, consistent with the other reward triggers).
- Referral rewards fire only on invitee **confirm**, once (status-guarded), and ignore
  self-referrals / unknown inviters — limiting fake-signup farming.
- `last_active` is public (like presence generally); no other private data exposed.
- New definer functions get least-privilege grants (mirroring `supabase_definer_lockdown.sql`).
