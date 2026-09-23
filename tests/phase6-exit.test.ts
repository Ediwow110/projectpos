import { describe, expect, it } from "vitest";
import { refundableQty, lineRefundAmount } from "../apps/api/src/refunds/refund-math";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ShiftService } from "../apps/api/src/shifts/nest/shift.service";
import { RefundService } from "../apps/api/src/refunds/nest/refund.service";
import { CustomerService } from "../apps/api/src/customers/nest/customer.service";
import { ExpenseService } from "../apps/api/src/expenses/nest/expense.service";

const ALL = ["discount.override", "sale.void", "sale.refund", "cost.view"];

async function setup() {
  const db = createMemoryDb();
  const shifts = new ShiftService(db);
  const reg = await shifts.createRegister("b1", "u1", "r0", { name: "Counter 1" }, "owner");
  await shifts.openShift("b1", "u1", "r1", reg.id, { openingFloatMinor: 10000 }, "cashier");
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", productId: prod.id, qtyOnHand: 20 });
  return { db, shifts, sales: new SalesService(db), refunds: new RefundService(db), customers: new CustomerService(db), expenses: new ExpenseService(db), registerId: reg.id, productId: prod.id };
}

describe("phase6 exit", () => {
  it("owner explains a sale, refund, expense, and customer history from source records", async () => {
    const { db, shifts, sales, refunds, customers, expenses, registerId, productId } = await setup();
    const cust = await customers.createCustomer("b1", "u1", "r1", { name: "Ana" });
    const draft = await sales.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
      registerId, customerId: cust.id,
    }, ALL);
    await sales.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "exit6-1", granted: ALL,
    });
    const items = await db.listSaleItems(draft.id, "b1");
    const approved = await refunds.approveRefund("b1", "u1", "r4", draft.id, {
      items: [{ saleItemId: items[0].id, qty: 1 }], key: "exit6-r1",
    }, ALL, "owner");
    expect(approved.sale.status).toBe("PARTIALLY_REFUNDED");
    const history = await customers.getCustomer("b1", cust.id, "owner");
    expect(history.purchaseHistory.length).toBe(1);
    const exp = await expenses.createExpense("b1", "u1", "r5", { category: "Ice", amountMinor: 500, method: "cash" });
    expect(exp.category).toBe("Ice");
    const sale = await sales.getSale("b1", draft.id, ALL);
    expect(sale.refunds.length).toBe(1);
    expect(sale.customer?.name).toBe("Ana");
    const { report } = await shifts.closeShift("b1", "u1", "r6",
      (await db.findOpenShiftByRegister("b1", registerId))!.id, { countedCashMinor: 10000 + 5000 - 2500 + 0 }, []);
    expect(report.expectedCash).toBe(12500);
  });
  it("refund math bounds quantities and amounts", () => {
    expect(refundableQty(2, 1)).toBe(1);
    expect(refundableQty(1, 1)).toBe(0);
    expect(lineRefundAmount(5000, 2, 1)).toBe(2500);
  });
  it("over-refunds and self-approvals are rejected", async () => {
    const { sales, refunds, registerId, productId } = await setup();
    const draft = await sales.createDraft("b1", "u1", "r2", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0, registerId,
    }, ALL);
    await sales.completeSale("b1", "u1", "r3", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit6-2", granted: ALL,
    });
    const sale = await sales.getSale("b1", draft.id, ALL);
    const items = sale.items;
    await expect(
      refunds.approveRefund("b1", "u1", "r4", draft.id, {
        items: [{ saleItemId: items[0].id, qty: 9 }], key: "exit6-r2",
      }, ALL, "owner"),
    ).rejects.toThrow("REFUND_EXCEEDS_LIMIT");
    await sales.requestRefund("b1", "u1", "rq", draft.id, "changed mind", "exit6-rq", ALL);
    await expect(
      refunds.approveRefund("b1", "u1", "rq2", draft.id, {
        items: [{ saleItemId: items[0].id, qty: 1 }], key: "exit6-r3",
      }, ALL, "manager"),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("expense voids are permissioned and cross-tenant reads blocked", async () => {
    const { customers, expenses } = await setup();
    const c = await customers.createCustomer("b1", "u1", "r1", { name: "Ana" });
    await expect(expenses.voidExpense("b1", "u9", "r2", "nope", "oops", "cashier")).rejects.toThrow("FORBIDDEN");
    await expect(customers.getCustomer("b2", c.id, "owner")).rejects.toThrow("NOT_FOUND");
  });
});
