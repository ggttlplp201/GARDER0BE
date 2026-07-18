-- AAL enforcement: users with a verified MFA factor must present aal2 tokens.
-- Users without a verified factor are unaffected (they can't have aal2 anyway).
-- Note: auth schema function creation is restricted on hosted Supabase;
-- the MFA check is inlined directly into each policy.

-- items table
DROP POLICY IF EXISTS "Users can view own items" ON items;
DROP POLICY IF EXISTS "Users can insert own items" ON items;
DROP POLICY IF EXISTS "Users can update own items" ON items;
DROP POLICY IF EXISTS "Users can delete own items" ON items;
DROP POLICY IF EXISTS "users select own" ON items;
DROP POLICY IF EXISTS "users insert own" ON items;
DROP POLICY IF EXISTS "users update own" ON items;
DROP POLICY IF EXISTS "users delete own" ON items;

CREATE POLICY "items_select" ON items
  FOR SELECT USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "items_insert" ON items
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "items_update" ON items
  FOR UPDATE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "items_delete" ON items
  FOR DELETE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

-- wishlist_price_sources table
DROP POLICY IF EXISTS "users select own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "users insert own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "users update own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "users delete own sources" ON wishlist_price_sources;

CREATE POLICY "wps_select" ON wishlist_price_sources
  FOR SELECT USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "wps_insert" ON wishlist_price_sources
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "wps_update" ON wishlist_price_sources
  FOR UPDATE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );

CREATE POLICY "wps_delete" ON wishlist_price_sources
  FOR DELETE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = auth.uid() AND status = 'verified' AND factor_type = 'totp'
      )
    )
  );
