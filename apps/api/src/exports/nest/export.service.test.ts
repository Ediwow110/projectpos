import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ExportService } from "./export.service";
import { SalesService } from "../../sales/nest/sales.service";
import { RefundService } from "../../refunds/nest/refund.service";

const GRANT = ["sale.refund", "discount.override", "sale.void"];

async function setup() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Ledger Store", currency: "PHP" });
  const sales = new SalesService(db);
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Cola", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: null, productId: product.id, qtyOnHand: 100 });
  return { db, business, sales, product, exports: new ExportService(db) };
}

async function sell(
  sales: SalesService,
  businessId: string,
  productId: string,
  qty: number,
  payments: Array<{ method: string; amountMinor: number }>,
  key: string,
) {
  const draft = await sales.createDraft(businessId, "u1", `r-${key}`, {
    lines: [{ productId, qty, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
  }, GRANT);
  return sales.completeSale(businessId, "u1", `r-${key}`, draft.id, {
    payments, key, granted: GRANT,
  });
}

function totals(rows: Array<Array<string | number>>) {
  return rows.reduce(
    (acc, r) => ({
      debit: acc.debit + Number(r[4]),
      credit: acc.credit + Number(r[5]),
    }),
    { debit: 0, credit: 0 },
  );
}

function accountTotal(rows: Array<Array<string | number>>, account: string, side: 3 | 4 | 5): number {
  return rows
    .filter((r) => r[3] === account)
    .reduce((s, r) => s + Number(r[side === 4 ? 4 : 5]), 0);
}

describe("phase10 ledger export accounting", () => {
  it("books card and e-wallet sales to clearing accounts, not cash", async () => {
    const { business, sales, product, exports } = await setup();
    await sell(sales, business.id, product.id, 1, [{ method: "card", amountMinor: 2500 }], "card-1");
    await sell(sales, business.id, product.id, 1, [{ method: "gcash", amountMinor: 2500 }], "gcash-1");
    const { rows } = await exports.buildLedger(business.id, "u1", "r1", {});
    const sum = totals(rows);
    expect(sum.debit).toBe(sum.credit);

    const cash = accountTotal(rows, "1000", 4);
    expect(cash).toBe(0);
    const card = accountTotal(rows, "2100", 4);
    const wallet = accountTotal(rows, "2110", 4);
    expect(card).toBe(2500);
    expect(wallet).toBe(2500);
    const revenue = accountTotal(rows, "4000", 5);
    expect(revenue).toBe(5000);
  });

  it("splits a mixed-tender sale across cash and clearing", async () => {
    const { business, sales, product, exports } = await setup();
    await sell(sales, business.id, product.id, 2, [
      { method: "cash", amountMinor: 3000 },
      { method: "maya", amountMinor: 2000 },
    ], "split-1");
    const { rows } = await exports.buildLedger(business.id, "u1", "r1", {});
    expect(accountTotal(rows, "1000", 4)).toBe(3000);
    expect(accountTotal(rows, "2110", 4)).toBe(2000);
    const sum = totals(rows);
    expect(sum.debit).toBe(sum.credit);
  });

  it("posts compensating entries for approved refunds only", async () => {
    const { db, business, sales, product, exports } = await setup();
    const sale = await sell(sales, business.id, product.id, 2, [{ method: "card", amountMinor: 5000 }], "refund-1");
    const refunds = new RefundService(db);
    const items = (await db.listSaleItems(sale.sale.id, business.id)).map((l) => ({
      saleItemId: l.id,
      qty: 1,
    }));
    const beforeApproval = await exports.buildLedger(business.id, "u1", "r1", {});
    expect(beforeApproval.rows.filter((r) => r[1] === "refund")).toHaveLength(0);

    await refunds.approveRefund(
      business.id, "u1", "r-app", sale.sale.id,
      { items, reason: "customer return", key: "refund-key-1" },
      GRANT, "manager",
    );
    const after = await exports.buildLedger(business.id, "u1", "r1", {});
    const refundRows = after.rows.filter((r) => r[1] === "refund");
    expect(refundRows.length).toBeGreaterThan(0);
    const sum = totals(after.rows);
    expect(sum.debit).toBe(sum.credit);
    // Refund reverses revenue and credits the original tender (card clearing).
    expect(accountTotal(after.rows, "4000", 4)).toBe(2500);
    expect(accountTotal(after.rows, "2100", 5)).toBe(2500);
    // Restocked goods return to inventory at cost.
    expect(accountTotal(after.rows, "1400", 4)).toBe(1000);
    expect(accountTotal(after.rows, "5000", 5)).toBe(1000);
  });

  it("books nothing for draft sales", async () => {
    const { business, sales, product, exports } = await setup();
    const draft = await sales.createDraft(business.id, "u1", "r-draft", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    const { rows } = await exports.buildLedger(business.id, "u1", "r1", {});
    expect(rows.filter((r) => r[1] === "sale")).toHaveLength(0);
    expect(rows.filter((r) => r[1] === "refund")).toHaveLength(0);
    expect(draft.id).toBeTruthy();
  });

  it("reads source tables in bounded pages", async () => {
    const { db, business, exports } = await setup();
    const pageSize = (await import("./export.service")).LEDGER_PAGE;
    for (let i = 0; i < pageSize + 1; i++) {
      await db.createSale({
        businessId: business.id, receiptNo: `BULK-${String(i).padStart(4, "0")}`, status: "COMPLETED",
        customerId: null, customerName: null, notes: null, actorId: "u1", requestId: "r-bulk",
        currency: "PHP", registerId: null, branchId: null,
        subtotalMinor: 1000, discountMinor: 0, taxMinor: 0, totalMinor: 1000,
        paidMinor: 1000, changeMinor: 0, idempotencyKey: null,
        createdAt: new Date(),
      });
    }
    const limits: number[] = [];
    const original = db.listSalesPage.bind(db);
    const counting = {
      ...db,
      listSalesPage: (businessId: string, afterId: string | null, limit: number) => {
        limits.push(limit);
        return original(businessId, afterId, limit);
      },
    };
    const paged = new ExportService(counting as typeof db);
    const { count } = await paged.buildLedger(business.id, "u1", "r1", {});
    expect(count).toBe((pageSize + 1) * 2);
    expect(limits.length).toBe(2);
    expect(Math.max(...limits)).toBeLessThanOrEqual(pageSize);
  });
});
