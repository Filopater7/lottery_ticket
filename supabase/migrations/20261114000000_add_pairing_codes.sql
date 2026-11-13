-- Migration: add pairing_codes table for 6-digit TV pairing flow
-- Safe to re-run: uses IF NOT EXISTS and DO $$ guards on policies

-- Pairing codes: short-lived 6-digit codes the TV enters to exchange for a session token
CREATE TABLE IF NOT EXISTS pairing_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        char(6) NOT NULL,
  token       text NOT NULL,            -- references tv_sessions.token
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,              -- NULL until redeemed; set on first use
  created_at  timestamptz DEFAULT now()
);

-- Index for fast code lookup
CREATE INDEX IF NOT EXISTS pairing_codes_code_idx ON pairing_codes (code);

ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;

-- No direct public SELECT on this table: all access goes through Route Handlers
-- using the service role, so we only need a service_role write policy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pairing_codes' AND policyname = 'pairing_codes_service_only'
  ) THEN
    CREATE POLICY "pairing_codes_service_only"
      ON pairing_codes FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Rate-limiting attempts: track TV IP/fingerprint code-submission attempts
CREATE TABLE IF NOT EXISTS pairing_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_key      text NOT NULL,            -- hashed IP or a stable TV fingerprint
  attempted_at timestamptz DEFAULT now()
);

-- Index for fast window query
CREATE INDEX IF NOT EXISTS pairing_attempts_ip_key_idx ON pairing_attempts (ip_key, attempted_at);

ALTER TABLE pairing_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'pairing_attempts' AND policyname = 'pairing_attempts_service_only'
  ) THEN
    CREATE POLICY "pairing_attempts_service_only"
      ON pairing_attempts FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
