CREATE TABLE "CustomerConcern" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "branchId" TEXT,
  "registerId" TEXT,
  "requesterId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "note" TEXT,
  "items" JSONB NOT NULL,
  "requestedRefundMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "refundId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerConcern_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerConcern_refund_nonnegative" CHECK ("requestedRefundMinor" >= 0),
  CONSTRAINT "CustomerConcern_items_array" CHECK (jsonb_typeof("items") = 'array'),
  CONSTRAINT "CustomerConcern_status_check" CHECK ("status" IN ('PENDING', 'OWNER_REVIEW', 'APPROVED', 'REJECTED', 'REFUND_EXECUTED', 'RESOLVED')),
  CONSTRAINT "CustomerConcern_outcome_check" CHECK ("outcome" IN ('REFUND', 'EXCHANGE'))
);
CREATE UNIQUE INDEX "CustomerConcern_businessId_idempotencyKey_key" ON "CustomerConcern"("businessId", "idempotencyKey");
CREATE INDEX "CustomerConcern_businessId_status_createdAt_idx" ON "CustomerConcern"("businessId", "status", "createdAt");
CREATE INDEX "CustomerConcern_businessId_saleId_createdAt_idx" ON "CustomerConcern"("businessId", "saleId", "createdAt");
ALTER TABLE "CustomerConcern" ADD CONSTRAINT "CustomerConcern_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerConcern" ADD CONSTRAINT "CustomerConcern_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerConcern" ENABLE ROW LEVEL SECURITY;
