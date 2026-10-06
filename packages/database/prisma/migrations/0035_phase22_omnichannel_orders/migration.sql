-- Phase 22: customer commerce intent, inventory reservations and fulfillment.
-- Financial truth remains in Sale/Payment/Refund; reservations never move stock.

ALTER TABLE "Business" ADD COLUMN "storefrontKey" TEXT;
CREATE UNIQUE INDEX "Business_storefrontKey_key" ON "Business"("storefrontKey");

ALTER TABLE "Sale" ADD COLUMN "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD COLUMN "deliveryTaxMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN "deliveryFeeRefundMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN "deliveryTaxRefundMinor" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "fulfillmentMode" TEXT NOT NULL,
  "paymentMode" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "deliveryAddress" JSONB,
  "fulfillmentInstructions" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
  "deliveryTaxMinor" INTEGER NOT NULL DEFAULT 0,
  "totalMinor" INTEGER NOT NULL DEFAULT 0,
  "saleId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "checkoutAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Order_saleId_key" ON "Order"("saleId");
CREATE INDEX "Order_businessId_createdAt_id_idx" ON "Order"("businessId", "createdAt", "id");
CREATE INDEX "Order_businessId_status_createdAt_idx" ON "Order"("businessId", "status", "createdAt");
CREATE INDEX "Order_businessId_branchId_createdAt_idx" ON "Order"("businessId", "branchId", "createdAt");
CREATE INDEX "Order_businessId_channel_createdAt_idx" ON "Order"("businessId", "channel", "createdAt");
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "OrderLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "productId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "barcode" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'pc',
  "qty" INTEGER NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "costMinor" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER,
  "discountMinor" INTEGER NOT NULL DEFAULT 0,
  "taxMinor" INTEGER NOT NULL DEFAULT 0,
  "lineTotalMinor" INTEGER NOT NULL,
  "bundleComponentsSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderLine_businessId_orderId_position_key" ON "OrderLine"("businessId", "orderId", "position");
CREATE INDEX "OrderLine_businessId_orderId_idx" ON "OrderLine"("businessId", "orderId");
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'HELD',
  "expiresAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryReservation_businessId_idempotencyKey_key" ON "InventoryReservation"("businessId", "idempotencyKey");
CREATE INDEX "InventoryReservation_businessId_branchId_productId_status_expiresAt_idx"
  ON "InventoryReservation"("businessId", "branchId", "productId", "status", "expiresAt");
CREATE INDEX "InventoryReservation_businessId_orderId_status_idx"
  ON "InventoryReservation"("businessId", "orderId", "status");
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "Fulfillment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "branchId" TEXT NOT NULL,
  "assignedUserId" TEXT,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "deliveryAddress" JSONB,
  "instructions" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "readyAt" TIMESTAMP(3),
  "dispatchedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "collectedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Fulfillment_businessId_orderId_status_idx" ON "Fulfillment"("businessId", "orderId", "status");
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Fulfillment" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "FulfillmentLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "orderLineId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FulfillmentLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FulfillmentLine_businessId_fulfillmentId_orderLineId_key"
  ON "FulfillmentLine"("businessId", "fulfillmentId", "orderLineId");
CREATE INDEX "FulfillmentLine_businessId_fulfillmentId_idx" ON "FulfillmentLine"("businessId", "fulfillmentId");
ALTER TABLE "FulfillmentLine" ADD CONSTRAINT "FulfillmentLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FulfillmentLine" ADD CONSTRAINT "FulfillmentLine_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FulfillmentLine" ADD CONSTRAINT "FulfillmentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FulfillmentLine" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "OrderAccessToken" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderAccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderAccessToken_tokenHash_key" ON "OrderAccessToken"("tokenHash");
CREATE INDEX "OrderAccessToken_businessId_orderId_kind_revokedAt_expiresAt_idx"
  ON "OrderAccessToken"("businessId", "orderId", "kind", "revokedAt", "expiresAt");
ALTER TABLE "OrderAccessToken" ADD CONSTRAINT "OrderAccessToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAccessToken" ADD CONSTRAINT "OrderAccessToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderAccessToken" ENABLE ROW LEVEL SECURITY;
