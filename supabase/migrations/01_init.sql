-- Run this in the Supabase SQL editor to add new metadata columns to the items table
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'owned',
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS retail_price numeric,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS resale_estimate numeric,
  ADD COLUMN IF NOT EXISTS tags text;
