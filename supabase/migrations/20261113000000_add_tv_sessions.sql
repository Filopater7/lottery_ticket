-- Migration: add tv_sessions table for remote TV display pairing
-- Safe to re-run: uses IF NOT EXISTS and DO $$ guards on policies

CREATE TABLE IF NOT EXISTS tv_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text UNIQUE NOT NULL,
  channel_name text UNIQUE NOT NULL,
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  is_active    boolean DEFAULT true
);

ALTER TABLE tv_sessions ENABLE ROW LEVEL SECURITY;

-- TV / public can SELECT to validate their token (anon key is sufficient)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tv_sessions' AND policyname = 'tv_sessions_public_read'
  ) THEN
    CREATE POLICY "tv_sessions_public_read"
      ON tv_sessions FOR SELECT
      USING (true);
  END IF;
END $$;

-- Only the service role (server-side Route Handlers) may INSERT, UPDATE, or DELETE.
-- Supabase service-role key bypasses RLS by default; this policy makes the intent explicit
-- and blocks any other role from writing.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tv_sessions' AND policyname = 'tv_sessions_service_write'
  ) THEN
    CREATE POLICY "tv_sessions_service_write"
      ON tv_sessions FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
