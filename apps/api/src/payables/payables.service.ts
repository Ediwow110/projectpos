import type { DbPort, DbPurchaseReceiptLine, DbSupplierBill } from "../common/db.port";
import { fingerprintPayload } from "../sales/idempotency";
import { JournalPostingService } from "../accounting/journal-posting.service";
import { accountForMethod, buildSupplierBillDraft, buildSupplierPaymentDraft } from "../accounting/journal-rules";

export interface SupplierBillInput {
  supplierId: string;
  branchId: string | null;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date | null;
  invoiceAmountMinor: number;
  nonStockChargeMinor?: number;
  notes?: string | null;
  allocations: Array<{ receiptLineId: string; quantity: number; unitInvoiceCostMinor: number }>;
}
export interface SupplierPaymentInput { amountMinor: number; method: string; paidAt: Date; reference?: string | null; shiftId?: string | null; }
export interface SupplierCreditApplicationInput { billId: string; }

type ReceiptAllocationSource = { line: DbPurchaseReceiptLine; received: number; returned: number; billed: number };

export class PayablesService {
  constructor(private readonly db: DbPort) {}

  private requireGrant(granted: string[], permission: string): void {
    if (!granted.includes(permission)) throw new Error("FORBIDDEN");
  }

  private async receiptSources(businessId: string, db: DbPort = this.db): Promise<Map<string, ReceiptAllocationSource & { supplierId: string; branchId: string | null }>> {
    const result = new Map<string, ReceiptAllocationSource & { supplierId: string; branchId: string | null }>();
    for (const order of await db.listPurchaseOrdersByBusiness(businessId)) {
      for (const receipt of await db.listPurchaseReceiptsByOrder(order.id, businessId)) {
        if (receipt.status !== "POSTED") continue;
        for (const line of await db.listPurchaseReceiptLines(receipt.id, businessId)) {
          result.set(line.id, {
            line, received: line.quantityReceived,
            returned: await db.returnedQuantityByReceiptLine(businessId, line.id),
            billed: await db.billedQuantityByReceiptLine(businessId, line.id),
            supplierId: order.supplierId, branchId: order.branchId,
          });
        }
      }
    }
    return result;
  }

