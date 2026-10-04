-- Phase 18: first-class physical stock counts. Additive only; the existing
-- append-only InventoryMovement ledger remains authoritative for corrections.

CREATE TABLE "InventoryCountCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  CONSTRAINT "InventoryCountCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryCountCounter_businessId_key" ON "InventoryCountCounter"("businessId");
ALTER TABLE "InventoryCountCounter" ADD CONSTRAINT "InventoryCountCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCountCounter" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "InventoryCount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "branchId" TEXT,
  "countNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "scopeType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvalFingerprint" TEXT,
  "postedBy" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCount_status_check" CHECK ("status" IN ('DRAFT','COUNTING','SUBMITTED','APPROVED','POSTED','CANCELLED')),
  CONSTRAINT "InventoryCount_scopeType_check" CHECK ("scopeType" IN ('FULL','PARTIAL')),
  CONSTRAINT "InventoryCount_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "InventoryCount_businessId_countNumber_key" ON "InventoryCount"("businessId", "countNumber");
CREATE INDEX "InventoryCount_businessId_status_createdAt_idx" ON "InventoryCount"("businessId", "status", "createdAt");
CREATE INDEX "InventoryCount_businessId_branchId_status_idx" ON "InventoryCount"("businessId", "branchId", "status");
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCount" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "InventoryCountLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "inventoryCountId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "expectedQtySnapshot" INTEGER NOT NULL,
  "balanceUpdatedAtSnapshot" TIMESTAMP(3),
  "countedQty" INTEGER,
  "varianceQty" INTEGER,
  "productNameSnapshot" TEXT NOT NULL,
  "skuSnapshot" TEXT,
  "notes" TEXT,
  "countedBy" TEXT,
  "countedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCountLine_expectedQty_check" CHECK ("expectedQtySnapshot" >= 0),
  CONSTRAINT "InventoryCountLine_countedQty_check" CHECK ("countedQty" IS NULL OR "countedQty" >= 0),
  CONSTRAINT "InventoryCountLine_variance_check" CHECK (("countedQty" IS NULL AND "varianceQty" IS NULL) OR ("countedQty" IS NOT NULL AND "varianceQty" = "countedQty" - "expectedQtySnapshot"))
);
CREATE UNIQUE INDEX "InventoryCountLine_businessId_count_product_key" ON "InventoryCountLine"("businessId", "inventoryCountId", "productId");
CREATE INDEX "InventoryCountLine_businessId_count_idx" ON "InventoryCountLine"("businessId", "inventoryCountId");
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_count_fkey"
  FOREIGN KEY ("inventoryCountId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_product_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCountLine" ENABLE ROW LEVEL SECURITY;
