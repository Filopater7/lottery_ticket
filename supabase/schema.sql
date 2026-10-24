-- ============================================================
-- lottery_screen database schema
-- Run this once in Supabase SQL Editor to initialize the DB.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING
-- ============================================================

-- Items table
CREATE TABLE IF NOT EXISTS items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer NOT NULL UNIQUE CHECK (number >= 1 AND number <= 9999),
  code        text,
  title       text NOT NULL DEFAULT '',
  image_url   text,
  price       integer CHECK (price IN (1, 2, 3, 5, 10, 20, 30, 50, 100)),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast ordering by number
CREATE INDEX IF NOT EXISTS items_number_idx ON items (number);

-- Index for enabled items (public display query)
CREATE INDEX IF NOT EXISTS items_enabled_number_idx ON items (enabled, number);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_updated_at ON items;
CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- Public can read enabled items only
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'items' AND policyname = 'Public read enabled items'
  ) THEN
    CREATE POLICY "Public read enabled items"
      ON items FOR SELECT
      USING (enabled = true);
  END IF;
END $$;

-- Authenticated users (admin) can do everything
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'items' AND policyname = 'Authenticated full access'
  ) THEN
    CREATE POLICY "Authenticated full access"
      ON items FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- Seed 50 default items (safe to re-run)
-- ============================================================
INSERT INTO items (number, title, price, enabled) VALUES
  (1,  'Lucky Star',        1,   true),
  (2,  'Golden Chance',     2,   true),
  (3,  'Triple Fortune',    5,   true),
  (4,  'Diamond Rush',      10,  true),
  (5,  'Silver Lining',     1,   true),
  (6,  'Jackpot Express',   20,  true),
  (7,  'Wild Riches',       5,   true),
  (8,  'Cash Bonanza',      2,   true),
  (9,  'Emerald Win',       3,   true),
  (10, 'Power Pick',        10,  true),
  (11, 'Mega Fortune',      30,  true),
  (12, 'Golden Ticket',     1,   true),
  (13, 'Neon Jackpot',      50,  true),
  (14, 'Royal Flush',       20,  true),
  (15, 'Crystal Ball',      5,   true),
  (16, 'Super 7s',          2,   true),
  (17, 'Cash Explosion',    100, true),
  (18, 'Fortune Wheel',     3,   true),
  (19, 'Diamond Dare',      10,  true),
  (20, 'Platinum Play',     50,  true),
  (21, 'Lucky Clover',      1,   true),
  (22, 'Gold Rush',         5,   true),
  (23, 'Instant Win',       2,   true),
  (24, 'Mega Millions',     30,  true),
  (25, 'Power Ball',        20,  true),
  (26, 'Cash Splash',       3,   true),
  (27, 'Triple 7s',         5,   true),
  (28, 'Lucky Strike',      1,   true),
  (29, 'Jackpot City',      100, true),
  (30, 'Fortune Five',      10,  true),
  (31, 'Wild Cherry',       2,   true),
  (32, 'Cash Carnival',     3,   true),
  (33, 'Golden Nugget',     5,   true),
  (34, 'Lucky Number',      1,   true),
  (35, 'Diamond Blitz',     20,  true),
  (36, 'Neon Nights',       10,  true),
  (37, 'Emerald Isle',      2,   true),
  (38, 'Super Jackpot',     50,  true),
  (39, 'Cash King',         5,   true),
  (40, 'Fortune Finder',    3,   true),
  (41, 'Royal Riches',      30,  true),
  (42, 'Lucky Horseshoe',   1,   true),
  (43, 'Gold Fever',        10,  true),
  (44, 'Jackpot Jungle',    20,  true),
  (45, 'Crystal Fortune',   5,   true),
  (46, 'Power Strike',      2,   true),
  (47, 'Cash Cascade',      100, true),
  (48, 'Lucky Leprechaun',  3,   true),
  (49, 'Diamond Dreams',    50,  true),
  (50, 'Grand Finale',      100, true)
ON CONFLICT (number) DO NOTHING;
