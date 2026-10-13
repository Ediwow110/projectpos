-- Phase C damage / dated-stock observation register.
-- Reporting alone does NOT reserve or reduce saleable inventory.
CREATE TABLE "StockException" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "branchId" TEXT,
  "kind" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "expiresOn" TEXT,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reportKey" TEXT NOT NULL,
  "reportedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disposedBy" TEXT,
  "disposedAt" TIMESTAMP(3),
  "movementId" TEXT,
  CONSTRAINT "StockException_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE,
  CONSTRAINT "StockException_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "StockException_kind_valid" CHECK ("kind" IN ('DAMAGE','EXPIRY')),
  CONSTRAINT "StockException_status_valid" CHECK ("status" IN ('OPEN','DISPOSED')),
  CONSTRAINT "StockException_expiry_date" CHECK ("expiresOn" IS NULL OR "expiresOn" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT "StockException_expiry_required" CHECK ("kind" <> 'EXPIRY' OR "expiresOn" IS NOT NULL),
  CONSTRAINT "StockException_disposition_consistent" CHECK (
    ("status"='OPEN' AND "movementId" IS NULL AND "disposedAt" IS NULL AND "disposedBy" IS NULL)
    OR ("status"='DISPOSED' AND "movementId" IS NOT NULL AND "disposedAt" IS NOT NULL AND "disposedBy" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "StockException_businessId_reportKey_key" ON "StockException"("businessId","reportKey");
CREATE INDEX "StockException_businessId_branchId_status_idx" ON "StockException"("businessId","branchId","status","createdAt");
CREATE INDEX "StockException_businessId_productId_idx" ON "StockException"("businessId","productId");
ALTER TABLE "StockException" ENABLE ROW LEVEL SECURITY;
