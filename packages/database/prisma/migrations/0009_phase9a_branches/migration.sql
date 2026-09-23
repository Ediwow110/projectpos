CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'store',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_businessId_name_key" ON "Branch"("businessId", "name");
CREATE INDEX "Branch_businessId_idx" ON "Branch"("businessId");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockTransfer" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "fromBranchId" TEXT NOT NULL,
  "toBranchId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "requestedBy" TEXT NOT NULL,
  "dispatchedBy" TEXT,
  "receivedBy" TEXT,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockTransfer_businessId_status_createdAt_idx" ON "StockTransfer"("businessId", "status", "createdAt");
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StockTransferLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "transferId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockTransferLine_businessId_transferId_idx" ON "StockTransferLine"("businessId", "transferId");
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey"
  FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Register" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Shift" ADD COLUMN "branchId" TEXT;
ALTER TABLE "CashMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryBalance" ADD COLUMN "branchId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "branchId" TEXT;
ALTER TABLE "Register" ADD CONSTRAINT "Register_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
