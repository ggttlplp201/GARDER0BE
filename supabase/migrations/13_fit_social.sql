-- Fit social — comments + share tracking for outfit posts (Instagram-style post view).
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists fit_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references outfit_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_fit_comments_post on fit_comments(post_id, created_at);

create table if not exists fit_shares (
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    uuid not null references outfit_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists idx_fit_shares_post on fit_shares(post_id);

alter table fit_comments enable row level security;
alter table fit_shares   enable row level security;

-- Comments: public read (posts are public); insert/delete own, with a length guard.
do $$ begin create policy "fit_comments_select" on fit_comments for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "fit_comments_insert" on fit_comments for insert
  with check (auth.uid() = user_id and length(btrim(body)) between 1 and 500);
exception when duplicate_object then null; end $$;
do $$ begin create policy "fit_comments_delete" on fit_comments for delete using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Shares: public read (for counts); insert own.
do $$ begin create policy "fit_shares_select" on fit_shares for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin create policy "fit_shares_insert" on fit_shares for insert with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

do $$ begin alter publication supabase_realtime add table public.fit_comments;
exception when duplicate_object then null; end $$;
