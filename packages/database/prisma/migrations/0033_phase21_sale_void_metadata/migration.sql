-- Phase 21: retain the reason and timestamp for an audited sale void.
ALTER TABLE "Sale" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "voidReason" TEXT;

