-- Migration: remove public SELECT from tv_sessions; restrict to service role only.
-- All TV session reads happen through server-side Route Handlers using the service-role
-- client, so no anon/authenticated direct access is needed.

-- Drop the public read policy that allowed any anon-key holder to enumerate all tokens.
DROP POLICY IF EXISTS "tv_sessions_public_read" ON tv_sessions;

-- Add an explicit service-role read policy (service role bypasses RLS by default,
-- but being explicit documents intent and prevents future accidents).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tv_sessions' AND policyname = 'tv_sessions_service_read'
  ) THEN
    CREATE POLICY "tv_sessions_service_read"
      ON tv_sessions FOR SELECT
      TO service_role
      USING (true);
  END IF;
END $$;
