-- Phase 20: append-only customer-value ledgers. Stored value is never
-- represented by inventory balances or movements.

ALTER TABLE "Payment" ADD COLUMN "internalInstrumentType" TEXT;
ALTER TABLE "Payment" ADD COLUMN "internalInstrumentId" TEXT;
CREATE INDEX "Payment_businessId_internalInstrumentType_internalInstrumentId_idx"
  ON "Payment"("businessId", "internalInstrumentType", "internalInstrumentId");

CREATE TABLE "GiftCard" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codePrefix" TEXT NOT NULL,
  "codeLast4" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "suspendedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftCard_businessId_codeHash_key" ON "GiftCard"("businessId", "codeHash");
CREATE INDEX "GiftCard_businessId_status_createdAt_idx" ON "GiftCard"("businessId", "status", "createdAt");
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCard" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "GiftCardTransaction" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "giftCardId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountDeltaMinor" INTEGER NOT NULL,
  "saleId" TEXT,
  "refundId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "branchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftCardTransaction_businessId_idempotencyKey_key" ON "GiftCardTransaction"("businessId", "idempotencyKey");
CREATE INDEX "GiftCardTransaction_businessId_giftCardId_createdAt_idx" ON "GiftCardTransaction"("businessId", "giftCardId", "createdAt");
CREATE INDEX "GiftCardTransaction_businessId_saleId_idx" ON "GiftCardTransaction"("businessId", "saleId");
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftCardTransaction" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "StoreCreditAccount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreCreditAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreCreditAccount_businessId_customerId_key" ON "StoreCreditAccount"("businessId", "customerId");
CREATE INDEX "StoreCreditAccount_businessId_customerId_idx" ON "StoreCreditAccount"("businessId", "customerId");
ALTER TABLE "StoreCreditAccount" ADD CONSTRAINT "StoreCreditAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCreditAccount" ADD CONSTRAINT "StoreCreditAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreCreditAccount" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "StoreCreditTransaction" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountDeltaMinor" INTEGER NOT NULL,
  "saleId" TEXT,
  "refundId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "branchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreCreditTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StoreCreditTransaction_businessId_idempotencyKey_key" ON "StoreCreditTransaction"("businessId", "idempotencyKey");
CREATE INDEX "StoreCreditTransaction_businessId_accountId_createdAt_idx" ON "StoreCreditTransaction"("businessId", "accountId", "createdAt");
CREATE INDEX "StoreCreditTransaction_businessId_customerId_idx" ON "StoreCreditTransaction"("businessId", "customerId");
ALTER TABLE "StoreCreditTransaction" ADD CONSTRAINT "StoreCreditTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreCreditTransaction" ADD CONSTRAINT "StoreCreditTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "StoreCreditAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoreCreditTransaction" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "LoyaltyProgram" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "earnAmountMinor" INTEGER NOT NULL DEFAULT 100,
  "earnPoints" INTEGER NOT NULL DEFAULT 1,
  "redeemPoints" INTEGER NOT NULL DEFAULT 100,
  "redeemValueMinor" INTEGER NOT NULL DEFAULT 100,
  "minimumRedeemPoints" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyProgram_businessId_key" ON "LoyaltyProgram"("businessId");
ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyProgram" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "LoyaltyAccount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyAccount_businessId_customerId_key" ON "LoyaltyAccount"("businessId", "customerId");
CREATE INDEX "LoyaltyAccount_businessId_customerId_idx" ON "LoyaltyAccount"("businessId", "customerId");
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "LoyaltyTransaction" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "pointsDelta" INTEGER NOT NULL,
  "valueMinorSnapshot" INTEGER,
  "saleId" TEXT,
  "refundId" TEXT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyTransaction_businessId_idempotencyKey_key" ON "LoyaltyTransaction"("businessId", "idempotencyKey");
CREATE INDEX "LoyaltyTransaction_businessId_accountId_createdAt_idx" ON "LoyaltyTransaction"("businessId", "accountId", "createdAt");
CREATE INDEX "LoyaltyTransaction_businessId_customerId_idx" ON "LoyaltyTransaction"("businessId", "customerId");
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SaleGiftCardLoad" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "giftCardId" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleGiftCardLoad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleGiftCardLoad_businessId_saleId_idx" ON "SaleGiftCardLoad"("businessId", "saleId");
CREATE INDEX "SaleGiftCardLoad_businessId_giftCardId_idx" ON "SaleGiftCardLoad"("businessId", "giftCardId");
ALTER TABLE "SaleGiftCardLoad" ADD CONSTRAINT "SaleGiftCardLoad_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleGiftCardLoad" ADD CONSTRAINT "SaleGiftCardLoad_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleGiftCardLoad" ADD CONSTRAINT "SaleGiftCardLoad_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleGiftCardLoad" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SaleLoyalty" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "loyaltyAccountId" TEXT NOT NULL,
  "programVersion" INTEGER NOT NULL,
  "eligibleSpendMinor" INTEGER NOT NULL,
  "earnedPoints" INTEGER NOT NULL,
  "redeemedPoints" INTEGER NOT NULL,
  "redeemedValueMinor" INTEGER NOT NULL,
  "earnAmountMinorSnapshot" INTEGER NOT NULL,
  "earnPointsSnapshot" INTEGER NOT NULL,
  "redeemPointsSnapshot" INTEGER NOT NULL,
  "redeemValueMinorSnapshot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleLoyalty_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleLoyalty_saleId_key" ON "SaleLoyalty"("saleId");
CREATE INDEX "SaleLoyalty_businessId_customerId_idx" ON "SaleLoyalty"("businessId", "customerId");
ALTER TABLE "SaleLoyalty" ADD CONSTRAINT "SaleLoyalty_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleLoyalty" ADD CONSTRAINT "SaleLoyalty_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleLoyalty" ADD CONSTRAINT "SaleLoyalty_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleLoyalty" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SaleItemLoyaltyAllocation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleLoyaltyId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "earnedPoints" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleItemLoyaltyAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleItemLoyaltyAllocation_businessId_saleLoyaltyId_saleItemId_key" ON "SaleItemLoyaltyAllocation"("businessId", "saleLoyaltyId", "saleItemId");
CREATE INDEX "SaleItemLoyaltyAllocation_businessId_saleItemId_idx" ON "SaleItemLoyaltyAllocation"("businessId", "saleItemId");
ALTER TABLE "SaleItemLoyaltyAllocation" ADD CONSTRAINT "SaleItemLoyaltyAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItemLoyaltyAllocation" ADD CONSTRAINT "SaleItemLoyaltyAllocation_saleLoyaltyId_fkey" FOREIGN KEY ("saleLoyaltyId") REFERENCES "SaleLoyalty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItemLoyaltyAllocation" ENABLE ROW LEVEL SECURITY;
