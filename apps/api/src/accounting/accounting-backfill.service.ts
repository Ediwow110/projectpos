import type { DbAccountingBackfillRun, DbInventoryCount, DbMovement, DbPort, DbPurchaseReceipt, DbRefund, DbSupplierBill, DbSupplierReturn } from "../common/db.port";
import { accountForMethod, buildExpenseDraft, buildPurchaseReceiptDraft, buildRefundDraft, buildSaleDraft, buildSupplierBillDraft, buildSupplierPaymentDraft, buildSupplierReturnDraft, validateJournalDraft } from "./journal-rules";
import { JournalPostingService } from "./journal-posting.service";

const PAGE_SIZE = 100;
type BackfillFamily = "sales" | "expenses" | "refunds" | "purchase-receipts" | "supplier-returns" | "supplier-bills" | "inventory-counts" | "inventory-movements" | "remaining";

export class AccountingBackfillService {
  constructor(private readonly db: DbPort) {}

  async start(input: { businessId: string; actorId: string; requestId: string }): Promise<DbAccountingBackfillRun> {
    const business = await this.db.findBusinessById(input.businessId);
    if (!business) throw new Error("NOT_FOUND");
    return this.db.withLock(`accounting-backfill:${input.businessId}`, async () => this.db.withTransaction(async (tx) => {
      const replay = await tx.findAccountingBackfillRunByRequest(input.businessId, input.requestId);
      if (replay) return replay;
      const activation = await tx.findAccountingActivation(input.businessId);
      if (activation && !["NOT_STARTED", "REVIEW", "BACKFILLING"].includes(activation.status)) throw new Error("ACCOUNTING_ACTIVATION_IN_PROGRESS");
      const run = await tx.createAccountingBackfillRun({
        businessId: input.businessId, status: "RUNNING", cursor: { family: "sales", afterId: null },
        processedCount: 0, skippedCount: 0, debitMinor: 0, creditMinor: 0, startedAt: new Date(), completedAt: null,
        createdBy: input.actorId, requestId: input.requestId,
      });
      await tx.saveAccountingActivation({
        businessId: input.businessId, status: "BACKFILLING", accountingStartAt: activation?.accountingStartAt ?? null,
        openingEntryId: activation?.openingEntryId ?? null, csvCutoverAt: null,
      });
      return run;
    }));
  }

