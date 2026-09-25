-- Phase 12: cross-process rate limiting. Each hit records a row; the hit
-- statement prunes the key's expired rows and counts the rest, so the table
-- stays bounded by distinct keys times the widest window.
CREATE TABLE "RateLimitHit" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RateLimitHit_key_at_idx" ON "RateLimitHit"("key", "at");
