-- H5 durable order notifications. Apply only to an approved isolated database
-- until the production migration/recovery gate is explicitly authorized.
-- Customer addresses, bearer tokens and provider errors are never persisted here.
CREATE TABLE "OrderNotificationOutbox" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseId" TEXT,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderNotificationOutbox_order_tenant_fkey"
    FOREIGN KEY ("businessId", "orderId") REFERENCES "Order" ("businessId", "id")
    ON DELETE CASCADE,
  CONSTRAINT "OrderNotificationOutbox_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'DEAD', 'CANCELLED')),
  CONSTRAINT "OrderNotificationOutbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "OrderNotificationOutbox_event_check" CHECK ("event" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT "OrderNotificationOutbox_dedupe_check" CHECK ("dedupeKey" ~ '^[a-zA-Z0-9:_-]{1,128}$'),
  CONSTRAINT "OrderNotificationOutbox_lease_check"
    CHECK (("status" = 'PROCESSING' AND "leaseId" IS NOT NULL AND "lockedUntil" IS NOT NULL)
        OR ("status" <> 'PROCESSING' AND "leaseId" IS NULL AND "lockedUntil" IS NULL))
);
CREATE UNIQUE INDEX "OrderNotificationOutbox_business_dedupe_key"
  ON "OrderNotificationOutbox" ("businessId", "dedupeKey");
CREATE INDEX "OrderNotificationOutbox_due_idx"
  ON "OrderNotificationOutbox" ("nextAttemptAt", "createdAt", "id")
  WHERE "status" = 'PENDING';
CREATE INDEX "OrderNotificationOutbox_processing_idx"
  ON "OrderNotificationOutbox" ("lockedUntil")
  WHERE "status" = 'PROCESSING';
CREATE INDEX "OrderNotificationOutbox_order_idx"
  ON "OrderNotificationOutbox" ("businessId", "orderId", "status");
ALTER TABLE "OrderNotificationOutbox" ENABLE ROW LEVEL SECURITY;
