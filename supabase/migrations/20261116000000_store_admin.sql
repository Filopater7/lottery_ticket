-- Migration: Store Admin feature
-- Adds: stores, store_selections, tv_sessions.store_id
-- Safe to re-run: IF NOT EXISTS / DO $$ guards throughout

-- ============================================================
-- stores table
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  access_key_hash  text NOT NULL,   -- PBKDF2-SHA256 hex digest; never exposed
  key_salt         text NOT NULL,   -- per-store salt for PBKDF2
  session_version  integer NOT NULL DEFAULT 0,  -- bumped on key reset to invalidate store cookies
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- RLS: service role only — no anon or authenticated direct access
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='stores' AND policyname='stores_service_only'
  ) THEN
    CREATE POLICY "stores_service_only" ON stores FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Auto-update updated_at on stores
CREATE OR REPLACE FUNCTION update_stores_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS stores_updated_at ON stores;
CREATE TRIGGER stores_updated_at
  BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION update_stores_updated_at();

-- ============================================================
-- store_selections table
-- ============================================================
CREATE TABLE IF NOT EXISTS store_selections (
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, item_id)
);

CREATE INDEX IF NOT EXISTS store_selections_store_order_idx
  ON store_selections (store_id, sort_order);

-- RLS: service role only
ALTER TABLE store_selections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='store_selections' AND policyname='store_selections_service_only'
  ) THEN
    CREATE POLICY "store_selections_service_only" ON store_selections FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- tv_sessions.store_id  (nullable FK — existing sessions unaffected)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tv_sessions' AND column_name='store_id'
  ) THEN
    ALTER TABLE tv_sessions
      ADD COLUMN store_id uuid REFERENCES stores(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for fast lookup of a store's TV sessions
CREATE INDEX IF NOT EXISTS tv_sessions_store_id_idx ON tv_sessions (store_id);
