-- Phase 23 management ledger and supplier payables. Application services use
-- the database owner and enforce business/branch authorization. RLS remains
-- enabled with no browser-facing policies, matching migration 0017.

CREATE TABLE "AccountingAccount" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "normalSide" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingAccount_type_check" CHECK ("type" IN ('asset','liability','equity','revenue','expense')),
  CONSTRAINT "AccountingAccount_side_check" CHECK ("normalSide" IN ('debit','credit')),
  CONSTRAINT "AccountingAccount_code_check" CHECK ("code" ~ '^[0-9A-Z_-]{2,16}$')
);
CREATE UNIQUE INDEX "AccountingAccount_businessId_code_key" ON "AccountingAccount"("businessId","code");
CREATE INDEX "AccountingAccount_businessId_active_type_idx" ON "AccountingAccount"("businessId","isActive","type");
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingAccount" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "branchId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceEvent" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "reversesEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalEntry_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "JournalEntry_identity_check" CHECK (length("sourceType") > 0 AND length("sourceId") > 0 AND length("sourceEvent") > 0)
);
CREATE UNIQUE INDEX "JournalEntry_source_event_key" ON "JournalEntry"("businessId","sourceType","sourceId","sourceEvent");
CREATE UNIQUE INDEX "JournalEntry_reversesEntryId_key" ON "JournalEntry"("reversesEntryId") WHERE "reversesEntryId" IS NOT NULL;
CREATE INDEX "JournalEntry_business_date_id_idx" ON "JournalEntry"("businessId","effectiveAt" DESC,"id");
CREATE INDEX "JournalEntry_business_branch_date_idx" ON "JournalEntry"("businessId","branchId","effectiveAt" DESC);
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "debitMinor" BIGINT NOT NULL DEFAULT 0,
  "creditMinor" BIGINT NOT NULL DEFAULT 0,
  "memo" TEXT,
  "position" INTEGER NOT NULL,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalLine_amount_check" CHECK ("debitMinor" >= 0 AND "creditMinor" >= 0 AND (("debitMinor" > 0 AND "creditMinor" = 0) OR ("creditMinor" > 0 AND "debitMinor" = 0))),
  CONSTRAINT "JournalLine_position_check" CHECK ("position" >= 0)
);
CREATE UNIQUE INDEX "JournalLine_entry_position_key" ON "JournalLine"("businessId","entryId","position");
CREATE INDEX "JournalLine_business_account_entry_idx" ON "JournalLine"("businessId","accountId","entryId");
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION "reject_immutable_journal_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "JournalEntry_immutable" BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_journal_change"();
CREATE TRIGGER "JournalLine_immutable" BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_journal_change"();

CREATE FUNCTION "protect_used_account"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."isSystem" THEN
    RAISE EXCEPTION 'ACCOUNTING_SYSTEM_ACCOUNT_PROTECTED' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."isSystem" AND (NEW."code" <> OLD."code" OR NEW."type" <> OLD."type" OR NEW."normalSide" <> OLD."normalSide") THEN
    RAISE EXCEPTION 'ACCOUNTING_SYSTEM_ACCOUNT_PROTECTED' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM "JournalLine" WHERE "accountId" = OLD."id") THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_IN_USE' USING ERRCODE = '55000';
    END IF;
    IF NEW."businessId" <> OLD."businessId" OR NEW."code" <> OLD."code" OR NEW."type" <> OLD."type" OR NEW."normalSide" <> OLD."normalSide" THEN
      RAISE EXCEPTION 'ACCOUNTING_ACCOUNT_IN_USE' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AccountingAccount_protect_used" BEFORE UPDATE OR DELETE ON "AccountingAccount" FOR EACH ROW EXECUTE FUNCTION "protect_used_account"();

CREATE TABLE "SupplierBill" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "branchId" TEXT,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "invoiceAmountMinor" BIGINT NOT NULL DEFAULT 0,
  "nonStockChargeMinor" BIGINT NOT NULL DEFAULT 0,
  "paidMinor" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "postedBy" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidedAt" TIMESTAMP(3),
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierBill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBill_status_check" CHECK ("status" IN ('DRAFT','POSTED','PARTIALLY_PAID','PAID','VOIDED')),
  CONSTRAINT "SupplierBill_amount_check" CHECK ("invoiceAmountMinor" >= 0 AND "nonStockChargeMinor" >= 0 AND "paidMinor" >= 0 AND "paidMinor" <= "invoiceAmountMinor" + "nonStockChargeMinor"),
  CONSTRAINT "SupplierBill_version_check" CHECK ("version" > 0),
  CONSTRAINT "SupplierBill_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE UNIQUE INDEX "SupplierBill_business_supplier_invoice_key" ON "SupplierBill"("businessId","supplierId","invoiceNumber");
