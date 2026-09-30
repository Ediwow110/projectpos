CREATE TABLE "Exchange" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "originalSaleId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "replacementSaleId" TEXT NOT NULL,
  "returnMinor" INTEGER NOT NULL,
  "replacementMinor" INTEGER NOT NULL,
  "netMinor" INTEGER NOT NULL,
  "direction" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Exchange_businessId_originalSaleId_createdAt_idx" ON "Exchange"("businessId", "originalSaleId", "createdAt");
CREATE INDEX "Exchange_businessId_replacementSaleId_idx" ON "Exchange"("businessId", "replacementSaleId");
CREATE INDEX "Exchange_businessId_refundId_idx" ON "Exchange"("businessId", "refundId");

ALTER TABLE "Exchange" ENABLE ROW LEVEL SECURITY;
