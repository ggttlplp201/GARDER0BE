-- Price tracking migration
-- Run in Supabase SQL editor

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists wishlist_price_sources (
  id            uuid        primary key default gen_random_uuid(),
  item_id       uuid        not null references items(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  source_name   text        not null,
  source_url    text        not null,
  currency      text        not null default 'USD',
  last_price    numeric,
  last_seen_at  timestamptz,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists wishlist_price_history (
  id             uuid        primary key default gen_random_uuid(),
  source_id      uuid        not null references wishlist_price_sources(id) on delete cascade,
  item_id        uuid        not null references items(id) on delete cascade,
  observed_price numeric     not null,
  currency       text        not null default 'USD',
  observed_at    timestamptz not null default now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────

create index if not exists idx_wps_item_id    on wishlist_price_sources(item_id);
create index if not exists idx_wps_user_id    on wishlist_price_sources(user_id);
create index if not exists idx_wph_source_id  on wishlist_price_history(source_id);
create index if not exists idx_wph_item_id    on wishlist_price_history(item_id);
create index if not exists idx_wph_observed   on wishlist_price_history(observed_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table wishlist_price_sources  enable row level security;
alter table wishlist_price_history  enable row level security;

-- Sources: users own their rows
create policy "users select own sources"
  on wishlist_price_sources for select
  using (auth.uid() = user_id);

create policy "users insert own sources"
  on wishlist_price_sources for insert
  with check (auth.uid() = user_id);

create policy "users update own sources"
  on wishlist_price_sources for update
  using (auth.uid() = user_id);

create policy "users delete own sources"
  on wishlist_price_sources for delete
  using (auth.uid() = user_id);

-- History: read if you own the source; writes come from service role (backend)
create policy "users select own history"
  on wishlist_price_history for select
  using (
    exists (
      select 1 from wishlist_price_sources s
      where s.id = wishlist_price_history.source_id
        and s.user_id = auth.uid()
    )
  );

-- Service role bypasses RLS, so no insert policy needed for backend writes.
-- Add this only if you want to allow direct client inserts (not recommended):
-- create policy "users insert own history"
--   on wishlist_price_history for insert
--   with check (
--     exists (
--       select 1 from wishlist_price_sources s
--       where s.id = source_id and s.user_id = auth.uid()
--     )
--   );
