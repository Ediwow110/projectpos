ALTER TABLE "GiftCardTransaction" ADD COLUMN "loadId" TEXT;
CREATE INDEX "GiftCardTransaction_businessId_loadId_idx" ON "GiftCardTransaction"("businessId", "loadId");
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "SaleGiftCardLoad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GiftCardTransaction" ENABLE ROW LEVEL SECURITY;
