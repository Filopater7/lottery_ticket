-- Migration: replace access-key auth with username+password on stores table
-- Safe to re-run: uses IF NOT EXISTS / DO $$ guards

-- 1. Add username column (unique, required)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='stores' AND column_name='username'
  ) THEN
    ALTER TABLE stores ADD COLUMN username text;
  END IF;
END $$;

-- 2. Add password_hash column (PBKDF2-SHA256 hex)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='stores' AND column_name='password_hash'
  ) THEN
    ALTER TABLE stores ADD COLUMN password_hash text;
  END IF;
END $$;

-- 3. Add password_salt column
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='stores' AND column_name='password_salt'
  ) THEN
    ALTER TABLE stores ADD COLUMN password_salt text;
  END IF;
END $$;

-- 4. Add is_active column (default true)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='stores' AND column_name='is_active'
  ) THEN
    ALTER TABLE stores ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- 5. Backfill any existing rows so they are not null-blocked
--    (existing rows used access_key_hash/key_salt; give them placeholder values
--     so NOT NULL constraints can be added safely, then the admin can reset them)
UPDATE stores
SET
  username      = COALESCE(username,      'store_' || substring(id::text, 1, 8)),
  password_hash = COALESCE(password_hash, access_key_hash),
  password_salt = COALESCE(password_salt, key_salt)
WHERE username IS NULL OR password_hash IS NULL OR password_salt IS NULL;

-- 6. Apply NOT NULL now that all rows are filled
ALTER TABLE stores ALTER COLUMN username      SET NOT NULL;
ALTER TABLE stores ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE stores ALTER COLUMN password_salt SET NOT NULL;

-- 7. Unique constraint on username
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stores_username_key'
  ) THEN
    ALTER TABLE stores ADD CONSTRAINT stores_username_key UNIQUE (username);
  END IF;
END $$;

-- 8. Index on username for fast login lookup
CREATE INDEX IF NOT EXISTS stores_username_idx ON stores (username);

-- Note: access_key_hash and key_salt columns are kept for now (no DROP) so the
-- migration is fully reversible. They are ignored by application code going forward.
