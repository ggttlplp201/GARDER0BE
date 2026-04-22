-- Run this in the Supabase SQL editor

-- Public profiles table for discovery
CREATE TABLE IF NOT EXISTS profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text,
  bio         text,
  location    text,
  aesthetic   text,
  avatar_url  text,
  is_public   boolean DEFAULT false,
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read public profiles; owners can read their own
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (is_public = true OR auth.uid() = id);

-- Owners can insert/update their own profile
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Allow reading items from public profiles (add alongside existing item policies)
CREATE POLICY "items_public_select" ON items
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = items.user_id
      AND profiles.is_public = true
    )
  );
