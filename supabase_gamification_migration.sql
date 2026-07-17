-- Gamification migration — run in the Supabase SQL editor.
-- Sections: 1 tables/RLS/seed · 2 economy engine · 3 triggers · 4 quests/streaks · 5 backfill
-- Spec: docs/superpowers/specs/2026-07-17-game-engine-core-design.md

-- ── §1 TABLES ───────────────────────────────────────────────────────────────

create table if not exists game_state (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  total_xp     int  not null default 0,
  streak_count int  not null default 0,
  best_streak  int  not null default 0,
  last_open_date date,
  updated_at   timestamptz not null default now()
);

create table if not exists wallets (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  coins          int not null default 0,
  lifetime_spent int not null default 0
);

create table if not exists xp_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        int  not null,
  reason        text not null,
  ref_id        uuid,
  leveled_to    int,
  coins_awarded int,
  created_at    timestamptz not null default now()
);
create index if not exists idx_xp_events_user on xp_events(user_id, created_at desc);

create table if not exists wear_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references items(id) on delete cascade,
  worn_on    date not null default current_date,
  created_at timestamptz not null default now(),
  unique (item_id, worn_on)
);
create index if not exists idx_wear_events_user on wear_events(user_id, worn_on desc);

create table if not exists achievement_defs (
  id          text primary key,
  name        text not null,
  description text not null,
  metric      text not null,
  goal        int  not null,
  xp          int  not null,
  sort        int  not null
);

create table if not exists user_achievements (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references achievement_defs(id),
  progress       int  not null default 0,
  unlocked_at    timestamptz,
  primary key (user_id, achievement_id)
);

create table if not exists daily_quests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  quest_date   date not null,
  quest_type   text not null,
  goal         int  not null,
  progress     int  not null default 0,
  xp_reward    int  not null,
  coin_reward  int  not null,
  completed_at timestamptz,
  unique (user_id, quest_date, quest_type)
);

-- ── §1 RLS ──────────────────────────────────────────────────────────────────

alter table game_state        enable row level security;
alter table wallets           enable row level security;
alter table xp_events         enable row level security;
alter table wear_events       enable row level security;
alter table achievement_defs  enable row level security;
alter table user_achievements enable row level security;
alter table daily_quests      enable row level security;

-- game_state: own row, or public-profile rows (future profiles/leaderboards)
create policy "game_state_select" on game_state for select using (
  auth.uid() = user_id
  or exists (select 1 from profiles p where p.id = game_state.user_id and p.is_public = true)
);

create policy "wallets_select"      on wallets           for select using (auth.uid() = user_id);
create policy "xp_events_select"    on xp_events         for select using (auth.uid() = user_id);
create policy "wear_events_select"  on wear_events       for select using (auth.uid() = user_id);
create policy "wear_events_insert"  on wear_events       for insert with check (
  auth.uid() = user_id
  and exists (select 1 from items i where i.id = wear_events.item_id and i.user_id = auth.uid())
);
create policy "achievement_defs_select"  on achievement_defs  for select using (true);
create policy "user_achievements_select" on user_achievements for select using (auth.uid() = user_id);
create policy "daily_quests_select" on daily_quests      for select using (auth.uid() = user_id);
-- No other write policies: mutations happen only inside SECURITY DEFINER functions.

-- ── §1 SEED ─────────────────────────────────────────────────────────────────

insert into achievement_defs (id, name, description, metric, goal, xp, sort) values
  ('first_steps',      'First Steps',      'Add your first item',            'items',          1,   50,  1),
  ('curator',          'Curator',          'Collection reaches 25 items',    'items',          25,  150, 2),
  ('archivist',        'Archivist',        'Collection reaches 100 items',   'items',          100, 400, 3),
  ('fit_check',        'Fit Check',        'Save your first outfit',         'outfits',        1,   50,  4),
  ('stylist',          'Stylist',          'Save 5 outfits',                 'outfits',        5,   150, 5),
  ('daily_driver',     'Daily Driver',     'Log wears 7 days in a row',      'wear_streak',    7,   200, 6),
  ('well_worn',        'Well Worn',        'Log 50 total wears',             'wears',          50,  250, 7),
  ('social_butterfly', 'Social Butterfly', 'Like 5 profiles',                'likes_given',    5,   75,  8),
  ('trendsetter',      'Trendsetter',      'Post 5 fits publicly',           'public_fits',    5,   150, 9),
  ('popular',          'Popular',          'Receive 25 likes',               'likes_received', 25,  300, 10),
  ('networker',        'Networker',        'Add 10 friends',                 'friends',        10,  150, 11),
  ('bargain_hunter',   'Bargain Hunter',   'Catch a wishlist price drop',    'price_drop',     1,   100, 12),
  ('big_spender',      'Big Spender',      'Spend 1,000 coins total',        'coins_spent',    1000, 100, 13),
  ('drip_lord',        'Drip Lord',        'Reach level 20',                 'level',          20,  500, 14)
on conflict (id) do nothing;

-- ── §1 REALTIME ─────────────────────────────────────────────────────────────

do $$ begin
  alter publication supabase_realtime add table public.xp_events;
exception when duplicate_object then null; end $$;
