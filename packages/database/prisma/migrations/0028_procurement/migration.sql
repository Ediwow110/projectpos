-- Phase 16: procurement foundation (suppliers, product-supplier mappings,
-- purchase orders). Commercial records only: nothing here mutates inventory.
-- Entity FKs are RESTRICT so history can never be silently cascaded away;
-- order lines CASCADE with their order. RLS deny-all like every table (0017).

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "province" TEXT,
  "postalCode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'PH',
  "paymentTerms" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_businessId_code_key" ON "Supplier"("businessId", "code") WHERE "code" IS NOT NULL;
CREATE INDEX "Supplier_businessId_isActive_name_idx" ON "Supplier"("businessId", "isActive", "name");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "ProductSupplier" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierSku" TEXT,
  "unitCostMinor" INTEGER,
  "leadTimeDays" INTEGER,
  "isPreferred" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductSupplier_leadTimeDays_check" CHECK ("leadTimeDays" IS NULL OR ("leadTimeDays" >= 0 AND "leadTimeDays" <= 3650)),
  CONSTRAINT "ProductSupplier_unitCostMinor_check" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0)
);

CREATE UNIQUE INDEX "ProductSupplier_businessId_productId_supplierId_key" ON "ProductSupplier"("businessId", "productId", "supplierId");
CREATE UNIQUE INDEX "ProductSupplier_businessId_productId_preferred_key" ON "ProductSupplier"("businessId", "productId") WHERE "isPreferred";
CREATE INDEX "ProductSupplier_businessId_supplierId_idx" ON "ProductSupplier"("businessId", "supplierId");

ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductSupplier" ADD CONSTRAINT "ProductSupplier_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductSupplier" ENABLE ROW LEVEL SECURITY;

-- Per-business PO-number counter; same atomic INSERT..ON CONFLICT DO UPDATE
-- increment pattern as ReceiptCounter (0015).
CREATE TABLE "POCounter" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  CONSTRAINT "POCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "POCounter_businessId_key" ON "POCounter"("businessId");
ALTER TABLE "POCounter" ADD CONSTRAINT "POCounter_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "POCounter" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "branchId" TEXT,
  "poNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "expectedDate" TIMESTAMP(3),
  "notes" TEXT,
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "orderedBy" TEXT,
  "orderedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_version_check" CHECK ("version" >= 1),
  CONSTRAINT "PurchaseOrder_subtotalMinor_check" CHECK ("subtotalMinor" >= 0),
  CONSTRAINT "PurchaseOrder_taxMinor_check" CHECK ("taxMinor" >= 0),
  CONSTRAINT "PurchaseOrder_totalMinor_check" CHECK ("totalMinor" >= 0)
);

CREATE UNIQUE INDEX "PurchaseOrder_businessId_poNumber_key" ON "PurchaseOrder"("businessId", "poNumber");
CREATE INDEX "PurchaseOrder_businessId_status_createdAt_idx" ON "PurchaseOrder"("businessId", "status", "createdAt");
CREATE INDEX "PurchaseOrder_businessId_supplierId_idx" ON "PurchaseOrder"("businessId", "supplierId");
CREATE INDEX "PurchaseOrder_businessId_branchId_status_idx" ON "PurchaseOrder"("businessId", "branchId", "status");

ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "supplierSkuSnapshot" TEXT,
  "productNameSnapshot" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCostMinor" INTEGER NOT NULL,
  "lineTotalMinor" INTEGER NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "PurchaseOrderLine_unitCostMinor_check" CHECK ("unitCostMinor" >= 0),
  CONSTRAINT "PurchaseOrderLine_lineTotalMinor_check" CHECK ("lineTotalMinor" >= 0)
);

CREATE UNIQUE INDEX "PurchaseOrderLine_businessId_purchaseOrderId_productId_key" ON "PurchaseOrderLine"("businessId", "purchaseOrderId", "productId");
CREATE INDEX "PurchaseOrderLine_businessId_purchaseOrderId_position_idx" ON "PurchaseOrderLine"("businessId", "purchaseOrderId", "position");

ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
