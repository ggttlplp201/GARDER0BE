# Supabase migrations

Ordered SQL for the GARDEROBE database schema. All are already applied to the
production project; they're kept here as the schema source of truth and for
re-provisioning a fresh environment. Run in numeric order in the Supabase SQL
editor (each is idempotent / safe to re-run).

| # | File | What it adds |
|---|------|--------------|
| 01 | `01_init.sql` | Base `items` table |
| 02 | `02_explore_profiles.sql` | `profiles` + public discovery / item read policies |
| 03 | `03_saved_fits.sql` | `saved_fits` (OOTD builder sync) |
| 04 | `04_geo.sql` | Location / timezone columns on `profiles` |
| 05 | `05_price_tracking.sql` | Wishlist price sources + history |
| 06 | `06_aal_rls.sql` | Auth-hardening: AAL/MFA RLS enforcement |
| 07 | `07_gamification.sql` | XP / levels / coins / achievements / quests / streaks + backfill |
| 08 | `08_gamification_hardening.sql` | Post-review fixes (worn-on pin, wishlist-wear block, dedupe index) |
| 09 | `09_cosmetics.sql` | Cosmetic catalog, `buy_cosmetic`, equip-guard trigger |
| 10 | `10_social.sql` | `fit_likes`, pins, achievements RLS, likes metric |
| 11 | `11_definer_lockdown.sql` | Least-privilege revokes on trigger/RPC functions |
| 12 | `12_chat.sql` | Conversations / messages / referrals + share & referral rewards |

Frontend parity: `07_gamification.sql`'s level curve mirrors `src/lib/levels.js`,
and `09_cosmetics.sql`'s `cosmetic_defs` seed mirrors `src/lib/cosmetics.js`.
