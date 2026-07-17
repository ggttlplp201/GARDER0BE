-- Cosmetics migration — run in the Supabase SQL editor. Safe to re-run.
-- Requires supabase_gamification_migration.sql (uses level_for_xp, game_state,
-- wallets, ensure_game_rows, check_achievements).
-- Spec: docs/superpowers/specs/2026-07-17-cosmetics-design.md

-- ── §1 TABLES / COLUMNS ─────────────────────────────────────────────────────

create table if not exists cosmetic_defs (
  id        text primary key,
  type      text not null check (type in ('frame','name_effect')),
  name      text not null,
  price     int  not null,
  min_level int  not null default 0,
  sort      int  not null
);

create table if not exists user_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references cosmetic_defs(id),
  acquired_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table profiles add column if not exists equipped_frame text;
alter table profiles add column if not exists equipped_name_effect text;

alter table cosmetic_defs  enable row level security;
alter table user_cosmetics enable row level security;

do $$ begin
  create policy "cosmetic_defs_select" on cosmetic_defs for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "user_cosmetics_select" on user_cosmetics for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
-- No client writes on user_cosmetics: ownership only via buy_cosmetic().

insert into cosmetic_defs (id, type, name, price, min_level, sort) values
  ('thin_line','frame','Thin Line',0,0,1),
  ('dashed_ring','frame','Dashed Ring',150,0,2),
  ('ice_crystal','frame','Ice Crystal',450,5,3),
  ('crimson_flame','frame','Crimson Flame',650,5,4),
  ('gold_laurel','frame','Gold Laurel',800,10,5),
  ('onyx_halo','frame','Onyx Halo',950,10,6),
  ('royal_crown','frame','Royal Crown',1300,15,7),
  ('angel_wings','frame','Angel Wings',1500,20,8),
  ('silver_shine','name_effect','Silver Shine',300,0,1),
  ('gold_shine','name_effect','Gold Shine',500,8,2),
  ('rainbow_shine','name_effect','Rainbow Shine',900,12,3)
on conflict (id) do nothing;
