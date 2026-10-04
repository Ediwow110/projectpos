-- Phase 17: purchase-order receipts and supplier returns.
-- Additive only. Existing Phase 16 suppliers, POs, and PO lines remain intact.

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_status_check"
  CHECK ("status" IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'));

CREATE TABLE "PurchaseReceiptCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  CONSTRAINT "PurchaseReceiptCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseReceiptCounter_businessId_key" ON "PurchaseReceiptCounter"("businessId");
ALTER TABLE "PurchaseReceiptCounter" ADD CONSTRAINT "PurchaseReceiptCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptCounter" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "branchId" TEXT,
  "receiptNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "receivedBy" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseReceipt_businessId_receiptNumber_key" ON "PurchaseReceipt"("businessId", "receiptNumber");
CREATE INDEX "PurchaseReceipt_businessId_purchaseOrderId_createdAt_idx" ON "PurchaseReceipt"("businessId", "purchaseOrderId", "createdAt");
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceipt" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "PurchaseReceiptLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purchaseReceiptId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantityReceived" INTEGER NOT NULL,
  "unitCostMinorSnapshot" INTEGER NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "supplierSkuSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseReceiptLine_quantity_check" CHECK ("quantityReceived" > 0),
  CONSTRAINT "PurchaseReceiptLine_unitCostMinorSnapshot_check" CHECK ("unitCostMinorSnapshot" >= 0)
);
CREATE INDEX "PurchaseReceiptLine_businessId_purchaseReceiptId_idx" ON "PurchaseReceiptLine"("businessId", "purchaseReceiptId");
CREATE INDEX "PurchaseReceiptLine_businessId_purchaseOrderLineId_idx" ON "PurchaseReceiptLine"("businessId", "purchaseOrderLineId");
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseReceiptId_fkey"
  FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseReceiptLine" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierReturnCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  CONSTRAINT "SupplierReturnCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierReturnCounter_businessId_key" ON "SupplierReturnCounter"("businessId");
ALTER TABLE "SupplierReturnCounter" ADD CONSTRAINT "SupplierReturnCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnCounter" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierReturn" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "branchId" TEXT,
  "returnNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "postedBy" TEXT,
  "postedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierReturn_version_check" CHECK ("version" >= 1),
  CONSTRAINT "SupplierReturn_status_check" CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "SupplierReturn_businessId_returnNumber_key" ON "SupplierReturn"("businessId", "returnNumber");
CREATE INDEX "SupplierReturn_businessId_purchaseOrderId_createdAt_idx" ON "SupplierReturn"("businessId", "purchaseOrderId", "createdAt");
CREATE INDEX "SupplierReturn_businessId_status_createdAt_idx" ON "SupplierReturn"("businessId", "status", "createdAt");
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturn" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierReturnLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierReturnId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCostMinorSnapshot" INTEGER NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "supplierSkuSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierReturnLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierReturnLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "SupplierReturnLine_unitCostMinorSnapshot_check" CHECK ("unitCostMinorSnapshot" >= 0)
);
CREATE INDEX "SupplierReturnLine_businessId_supplierReturnId_idx" ON "SupplierReturnLine"("businessId", "supplierReturnId");
CREATE INDEX "SupplierReturnLine_businessId_purchaseOrderLineId_idx" ON "SupplierReturnLine"("businessId", "purchaseOrderLineId");
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_supplierReturnId_fkey"
  FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnLine" ENABLE ROW LEVEL SECURITY;