  async createDraft(businessId: string, actorId: string, requestId: string, key: string, input: SupplierBillInput, granted: string[]): Promise<{ bill: DbSupplierBill; replayed: boolean }> {
    this.requireGrant(granted, "payables.write");
    if (!key || !input.invoiceNumber.trim() || !Number.isSafeInteger(input.invoiceAmountMinor) || input.invoiceAmountMinor < 0 || !Number.isSafeInteger(input.nonStockChargeMinor ?? 0) || (input.nonStockChargeMinor ?? 0) < 0 || Number.isNaN(input.invoiceDate.getTime()) || (input.dueDate && Number.isNaN(input.dueDate.getTime())) || input.allocations.length === 0) throw new Error("VALIDATION");
    const fingerprint = fingerprintPayload(input);
    return this.db.withLock(`supplier-bill-allocation:${businessId}`, async () => this.db.withTransaction(async (tx) => {
      const replay = await tx.findIdempotency(businessId, key, "supplier_bill.create");
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const bill = await tx.findSupplierBill(replay.resultId, businessId);
        if (!bill) throw new Error("NOT_FOUND");
        return { bill, replayed: true };
      }
      const [supplier, business] = await Promise.all([tx.findSupplierById(input.supplierId, businessId), tx.findBusinessById(businessId)]);
      if (!supplier || !supplier.isActive || !business) throw new Error("VALIDATION");
      if (input.branchId !== null && !(await tx.findBranchById(input.branchId, businessId))) throw new Error("VALIDATION");
      const sources = await this.receiptSources(businessId, tx);
      const seen = new Set<string>();
      let merchandiseTotal = 0;
      const allocations = input.allocations.map((allocation) => {
        if (seen.has(allocation.receiptLineId) || !Number.isSafeInteger(allocation.quantity) || allocation.quantity <= 0 || !Number.isSafeInteger(allocation.unitInvoiceCostMinor) || allocation.unitInvoiceCostMinor < 0) throw new Error("VALIDATION");
        seen.add(allocation.receiptLineId);
        const source = sources.get(allocation.receiptLineId);
        if (!source || source.supplierId !== supplier.id || source.branchId !== input.branchId) throw new Error("SUPPLIER_RECEIPT_MISMATCH");
        if (allocation.quantity > source.received - source.returned - source.billed) throw new Error("SUPPLIER_BILL_RECEIVED_LIMIT");
        const invoiceAmountMinor = allocation.quantity * allocation.unitInvoiceCostMinor;
        const receiptCostMinorSnapshot = allocation.quantity * source.line.unitCostMinorSnapshot;
        if (!Number.isSafeInteger(invoiceAmountMinor) || !Number.isSafeInteger(receiptCostMinorSnapshot)) throw new Error("VALIDATION");
        merchandiseTotal += invoiceAmountMinor;
        return { ...allocation, invoiceAmountMinor, receiptCostMinorSnapshot };
      });
      if (!Number.isSafeInteger(merchandiseTotal) || merchandiseTotal !== input.invoiceAmountMinor) throw new Error("SUPPLIER_BILL_TOTAL_MISMATCH");
      const bill = await tx.createSupplierBill({
        businessId, supplierId: supplier.id, branchId: input.branchId, invoiceNumber: input.invoiceNumber.trim(),
        invoiceDate: input.invoiceDate, dueDate: input.dueDate ?? null, currency: business.currency, status: "DRAFT",
        invoiceAmountMinor: merchandiseTotal, nonStockChargeMinor: input.nonStockChargeMinor ?? 0, paidMinor: 0,
        version: 1, notes: input.notes?.trim() || null, createdBy: actorId, postedBy: null, postedAt: null,
        voidedBy: null, voidedAt: null, requestId,
      });
      for (const allocation of allocations) await tx.createSupplierBillAllocation({ businessId, billId: bill.id, receiptLineId: allocation.receiptLineId, quantity: allocation.quantity, unitInvoiceCostMinor: allocation.unitInvoiceCostMinor, invoiceAmountMinor: allocation.invoiceAmountMinor, receiptCostMinorSnapshot: allocation.receiptCostMinorSnapshot });
      await tx.claimIdempotency({ businessId, key, commandType: "supplier_bill.create", fingerprint, resultId: bill.id });
      await tx.appendAudit({ businessId, actorId, action: "supplier_bill.created", entityType: "SupplierBill", entityId: bill.id, requestId });
      return { bill, replayed: false };
    }));
  }

  async postDraft(businessId: string, actorId: string, requestId: string, billId: string, expectedVersion: number, granted: string[]): Promise<DbSupplierBill> {
    this.requireGrant(granted, "payables.write");
    return this.db.withLock(`supplier-bill-allocation:${businessId}`, async () => this.db.withTransaction(async (tx) => {
      const bill = await tx.findSupplierBill(billId, businessId);
      if (!bill) throw new Error("NOT_FOUND");
      if (bill.status !== "DRAFT" || bill.version !== expectedVersion) throw new Error("STALE_VERSION");
      const allocations = await tx.listSupplierBillAllocations(billId, businessId);
      if (allocations.length === 0) throw new Error("SUPPLIER_BILL_EMPTY");
      const sources = await this.receiptSources(businessId, tx);
      allocations.forEach((row) => {
        const source = sources.get(row.receiptLineId);
        if (!source || source.supplierId !== bill.supplierId || source.branchId !== bill.branchId || row.quantity > source.received - source.returned - source.billed) throw new Error("SUPPLIER_BILL_RECEIVED_LIMIT");
      });
      const next = await tx.updateSupplierBill(billId, businessId, { status: "POSTED", postedBy: actorId, postedAt: new Date() }, expectedVersion);
      if (!next) throw new Error("STALE_VERSION");
      const business = await tx.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const receiptCostMinor = allocations.reduce((sum, row) => sum + row.receiptCostMinorSnapshot, 0);
      await new JournalPostingService(tx).postSourceEvent({
        businessId, branchId: bill.branchId, sourceType: "SupplierBill", sourceId: bill.id, sourceEvent: "posted", actorId, requestId,
        draft: buildSupplierBillDraft({ currency: business.currency, receiptCostMinor, invoiceAmountMinor: bill.invoiceAmountMinor, nonStockChargeMinor: bill.nonStockChargeMinor, effectiveAt: next.postedAt ?? new Date() }),
      });
      await tx.appendAudit({ businessId, actorId, action: "supplier_bill.posted", entityType: "SupplierBill", entityId: bill.id, requestId });
      return next;
    }));
  }

  async payBill(businessId: string, actorId: string, requestId: string, billId: string, key: string, input: SupplierPaymentInput, granted: string[]): Promise<{ payment: Awaited<ReturnType<DbPort["createSupplierPayment"]>>; bill: DbSupplierBill; replayed: boolean }> {
    this.requireGrant(granted, "payables.pay");
    if (!key || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || Number.isNaN(input.paidAt.getTime()) || !["cash", "card", "bank_transfer", "gcash", "maya", "qrph", "other"].includes(input.method) || (input.reference?.length ?? 0) > 120) throw new Error("VALIDATION");
    return this.db.withLock(`supplier-bill-allocation:${businessId}`, async () => this.db.withLock(`supplier-bill:${businessId}:${billId}`, async () => this.db.withTransaction(async (tx) => {
      const bill = await tx.findSupplierBill(billId, businessId);
      if (!bill) throw new Error("NOT_FOUND");
      const payments = await tx.listSupplierPayments(billId, businessId);
      const replay = payments.find((payment) => payment.idempotencyKey === key);
      if (replay) {
        if (replay.amountMinor !== input.amountMinor || replay.method !== input.method || replay.paidAt.getTime() !== input.paidAt.getTime()) throw new Error("IDEMPOTENCY_MISMATCH");
        return { payment: replay, bill, replayed: true };
      }
      if (!["POSTED", "PARTIALLY_PAID"].includes(bill.status)) throw new Error("SUPPLIER_BILL_INVALID_STATE");
      const credits = await tx.listSupplierCredits(businessId, bill.supplierId);
      const creditedMinor = credits.filter((credit) => credit.billId === bill.id && ["POSTED", "APPLIED"].includes(credit.status))
        .reduce((sum, credit) => sum + credit.amountMinor, 0);
      const grossMinor = bill.invoiceAmountMinor + bill.nonStockChargeMinor;
      const balance = Math.max(0, grossMinor - bill.paidMinor - creditedMinor);
      if (input.amountMinor > balance) throw new Error("SUPPLIER_PAYMENT_EXCEEDS_BALANCE");
      const business = await tx.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const chart = await new JournalPostingService(tx).seedChart(businessId);
      const paidFrom = chart.find((account) => account.code === accountForMethod(input.method));
      if (!paidFrom) throw new Error("ACCOUNTING_INVALID_ACCOUNT");
      let shift: Awaited<ReturnType<DbPort["findShiftById"]>> = null;
      if (input.shiftId) {
        if (input.method !== "cash") throw new Error("VALIDATION");
        shift = await tx.findShiftById(input.shiftId, businessId);
        if (!shift || shift.status !== "OPEN" || (shift.branchId ?? null) !== (bill.branchId ?? null)) throw new Error("SHIFT_CLOSED_IMMUTABLE");
      }
      const payment = await tx.createSupplierPayment({
        businessId, supplierId: bill.supplierId, billId, branchId: bill.branchId, amountMinor: input.amountMinor,
        method: input.method, paidFromAccountId: paidFrom.id, reference: input.reference?.trim() || null,
        paidAt: input.paidAt, shiftId: shift?.id ?? null, cashMovementId: null, idempotencyKey: key, createdBy: actorId, requestId,
      });
      if (shift) {
        const movement = await tx.createCashMovement({ businessId, shiftId: shift.id, registerId: shift.registerId, branchId: shift.branchId ?? null, type: "paid_out", amountMinor: -input.amountMinor, reason: `Supplier payment ${bill.invoiceNumber}`, referenceType: "SupplierPayment", referenceId: payment.id, actorId, requestId });
        await tx.updateSupplierPayment(payment.id, businessId, { cashMovementId: movement.id });
      }
      const paidMinor = bill.paidMinor + input.amountMinor;
      const status = paidMinor + creditedMinor >= grossMinor ? "PAID" : "PARTIALLY_PAID";
      const updatedBill = await tx.updateSupplierBill(billId, businessId, { paidMinor, status }, bill.version);
      if (!updatedBill) throw new Error("STALE_VERSION");
      await new JournalPostingService(tx).postSourceEvent({
        businessId, branchId: bill.branchId, sourceType: "SupplierPayment", sourceId: payment.id, sourceEvent: "posted", actorId, requestId,
        draft: buildSupplierPaymentDraft({ currency: business.currency, amountMinor: input.amountMinor, paidFromAccountCode: accountForMethod(input.method), effectiveAt: input.paidAt }),
      });
      await tx.appendAudit({ businessId, actorId, action: "supplier_payment.posted", entityType: "SupplierPayment", entityId: payment.id, requestId });
      return { payment: { ...payment, cashMovementId: shift ? (await tx.listSupplierPayments(billId, businessId)).find((row) => row.id === payment.id)?.cashMovementId ?? null : null }, bill: updatedBill, replayed: false };
    })));
  }

  async applyCredit(businessId: string, actorId: string, requestId: string, creditId: string, input: SupplierCreditApplicationInput, granted: string[]): Promise<{ credit: Awaited<ReturnType<DbPort["updateSupplierCredit"]>>; bill: DbSupplierBill }> {
    this.requireGrant(granted, "payables.write");
    return this.db.withLock(`supplier-bill-allocation:${businessId}`, async () => this.db.withTransaction(async (tx) => {
      const bill = await tx.findSupplierBill(input.billId, businessId);
      if (!bill) throw new Error("NOT_FOUND");
      if (!["POSTED", "PARTIALLY_PAID"].includes(bill.status)) throw new Error("SUPPLIER_BILL_INVALID_STATE");
      const credits = await tx.listSupplierCredits(businessId, bill.supplierId);
      const credit = credits.find((row) => row.id === creditId);
      if (!credit || credit.status !== "POSTED" || credit.billId !== null) throw new Error("SUPPLIER_CREDIT_INVALID_STATE");
      const appliedMinor = credits.filter((row) => row.billId === bill.id && ["POSTED", "APPLIED"].includes(row.status)).reduce((sum, row) => sum + row.amountMinor, 0);
      const balance = bill.invoiceAmountMinor + bill.nonStockChargeMinor - bill.paidMinor - appliedMinor;
      if (credit.amountMinor > balance) throw new Error("SUPPLIER_CREDIT_EXCEEDS_BALANCE");
      const updated = await tx.updateSupplierCredit(credit.id, businessId, { billId: bill.id, status: "APPLIED" });
      if (!updated) throw new Error("NOT_FOUND");
      await tx.appendAudit({ businessId, actorId, action: "supplier_credit.applied", entityType: "SupplierCredit", entityId: credit.id, requestId, after: { billId: bill.id, amountMinor: credit.amountMinor } });
      return { credit: updated, bill };
    }));
  }
}
