CREATE TABLE "ReceiptDelivery" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotencyKey" TEXT NOT NULL,
  "errorCode" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceiptDelivery_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReceiptDelivery_businessId_idempotencyKey_key"
  ON "ReceiptDelivery"("businessId", "idempotencyKey");

CREATE INDEX "ReceiptDelivery_businessId_saleId_createdAt_idx"
  ON "ReceiptDelivery"("businessId", "saleId", "createdAt");