  async runBatch(input: { businessId: string; runId: string; actorId: string; requestId: string; expectedCursor?: { family: string; afterId: string | null } }): Promise<DbAccountingBackfillRun> {
    await new JournalPostingService(this.db).seedChart(input.businessId);
    return this.db.withLock(`accounting-backfill-run:${input.businessId}:${input.runId}`, async () => this.db.withTransaction(async (tx) => {
      const run = await tx.findAccountingBackfillRun(input.runId, input.businessId);
      if (!run) throw new Error("NOT_FOUND");
      if (run.status === "COMPLETE" || run.status === "FAILED") return run;
      if (input.expectedCursor && (run.cursor?.family !== input.expectedCursor.family || (run.cursor?.afterId ?? null) !== input.expectedCursor.afterId)) return run;
      const family = (run.cursor?.family ?? "sales") as BackfillFamily;
      if (family === "remaining") {
        const [hasValueAdjustments, activation] = await Promise.all([
          tx.hasUnaccountedValueAdjustments(input.businessId),
          tx.findAccountingActivation(input.businessId),
        ]);
        if (hasValueAdjustments) await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType: "StoredValue", sourceId: input.businessId, reason: "standalone_value_adjustment_counter_account_missing" });
        const issueCount = await tx.countAccountingBackfillIssues(run.id, input.businessId);
        const ready = issueCount === 0 && Boolean(activation?.openingEntryId && activation.accountingStartAt);
        if (ready) {
          await tx.saveAccountingActivation({ businessId: input.businessId, status: "ACTIVE", accountingStartAt: activation!.accountingStartAt, openingEntryId: activation!.openingEntryId, csvCutoverAt: activation!.csvCutoverAt });
        }
        return (await tx.updateAccountingBackfillRun(run.id, input.businessId, { status: ready ? "COMPLETE" : "PAUSED", completedAt: new Date() }))!;
      }
      const afterId = run.cursor?.afterId ?? null;
      const page = family === "sales"
        ? await tx.listSalesPage(input.businessId, afterId, PAGE_SIZE)
        : family === "expenses"
          ? await tx.listExpensesPage(input.businessId, afterId, PAGE_SIZE)
          : family === "refunds"
            ? await tx.listRefundsPage(input.businessId, afterId, PAGE_SIZE)
            : family === "purchase-receipts"
              ? await tx.listPurchaseReceiptsPage(input.businessId, afterId, PAGE_SIZE)
              : family === "supplier-returns"
                ? await tx.listSupplierReturnsPage(input.businessId, afterId, PAGE_SIZE)
              : family === "supplier-bills"
                ? await tx.listSupplierBillsPage(input.businessId, afterId, PAGE_SIZE)
                : family === "inventory-counts"
                  ? await tx.listInventoryCountsPage(input.businessId, afterId, PAGE_SIZE)
                  : await tx.listMovementsPage(input.businessId, afterId, PAGE_SIZE);
      let processedCount = run.processedCount;
      let skippedCount = run.skippedCount;
      let debitMinor = run.debitMinor;
      let creditMinor = run.creditMinor;
      const business = await tx.findBusinessById(input.businessId);
      if (!business) throw new Error("NOT_FOUND");
      const journals = new JournalPostingService(tx);

      for (const source of page) {
        const sourceType = family === "sales" ? "Sale" : family === "expenses" ? "Expense" : family === "refunds" ? "Refund" : family === "purchase-receipts" ? "PurchaseReceipt" : family === "supplier-returns" ? "SupplierReturn" : family === "supplier-bills" ? "SupplierBill" : family === "inventory-counts" ? "InventoryCount" : "InventoryMovement";
        const sourceEvent = family === "sales" ? "completed" : family === "expenses" ? "posted" : family === "refunds" ? "approved" : family === "purchase-receipts" ? "posted" : family === "supplier-returns" ? "posted" : family === "supplier-bills" ? "posted" : family === "inventory-counts" ? "posted" : "created";
        const existing = await tx.findJournalEntryBySource(input.businessId, sourceType, source.id, sourceEvent);
        if (existing && family !== "supplier-bills") continue;
        if (family === "supplier-bills") {
          const bill = source as DbSupplierBill;
          if (bill.status !== "DRAFT" && !bill.voidedAt && !existing) {
            const allocations = await tx.listSupplierBillAllocations(bill.id, input.businessId);
            if (!allocations.length) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: bill.id, reason: "supplier_bill_allocations_missing" });
              skippedCount += 1;
            } else {
              const receiptCostMinor = allocations.reduce((sum, row) => sum + row.receiptCostMinorSnapshot, 0);
              const draft = buildSupplierBillDraft({ currency: business.currency, receiptCostMinor, invoiceAmountMinor: bill.invoiceAmountMinor, nonStockChargeMinor: bill.nonStockChargeMinor, effectiveAt: bill.postedAt ?? bill.createdAt });
              const amounts = validateJournalDraft(draft);
              await journals.postSourceEvent({ businessId: input.businessId, branchId: bill.branchId, sourceType, sourceId: bill.id, sourceEvent, draft, actorId: bill.postedBy ?? bill.createdBy, requestId: bill.requestId });
              debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
              processedCount += 1;
            }
          }
          const accounts = await tx.listAccountingAccounts(input.businessId);
          const accountCodeById = new Map(accounts.map((account) => [account.id, account.code]));
          const payments = await tx.listSupplierPayments(bill.id, input.businessId);
          for (const payment of payments) {
            if (await tx.findJournalEntryBySource(input.businessId, "SupplierPayment", payment.id, "paid")) continue;
            const paidFromAccountCode = accountCodeById.get(payment.paidFromAccountId);
            if (!paidFromAccountCode) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType: "SupplierPayment", sourceId: payment.id, reason: "supplier_payment_account_missing" });
              skippedCount += 1;
              continue;
            }
            const draft = buildSupplierPaymentDraft({ currency: business.currency, amountMinor: payment.amountMinor, paidFromAccountCode, effectiveAt: payment.paidAt });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: payment.branchId, sourceType: "SupplierPayment", sourceId: payment.id, sourceEvent: "paid", draft, actorId: payment.createdBy, requestId: payment.requestId });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
            processedCount += 1;
          }
          continue;
        }
        if (family === "inventory-movements") {
          const movement = source as DbMovement;
          if (["Sale", "PurchaseReceipt", "SupplierReturn", "InventoryCount", "StockTransfer"].includes(movement.referenceType ?? "")) continue;
          await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: movement.id, reason: "historical_movement_cost_unavailable" });
          skippedCount += 1;
          continue;
        }
        if (family === "inventory-counts") {
          const count = source as DbInventoryCount;
          if (count.status !== "POSTED") continue;
          await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: count.id, reason: "historical_count_cost_unavailable" });
          skippedCount += 1;
          continue;
        }
        try {
          if (family === "sales") {
            const sale = source as Awaited<ReturnType<DbPort["findSaleById"]>>;
            if (!sale || sale.status !== "COMPLETED" || sale.voidedAt) { skippedCount += 1; continue; }
            const [payments, items, loads] = await Promise.all([
              tx.listPaymentsBySale(sale.id, input.businessId), tx.listSaleItems(sale.id, input.businessId), tx.listSaleGiftCardLoads(sale.id, input.businessId),
            ]);
            const saleLoyalty = await tx.findSaleLoyalty(sale.id, input.businessId);
            let loyaltyIssuedMinor = 0;
            if (saleLoyalty?.earnedPoints) {
              if (!Number.isSafeInteger(saleLoyalty.earnedPoints) || !Number.isSafeInteger(saleLoyalty.redeemValueMinorSnapshot)
                || !Number.isSafeInteger(saleLoyalty.redeemPointsSnapshot) || saleLoyalty.redeemPointsSnapshot <= 0) {
                throw new Error("ACCOUNTING_INVALID_AMOUNT");
              }
              loyaltyIssuedMinor = Math.floor(saleLoyalty.earnedPoints * saleLoyalty.redeemValueMinorSnapshot / saleLoyalty.redeemPointsSnapshot);
              if (!Number.isSafeInteger(loyaltyIssuedMinor) || loyaltyIssuedMinor < 0) throw new Error("ACCOUNTING_INVALID_AMOUNT");
            }
            const tenders = payments.filter((payment) => !["FAILED", "VOIDED", "CANCELLED", "REFUNDED"].includes(payment.status.toUpperCase())).map(({ method, amountMinor }) => ({ method, amountMinor }));
            if (tenders.length === 0) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType: "Sale", sourceId: sale.id, reason: "completed_sale_payments_missing" });
              skippedCount += 1; continue;
            }
            const draft = buildSaleDraft({
              currency: business.currency, effectiveAt: sale.completedAt ?? sale.createdAt, tenders,
              merchandiseRevenueMinor: sale.subtotalMinor, discountMinor: sale.discountMinor,
              deliveryFeeMinor: sale.deliveryFeeMinor, taxPayableMinor: sale.taxMinor + sale.deliveryTaxMinor,
              giftCardLoadMinor: loads.reduce((sum, load) => sum + load.amountMinor, 0),
              loyaltyIssuedMinor,
              changeMinor: sale.changeMinor,
              cogsMinor: items.reduce((sum, item) => sum + item.qty * item.costMinor, 0),
            });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: sale.branchId ?? null, sourceType: "Sale", sourceId: sale.id, sourceEvent: "completed", draft, actorId: sale.actorId, requestId: sale.requestId });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
          } else if (family === "expenses") {
            const expense = source as Awaited<ReturnType<DbPort["findExpenseById"]>>;
            if (!expense || expense.voidedAt) { skippedCount += 1; continue; }
            const draft = buildExpenseDraft({ currency: business.currency, effectiveAt: expense.expenseDate, amountMinor: expense.amountMinor, expenseAccountCode: "6000", paidFromAccountCode: accountForMethod(expense.method) });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: expense.branchId ?? null, sourceType: "Expense", sourceId: expense.id, sourceEvent: "posted", draft, actorId: expense.actorId, requestId: expense.requestId });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
          } else if (family === "refunds") {
            const refund = source as DbRefund;
            if (refund.status !== "APPROVED") { skippedCount += 1; continue; }
            const sale = await tx.findSaleById(refund.saleId, input.businessId);
            if (!sale) throw new Error("ACCOUNTING_SOURCE_NOT_FOUND");
            const [refundItems, saleItems, payments] = await Promise.all([
              tx.listRefundItems(refund.id, input.businessId), tx.listSaleItems(sale.id, input.businessId), tx.listPaymentsBySale(sale.id, input.businessId),
            ]);
            const saleLoyalty = await tx.findSaleLoyalty(sale.id, input.businessId);
            const loyaltyRows = saleLoyalty ? await tx.listLoyaltyTransactions(saleLoyalty.loyaltyAccountId, input.businessId) : [];
            const reversedLoyaltyPoints = loyaltyRows.filter((row) => row.saleId === sale.id && row.refundId === refund.id && row.type === "REFUND_EARN_REVERSAL")
              .reduce((sum, row) => sum + Math.abs(row.pointsDelta), 0);
            let loyaltyLiabilityMinor = 0;
            if (reversedLoyaltyPoints > 0) {
              if (!saleLoyalty || !Number.isSafeInteger(reversedLoyaltyPoints) || !Number.isSafeInteger(saleLoyalty.redeemValueMinorSnapshot)
                || !Number.isSafeInteger(saleLoyalty.redeemPointsSnapshot) || saleLoyalty.redeemPointsSnapshot <= 0) {
                throw new Error("ACCOUNTING_INVALID_AMOUNT");
              }
              loyaltyLiabilityMinor = Math.floor(reversedLoyaltyPoints * saleLoyalty.redeemValueMinorSnapshot / saleLoyalty.redeemPointsSnapshot);
              if (!Number.isSafeInteger(loyaltyLiabilityMinor) || loyaltyLiabilityMinor < 0) throw new Error("ACCOUNTING_INVALID_AMOUNT");
            }
            const saleItemById = new Map(saleItems.map((item) => [item.id, item]));
            const merchandiseRefundMinor = refundItems.reduce((sum, item) => sum + item.amountMinor, 0);
            const giftCardLiabilityMinor = refund.totalMinor - merchandiseRefundMinor - refund.deliveryFeeRefundMinor - refund.deliveryTaxRefundMinor;
            if (giftCardLiabilityMinor < 0 || !Number.isSafeInteger(giftCardLiabilityMinor)) throw new Error("ACCOUNTING_INVALID_AMOUNT");
            const tenders = payments.filter((payment) => payment.status === "REFUNDED" && payment.idempotencyKey.startsWith(`${refund.approvedRequestId}:refund:`)).map(({ method, amountMinor }) => ({ method, amountMinor }));
            if (!tenders.length) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType: "Refund", sourceId: refund.id, reason: "refund_tenders_missing" });
              skippedCount += 1; continue;
            }
            let restockedCostMinor = 0;
            for (const item of refundItems) {
              const saleItem = saleItemById.get(item.saleItemId);
              if (!saleItem) throw new Error("ACCOUNTING_SOURCE_NOT_FOUND");
              if (item.restocked) restockedCostMinor += saleItem.costMinor * item.qty;
            }
            const draft = buildRefundDraft({
              currency: business.currency, effectiveAt: refund.createdAt, tenders,
              merchandiseRevenueMinor: merchandiseRefundMinor, deliveryRevenueMinor: refund.deliveryFeeRefundMinor,
              taxPayableMinor: refund.deliveryTaxRefundMinor, giftCardLiabilityMinor, loyaltyLiabilityMinor, restockedCostMinor,
            });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: sale.branchId ?? null, sourceType: "Refund", sourceId: refund.id, sourceEvent: "approved", draft, actorId: refund.approvedBy, requestId: refund.approvedRequestId });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
          } else if (family === "purchase-receipts") {
            const receipt = source as DbPurchaseReceipt;
            if (receipt.status !== "POSTED") { skippedCount += 1; continue; }
            const lines = await tx.listPurchaseReceiptLines(receipt.id, input.businessId);
            const inventoryCostMinor = lines.reduce((sum, line) => sum + line.quantityReceived * line.unitCostMinorSnapshot, 0);
            if (!Number.isSafeInteger(inventoryCostMinor) || inventoryCostMinor <= 0) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: receipt.id, reason: "purchase_receipt_cost_missing" });
              skippedCount += 1; continue;
            }
            const draft = buildPurchaseReceiptDraft({ currency: business.currency, effectiveAt: receipt.receivedAt, inventoryCostMinor });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: receipt.branchId, sourceType, sourceId: receipt.id, sourceEvent, draft, actorId: receipt.receivedBy, requestId: receipt.id });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
          } else if (family === "supplier-returns") {
            const supplierReturn = source as DbSupplierReturn;
            if (supplierReturn.status !== "POSTED") { skippedCount += 1; continue; }
            const returnLines = await tx.listSupplierReturnLines(supplierReturn.id, input.businessId);
            let billedReceiptCostMinor = 0; let billedInvoiceCostMinor = 0; let unbilledCostMinor = 0;
            for (const line of returnLines) {
              const allocations = await tx.listSupplierReturnReceiptAllocations(line.id, input.businessId);
              for (const allocation of allocations) {
                billedReceiptCostMinor += allocation.billedQuantity * allocation.unitCostMinorSnapshot;
                billedInvoiceCostMinor += allocation.billedInvoiceCostMinorSnapshot;
                unbilledCostMinor += (allocation.quantity - allocation.billedQuantity) * allocation.unitCostMinorSnapshot;
              }
            }
            if (![billedReceiptCostMinor, billedInvoiceCostMinor, unbilledCostMinor].every(Number.isSafeInteger) || billedReceiptCostMinor + billedInvoiceCostMinor + unbilledCostMinor <= 0) {
              await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: supplierReturn.id, reason: "supplier_return_cost_allocation_missing" });
              skippedCount += 1; continue;
            }
            const draft = buildSupplierReturnDraft({ currency: business.currency, effectiveAt: supplierReturn.postedAt ?? supplierReturn.createdAt, billedReceiptCostMinor, billedInvoiceCostMinor, unbilledCostMinor });
            const amounts = validateJournalDraft(draft);
            await journals.postSourceEvent({ businessId: input.businessId, branchId: supplierReturn.branchId, sourceType, sourceId: supplierReturn.id, sourceEvent, draft, actorId: supplierReturn.postedBy ?? supplierReturn.createdBy, requestId: supplierReturn.id });
            debitMinor += amounts.debitMinor; creditMinor += amounts.creditMinor;
            if (billedInvoiceCostMinor > 0 && !(await tx.listSupplierCredits(input.businessId, supplierReturn.supplierId)).some((credit) => credit.supplierReturnId === supplierReturn.id)) {
              await tx.createSupplierCredit({ businessId: input.businessId, supplierId: supplierReturn.supplierId, billId: null, supplierReturnId: supplierReturn.id, creditNumber: `RET-${supplierReturn.returnNumber}`, amountMinor: billedInvoiceCostMinor, status: "POSTED", createdBy: supplierReturn.postedBy ?? supplierReturn.createdBy, requestId: supplierReturn.id });
            }
          }
          processedCount += 1;
        } catch (error) {
          if (!(error instanceof Error) || !(/^(ACCOUNTING_[A-Z_]+|VALIDATION)$/.test(error.message))) throw error;
          const reason = error.message.toLowerCase();
          await tx.createAccountingBackfillIssue({ businessId: input.businessId, runId: run.id, sourceType, sourceId: source.id, reason });
          skippedCount += 1;
        }
      }

      const last = page.at(-1);
      let cursor: DbAccountingBackfillRun["cursor"];
      let status = "RUNNING";
      let completedAt: Date | null = null;
      if (page.length === PAGE_SIZE && last) cursor = { family, afterId: last.id };
      else if (family === "sales") cursor = { family: "expenses", afterId: null };
      else if (family === "expenses") cursor = { family: "refunds", afterId: null };
      else if (family === "refunds") cursor = { family: "purchase-receipts", afterId: null };
      else if (family === "purchase-receipts") cursor = { family: "supplier-returns", afterId: null };
      else if (family === "supplier-returns") cursor = { family: "supplier-bills", afterId: null };
      else if (family === "supplier-bills") cursor = { family: "inventory-counts", afterId: null };
      else if (family === "inventory-counts") cursor = { family: "inventory-movements", afterId: null };
      else {
        cursor = { family: "remaining", afterId: null };
      }
      const updated = await tx.updateAccountingBackfillRun(run.id, input.businessId, { cursor, status, completedAt, processedCount, skippedCount, debitMinor, creditMinor });
      if (!updated) throw new Error("NOT_FOUND");
      return updated;
    }));
  }
}