CREATE INDEX "SupplierBill_business_status_due_idx" ON "SupplierBill"("businessId","status","dueDate","createdAt");
CREATE INDEX "SupplierBill_business_supplier_created_idx" ON "SupplierBill"("businessId","supplierId","createdAt" DESC);
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBill" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierBillAllocation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitInvoiceCostMinor" BIGINT NOT NULL,
  "invoiceAmountMinor" BIGINT NOT NULL,
  "receiptCostMinorSnapshot" BIGINT NOT NULL,
  CONSTRAINT "SupplierBillAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierBillAllocation_values_check" CHECK ("quantity" > 0 AND "unitInvoiceCostMinor" >= 0 AND "invoiceAmountMinor" >= 0 AND "receiptCostMinorSnapshot" >= 0)
);
CREATE UNIQUE INDEX "SupplierBillAllocation_bill_receipt_line_key" ON "SupplierBillAllocation"("businessId","billId","receiptLineId");
CREATE INDEX "SupplierBillAllocation_business_receipt_idx" ON "SupplierBillAllocation"("businessId","receiptLineId");
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierBillAllocation" ADD CONSTRAINT "SupplierBillAllocation_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierBillAllocation" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierCredit" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "billId" TEXT,
  "supplierReturnId" TEXT NOT NULL,
  "creditNumber" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "createdBy" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierCredit_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "SupplierCredit_status_check" CHECK ("status" IN ('POSTED','APPLIED'))
);
CREATE UNIQUE INDEX "SupplierCredit_business_return_key" ON "SupplierCredit"("businessId","supplierReturnId");
CREATE INDEX "SupplierCredit_business_supplier_created_idx" ON "SupplierCredit"("businessId","supplierId","createdAt" DESC);
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierCredit" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierPayment" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "branchId" TEXT,
  "amountMinor" BIGINT NOT NULL,
  "method" TEXT NOT NULL,
  "paidFromAccountId" TEXT NOT NULL,
  "reference" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "shiftId" TEXT,
  "cashMovementId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierPayment_amount_check" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "SupplierPayment_business_idempotency_key" ON "SupplierPayment"("businessId","idempotencyKey");
CREATE INDEX "SupplierPayment_business_bill_paid_idx" ON "SupplierPayment"("businessId","billId","paidAt");
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_paidFromAccountId_fkey" FOREIGN KEY ("paidFromAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SupplierReturnReceiptAllocation" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "supplierReturnLineId" TEXT NOT NULL,
  "receiptLineId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitCostMinorSnapshot" BIGINT NOT NULL,
  CONSTRAINT "SupplierReturnReceiptAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierReturnReceiptAllocation_values_check" CHECK ("quantity" > 0 AND "unitCostMinorSnapshot" >= 0)
);
CREATE UNIQUE INDEX "SupplierReturnReceiptAllocation_return_receipt_key" ON "SupplierReturnReceiptAllocation"("businessId","supplierReturnLineId","receiptLineId");
CREATE INDEX "SupplierReturnReceiptAllocation_business_receipt_idx" ON "SupplierReturnReceiptAllocation"("businessId","receiptLineId");
ALTER TABLE "SupplierReturnReceiptAllocation" ADD CONSTRAINT "SupplierReturnReceiptAllocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnReceiptAllocation" ADD CONSTRAINT "SupplierReturnReceiptAllocation_returnLineId_fkey" FOREIGN KEY ("supplierReturnLineId") REFERENCES "SupplierReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnReceiptAllocation" ADD CONSTRAINT "SupplierReturnReceiptAllocation_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "PurchaseReceiptLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierReturnReceiptAllocation" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "AccountingBackfillRun" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "cursor" JSONB,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "debitMinor" BIGINT NOT NULL DEFAULT 0,
  "creditMinor" BIGINT NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingBackfillRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingBackfillRun_status_check" CHECK ("status" IN ('PENDING','RUNNING','PAUSED','COMPLETE','FAILED')),
  CONSTRAINT "AccountingBackfillRun_counts_check" CHECK ("processedCount" >= 0 AND "skippedCount" >= 0 AND "debitMinor" >= 0 AND "creditMinor" >= 0)
);
CREATE INDEX "AccountingBackfillRun_business_created_idx" ON "AccountingBackfillRun"("businessId","createdAt" DESC);
ALTER TABLE "AccountingBackfillRun" ADD CONSTRAINT "AccountingBackfillRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingBackfillRun" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "AccountingBackfillIssue" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingBackfillIssue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingBackfillIssue_source_key" ON "AccountingBackfillIssue"("businessId","sourceType","sourceId","reason");
CREATE INDEX "AccountingBackfillIssue_business_run_idx" ON "AccountingBackfillIssue"("businessId","runId");
ALTER TABLE "AccountingBackfillIssue" ADD CONSTRAINT "AccountingBackfillIssue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingBackfillIssue" ADD CONSTRAINT "AccountingBackfillIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AccountingBackfillRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingBackfillIssue" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "AccountingActivation" (
  "businessId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "accountingStartAt" TIMESTAMP(3),
  "openingEntryId" TEXT,
  "csvCutoverAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingActivation_pkey" PRIMARY KEY ("businessId"),
  CONSTRAINT "AccountingActivation_status_check" CHECK ("status" IN ('NOT_STARTED','BACKFILLING','REVIEW','ACTIVE'))
);
ALTER TABLE "AccountingActivation" ADD CONSTRAINT "AccountingActivation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingActivation" ADD CONSTRAINT "AccountingActivation_openingEntryId_fkey" FOREIGN KEY ("openingEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingActivation" ENABLE ROW LEVEL SECURITY;
