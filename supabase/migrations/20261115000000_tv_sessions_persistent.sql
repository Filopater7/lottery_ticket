-- Migration: make TV sessions persistent and add display_state column
-- Safe to re-run: uses IF NOT EXISTS / column existence checks

-- 1. Add display_state column to tv_sessions (tracks last Start/Stop command persistently)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tv_sessions' AND column_name = 'display_state'
  ) THEN
    ALTER TABLE tv_sessions ADD COLUMN display_state boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 2. Extend all existing active sessions to 1 year from now so they don't expire soon.
--    New sessions created by the app will also use 1-year expiry (enforced in code).
UPDATE tv_sessions
SET expires_at = now() + interval '1 year'
WHERE is_active = true
  AND expires_at < now() + interval '30 days';
