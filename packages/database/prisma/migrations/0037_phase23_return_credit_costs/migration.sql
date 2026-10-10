ALTER TABLE "SupplierReturnReceiptAllocation"
  ADD COLUMN "billedQuantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "billedInvoiceCostMinorSnapshot" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "SupplierReturnReceiptAllocation"
  ADD CONSTRAINT "SupplierReturnReceiptAllocation_billed_values_check"
  CHECK ("billedQuantity" >= 0 AND "billedQuantity" <= "quantity" AND "billedInvoiceCostMinorSnapshot" >= 0);
