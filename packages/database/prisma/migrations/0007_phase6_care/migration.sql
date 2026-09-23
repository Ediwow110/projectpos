CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Customer_businessId_phone_key" ON "Customer"("businessId", "phone");
CREATE INDEX "Customer_businessId_isActive_idx" ON "Customer"("businessId", "isActive");
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "requestedBy" TEXT NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "approvedRequestId" TEXT NOT NULL,
  "singleStep" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Refund_businessId_saleId_idx" ON "Refund"("businessId", "saleId");
CREATE INDEX "Refund_businessId_createdAt_idx" ON "Refund"("businessId", "createdAt");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RefundItem" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "restocked" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "RefundItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefundItem_businessId_refundId_idx" ON "RefundItem"("businessId", "refundId");
CREATE INDEX "RefundItem_businessId_saleItemId_idx" ON "RefundItem"("businessId", "saleItemId");
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "description" TEXT,
  "method" TEXT NOT NULL,
  "shiftId" TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "attachmentUrl" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "cashAdjusted" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Expense_businessId_category_expenseDate_idx" ON "Expense"("businessId", "category", "expenseDate");
CREATE INDEX "Expense_businessId_expenseDate_idx" ON "Expense"("businessId", "expenseDate");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
