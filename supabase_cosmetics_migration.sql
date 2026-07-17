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

-- ── §2 BUY + EQUIP GUARD ────────────────────────────────────────────────────

create or replace function buy_cosmetic(p_id text)
returns void language plpgsql security definer set search_path = public as $$
declare c cosmetic_defs; v_level int; v_coins int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into c from cosmetic_defs where id = p_id;
  if not found then raise exception 'unknown cosmetic %', p_id; end if;
  if p_id = 'thin_line' then raise exception 'thin_line is free and already owned'; end if;
  if exists (select 1 from user_cosmetics where user_id = auth.uid() and cosmetic_id = p_id) then
    raise exception 'already owned'; end if;
  perform ensure_game_rows(auth.uid());
  select level_for_xp(coalesce((select total_xp from game_state where user_id = auth.uid()),0)) into v_level;
  if v_level < c.min_level then raise exception 'requires level %', c.min_level; end if;
  select coins into v_coins from wallets where user_id = auth.uid();
  if coalesce(v_coins,0) < c.price then raise exception 'insufficient coins'; end if;
  update wallets set coins = coins - c.price, lifetime_spent = lifetime_spent + c.price
   where user_id = auth.uid();
  insert into user_cosmetics (user_id, cosmetic_id) values (auth.uid(), p_id);
  perform check_achievements(auth.uid(), 'coins_spent');
end $$;

revoke execute on function buy_cosmetic(text) from public, anon;
grant  execute on function buy_cosmetic(text) to authenticated;

-- Ownership guard: equipping is a plain profiles UPDATE, so verify the equipped
-- ids are owned (NULL = unequip/default; thin_line is free/universal).
create or replace function trg_profiles_equip_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.equipped_frame is not null and new.equipped_frame <> 'thin_line'
     and not exists (select 1 from user_cosmetics
                     where user_id = new.id and cosmetic_id = new.equipped_frame) then
    raise exception 'frame % not owned', new.equipped_frame;
  end if;
  if new.equipped_name_effect is not null
     and not exists (select 1 from user_cosmetics
                     where user_id = new.id and cosmetic_id = new.equipped_name_effect) then
    raise exception 'name effect % not owned', new.equipped_name_effect;
  end if;
  return new;
end $$;
drop trigger if exists profiles_equip_guard on profiles;
create trigger profiles_equip_guard before insert or update on profiles
  for each row execute function trg_profiles_equip_guard();
