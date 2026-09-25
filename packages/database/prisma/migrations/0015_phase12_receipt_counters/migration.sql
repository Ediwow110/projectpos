-- Phase 12: per-business receipt-number counters. The memory store keeps this
-- sequence in a Map; PostgreSQL needs a row so the sequence survives across
-- processes and increments atomically (INSERT ... ON CONFLICT DO UPDATE).
CREATE TABLE "ReceiptCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReceiptCounter_businessId_key" ON "ReceiptCounter"("businessId");
ALTER TABLE "ReceiptCounter" ADD CONSTRAINT "ReceiptCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
