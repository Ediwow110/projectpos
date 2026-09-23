CREATE TABLE "Sale" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "paidMinor" INTEGER NOT NULL DEFAULT 0,
  "changeMinor" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "customerId" TEXT,
  "customerName" TEXT,
  "notes" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sale_businessId_receiptNo_key" ON "Sale"("businessId", "receiptNo");
CREATE UNIQUE INDEX "Sale_businessId_idempotencyKey_key" ON "Sale"("businessId", "idempotencyKey");
CREATE INDEX "Sale_businessId_status_createdAt_idx" ON "Sale"("businessId", "status", "createdAt");
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SaleItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'pc',
  "qty" INTEGER NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "costMinor" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER,
  "lineDiscountMinor" INTEGER NOT NULL DEFAULT 0,
  "lineTotalMinor" INTEGER NOT NULL,
  CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleItem_businessId_saleId_idx" ON "SaleItem"("businessId", "saleId");
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
  "providerRef" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_businessId_idempotencyKey_key" ON "Payment"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "Payment_businessId_providerRef_key" ON "Payment"("businessId", "providerRef");
CREATE INDEX "Payment_businessId_saleId_idx" ON "Payment"("businessId", "saleId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HeldSale" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  CONSTRAINT "HeldSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HeldSale_businessId_actorId_idx" ON "HeldSale"("businessId", "actorId");
ALTER TABLE "HeldSale" ADD CONSTRAINT "HeldSale_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SaleIdempotency" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "commandType" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleIdempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleIdempotency_businessId_key_commandType_key" ON "SaleIdempotency"("businessId", "key", "commandType");
ALTER TABLE "SaleIdempotency" ADD CONSTRAINT "SaleIdempotency_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
