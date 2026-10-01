-- "ReceiptDelivery" was introduced in 0025 without the lockdown applied to
-- every other tenant table in 0017/0018. It holds customer delivery
-- recipients (email addresses), so it must follow the same rule as the rest of
-- the schema: RLS enabled with no public policies, which denies anon and
-- authenticated row access while the server-side database owner (used by the
-- API) keeps its normal access.
--
-- Re-asserting the privilege revocation keeps the second layer consistent for
-- any table created after 0018 as well.

ALTER TABLE "ReceiptDelivery" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END
$$;
