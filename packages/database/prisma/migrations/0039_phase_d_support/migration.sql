-- Phase D guest cases and read-only, owner-consented operator diagnostics.
CREATE TABLE "GuestSupportCase" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "category" TEXT NOT NULL, "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN', "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3), "closedBy" TEXT,
  CONSTRAINT "GuestSupportCase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE,
  CONSTRAINT "GuestSupportCase_category_check" CHECK ("category" IN ('ORDER','PAYMENT','FULFILLMENT','OTHER')),
  CONSTRAINT "GuestSupportCase_status_check" CHECK ("status" IN ('OPEN','CLOSED')),
  CONSTRAINT "GuestSupportCase_closed_check" CHECK (
    ("status"='OPEN' AND "closedAt" IS NULL AND "closedBy" IS NULL) OR
    ("status"='CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "GuestSupportCase_businessId_idempotencyKey_key" ON "GuestSupportCase"("businessId","idempotencyKey");
CREATE INDEX "GuestSupportCase_businessId_status_createdAt_idx" ON "GuestSupportCase"("businessId","status","createdAt");
ALTER TABLE "GuestSupportCase" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "PlatformOwnerConsent" (
  "id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  CONSTRAINT "PlatformOwnerConsent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE
);
CREATE INDEX "PlatformOwnerConsent_businessId_expiresAt_idx" ON "PlatformOwnerConsent"("businessId","expiresAt");
ALTER TABLE "PlatformOwnerConsent" ENABLE ROW LEVEL SECURITY;
