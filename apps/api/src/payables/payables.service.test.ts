import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { ProcurementService } from "../procurement/nest/procurement.service";
import { ShiftService } from "../shifts/nest/shift.service";
import { PayablesService } from "./payables.service";

const WRITE = ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.receive", "supplier_return.write", "payables.write"];

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "AP test", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({ businessId: business.id, categoryId: null, name: "Coffee", sku: "COF", barcode: null, brand: null, unit: "bag", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 0 });
  const procurement = new ProcurementService(db);
  const supplier = await procurement.createSupplier(business.id, "owner", "supplier-create", "supplier-key", { name: "Roaster" }, WRITE);
  const draft = await procurement.createPurchaseOrder(business.id, "owner", "po-create", "po-key", { supplierId: supplier.supplier.id, branchId: branch.id, lines: [{ productId: product.id, quantity: 5, unitCostMinor: 100 }] }, WRITE);
  const ordered = await procurement.orderPurchaseOrder(business.id, "owner", "po-order", draft.purchaseOrder.id, "po-order-key", draft.purchaseOrder.version, WRITE);
  const received = await procurement.receivePurchaseOrder(business.id, "owner", "po-receive", draft.purchaseOrder.id, "po-receive-key", { lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantityReceived: 3 }] }, WRITE);
  return { db, business, branch, supplier: supplier.supplier, received, payables: new PayablesService(db) };
}

