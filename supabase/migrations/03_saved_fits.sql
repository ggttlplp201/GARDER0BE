-- Run this in the Supabase SQL editor to enable cross-device saved fits sync

CREATE TABLE IF NOT EXISTS saved_fits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'UNTITLED',
  slots      jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE saved_fits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own fits" ON saved_fits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
