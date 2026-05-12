-- AAL enforcement: users with a verified MFA factor must present aal2 tokens.
-- Users without a verified factor are unaffected (they can't have aal2 anyway).

-- Helper: returns true if the current user has a verified TOTP factor
CREATE OR REPLACE FUNCTION auth.user_has_mfa()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.mfa_factors
    WHERE user_id = auth.uid()
      AND status = 'verified'
      AND factor_type = 'totp'
  );
$$;

-- Drop existing permissive policies on items and replace with AAL-aware ones.
-- Repeat this pattern for each sensitive table.
-- NOTE: The policy names below follow common conventions. Before running this migration,
-- confirm the actual policy names in your Supabase dashboard (Security > Policies),
-- as they may differ from the names shown here.

-- items table
DROP POLICY IF EXISTS "Users can view own items" ON items;
DROP POLICY IF EXISTS "Users can insert own items" ON items;
DROP POLICY IF EXISTS "Users can update own items" ON items;
DROP POLICY IF EXISTS "Users can delete own items" ON items;

CREATE POLICY "items_select" ON items
  FOR SELECT USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "items_insert" ON items
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "items_update" ON items
  FOR UPDATE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "items_delete" ON items
  FOR DELETE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

-- wishlist_price_sources table
DROP POLICY IF EXISTS "Users can view own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "Users can insert own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "Users can update own sources" ON wishlist_price_sources;
DROP POLICY IF EXISTS "Users can delete own sources" ON wishlist_price_sources;

CREATE POLICY "wps_select" ON wishlist_price_sources
  FOR SELECT USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "wps_insert" ON wishlist_price_sources
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "wps_update" ON wishlist_price_sources
  FOR UPDATE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );

CREATE POLICY "wps_delete" ON wishlist_price_sources
  FOR DELETE USING (
    auth.uid() = user_id
    AND (
      (auth.jwt()->>'aal') = 'aal2'
      OR NOT auth.user_has_mfa()
    )
  );