describe("supplier payables", () => {
  it("creates and posts an invoice against received quantities with price variance", async () => {
    const { db, business, branch, supplier, received, payables } = await fixture();
    const receiptLine = received.purchaseReceipt.lines[0]!;
    const input = { supplierId: supplier.id, branchId: branch.id, invoiceNumber: "INV-100", invoiceDate: new Date("2026-10-10T00:00:00Z"), invoiceAmountMinor: 330, allocations: [{ receiptLineId: receiptLine.id, quantity: 3, unitInvoiceCostMinor: 110 }] };
    const created = await payables.createDraft(business.id, "owner", "bill-create", "bill-key", input, ["payables.write"]);
    expect(created.bill.status).toBe("DRAFT");
    const posted = await payables.postDraft(business.id, "owner", "bill-post", created.bill.id, created.bill.version, ["payables.write"]);
    expect(posted.status).toBe("POSTED");
    const journal = await db.findJournalEntryBySource(business.id, "SupplierBill", posted.id, "posted");
    expect(journal).not.toBeNull();
    const lines = await db.listJournalLines(journal!.entry.id, business.id);
    const codes = new Map((await db.listAccountingAccounts(business.id)).map((account) => [account.id, account.code]));
    expect(lines.map((line) => [codes.get(line.accountId), line.debitMinor, line.creditMinor])).toEqual([
      ["2220", 300, 0], ["5100", 30, 0], ["2000", 0, 330],
    ]);
    const paidAt = new Date("2026-10-10T12:00:00Z");
    const partial = await payables.payBill(business.id, "owner", "payment-1", posted.id, "pay-key-1", { amountMinor: 100, method: "card", paidAt }, ["payables.pay"]);
    expect(partial.bill).toMatchObject({ status: "PARTIALLY_PAID", paidMinor: 100 });
    expect((await payables.payBill(business.id, "owner", "payment-replay", posted.id, "pay-key-1", { amountMinor: 100, method: "card", paidAt }, ["payables.pay"])).replayed).toBe(true);
    await expect(payables.payBill(business.id, "owner", "payment-over", posted.id, "pay-key-over", { amountMinor: 231, method: "card", paidAt }, ["payables.pay"])).rejects.toThrow("SUPPLIER_PAYMENT_EXCEEDS_BALANCE");
    const remainder = await payables.payBill(business.id, "owner", "payment-2", posted.id, "pay-key-2", { amountMinor: 230, method: "bank_transfer", paidAt }, ["payables.pay"]);
    expect(remainder.bill).toMatchObject({ status: "PAID", paidMinor: 330 });
  });

  it("links cash payments to the open shift in the same transaction", async () => {
    const { db, business, branch, supplier, received, payables } = await fixture();
    const line = received.purchaseReceipt.lines[0]!;
    const billInput = { supplierId: supplier.id, branchId: branch.id, invoiceNumber: "INV-CASH", invoiceDate: new Date("2026-10-10T00:00:00Z"), invoiceAmountMinor: 200, allocations: [{ receiptLineId: line.id, quantity: 2, unitInvoiceCostMinor: 100 }] };
    const draft = await payables.createDraft(business.id, "owner", "bill-cash-create", "bill-cash-key", billInput, ["payables.write"]);
    const bill = await payables.postDraft(business.id, "owner", "bill-cash-post", draft.bill.id, draft.bill.version, ["payables.write"]);
    const shifts = new ShiftService(db);
    const register = await shifts.createRegister(business.id, "owner", "register", { name: "AP cash", branchId: branch.id }, "owner");
    const shift = await shifts.openShift(business.id, "owner", "shift-open", register.id, { openingFloatMinor: 500 }, "owner");
    const paid = await payables.payBill(business.id, "owner", "cash-payment", bill.id, "cash-pay-key", { amountMinor: 200, method: "cash", paidAt: new Date("2026-10-10T12:00:00Z"), shiftId: shift.id }, ["payables.pay"]);
    expect(paid.payment.cashMovementId).toBeTruthy();
    expect(await db.listCashMovementsByShift(shift.id, business.id)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "paid_out", amountMinor: -200, referenceType: "SupplierPayment", referenceId: paid.payment.id })]));
  });

  it("subtracts posted supplier credits from the bill payment balance", async () => {
    const { db, business, branch, supplier, received, payables } = await fixture();
    const line = received.purchaseReceipt.lines[0]!;
    const draft = await payables.createDraft(business.id, "owner", "credit-bill-create", "credit-bill-key", {
      supplierId: supplier.id, branchId: branch.id, invoiceNumber: "INV-CREDIT", invoiceDate: new Date("2026-10-10T00:00:00Z"),
      invoiceAmountMinor: 300, allocations: [{ receiptLineId: line.id, quantity: 3, unitInvoiceCostMinor: 100 }],
    }, ["payables.write"]);
    const bill = await payables.postDraft(business.id, "owner", "credit-bill-post", draft.bill.id, draft.bill.version, ["payables.write"]);
    await db.createSupplierCredit({ businessId: business.id, supplierId: supplier.id, billId: bill.id, supplierReturnId: "return-credit", creditNumber: "CN-1", amountMinor: 100, status: "POSTED", createdBy: "owner", requestId: "credit-request" });
    await expect(payables.payBill(business.id, "owner", "credit-overpay", bill.id, "credit-over-key", { amountMinor: 201, method: "bank_transfer", paidAt: new Date("2026-10-10T12:00:00Z") }, ["payables.pay"])).rejects.toThrow("SUPPLIER_PAYMENT_EXCEEDS_BALANCE");
    const paid = await payables.payBill(business.id, "owner", "credit-pay", bill.id, "credit-pay-key", { amountMinor: 200, method: "bank_transfer", paidAt: new Date("2026-10-10T12:00:00Z") }, ["payables.pay"]);
    expect(paid.bill).toMatchObject({ status: "PAID", paidMinor: 200 });
  });

  it("applies an unassigned supplier return credit once to a matching bill balance", async () => {
    const { db, business, branch, supplier, received, payables } = await fixture();
    const line = received.purchaseReceipt.lines[0]!;
    const draft = await payables.createDraft(business.id, "owner", "apply-bill-create", "apply-bill-key", {
      supplierId: supplier.id, branchId: branch.id, invoiceNumber: "INV-APPLY", invoiceDate: new Date("2026-10-10T00:00:00Z"),
      invoiceAmountMinor: 300, allocations: [{ receiptLineId: line.id, quantity: 3, unitInvoiceCostMinor: 100 }],
    }, ["payables.write"]);
    const bill = await payables.postDraft(business.id, "owner", "apply-bill-post", draft.bill.id, draft.bill.version, ["payables.write"]);
    const credit = await db.createSupplierCredit({ businessId: business.id, supplierId: supplier.id, billId: null, supplierReturnId: "return-unassigned", creditNumber: "CN-APPLY", amountMinor: 100, status: "POSTED", createdBy: "owner", requestId: "credit-apply-request" });
    const applied = await payables.applyCredit(business.id, "owner", "apply-credit", credit.id, { billId: bill.id }, ["payables.write"]);
    expect(applied.credit).toMatchObject({ billId: bill.id, status: "APPLIED" });
    await expect(payables.applyCredit(business.id, "owner", "apply-credit-again", credit.id, { billId: bill.id }, ["payables.write"])).rejects.toThrow("SUPPLIER_CREDIT_INVALID_STATE");
    expect((await db.listSupplierCredits(business.id, supplier.id)).find((row) => row.id === credit.id)?.billId).toBe(bill.id);
  });

  it("rejects overbilling, mismatched supplier, and unauthorized writes", async () => {
    const { business, supplier, received, payables } = await fixture();
    const line = received.purchaseReceipt.lines[0]!;
    const base = { supplierId: supplier.id, branchId: received.purchaseReceipt.branchId, invoiceNumber: "INV-101", invoiceDate: new Date(), invoiceAmountMinor: 400, allocations: [{ receiptLineId: line.id, quantity: 4, unitInvoiceCostMinor: 100 }] };
    await expect(payables.createDraft(business.id, "cashier", "denied", "denied-key", base, [])).rejects.toThrow("FORBIDDEN");
    await expect(payables.createDraft(business.id, "owner", "over", "over-key", base, ["payables.write"])).rejects.toThrow("SUPPLIER_BILL_RECEIVED_LIMIT");
    const valid = { ...base, invoiceNumber: "INV-102", invoiceAmountMinor: 100, allocations: [{ receiptLineId: line.id, quantity: 1, unitInvoiceCostMinor: 100 }] };
    await payables.createDraft(business.id, "owner", "first", "retry-key", valid, ["payables.write"]);
    await expect(payables.createDraft(business.id, "owner", "replay", "retry-key", { ...valid, invoiceAmountMinor: 200, allocations: [{ receiptLineId: line.id, quantity: 2, unitInvoiceCostMinor: 100 }] }, ["payables.write"])).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });
});
