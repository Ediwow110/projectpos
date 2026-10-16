-- H4-R.9: defend the order, product and branch relationships at the database boundary.
-- Number reserved after the separate 0040-0047 local development migration lines.
-- Do not amend frozen 0036-0039; migration is for isolated QA pending release gates.
-- Preserve support and stock exception history by restricting parent deletion.
CREATE UNIQUE INDEX "Order_businessId_id_key" ON "Order"("businessId","id");
CREATE UNIQUE INDEX "Product_businessId_id_key" ON "Product"("businessId","id");
CREATE UNIQUE INDEX "Branch_businessId_id_key" ON "Branch"("businessId","id");

ALTER TABLE "GuestSupportCase"
  ADD CONSTRAINT "GuestSupportCase_tenant_order_fkey"
  FOREIGN KEY ("businessId","orderId") REFERENCES "Order"("businessId","id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockException"
  ADD CONSTRAINT "StockException_tenant_product_fkey"
  FOREIGN KEY ("businessId","productId") REFERENCES "Product"("businessId","id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockException"
  ADD CONSTRAINT "StockException_tenant_branch_fkey"
  FOREIGN KEY ("businessId","branchId") REFERENCES "Branch"("businessId","id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing pattern validates ISO formatting only. Check a real calendar date too.
ALTER TABLE "StockException"
  ADD CONSTRAINT "StockException_expiresOn_calendar_date"
  CHECK ("expiresOn" IS NULL OR
    CASE WHEN "expiresOn" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN pg_input_is_valid("expiresOn", 'date')
      ELSE false
    END);

-- Guest status history queries filter both the tenant and order.
CREATE INDEX "GuestSupportCase_businessId_orderId_createdAt_idx"
  ON "GuestSupportCase"("businessId","orderId","createdAt");
