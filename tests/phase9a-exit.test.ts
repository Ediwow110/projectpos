import { describe, expect, it } from "vitest";
import { canTransitionTransfer } from "../apps/api/src/transfers/transfer-math";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { BranchService } from "../apps/api/src/branches/nest/branch.service";
import { TransferService } from "../apps/api/src/transfers/nest/transfer.service";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { ReportingService } from "../apps/api/src/reports/nest/reporting.service";

const GRANT = ["discount.override", "sale.void", "sale.refund", "cost.view", "inventory.adjust"];
const ALL = [...GRANT];

async function setup() {
  const db = createMemoryDb();
  const businessId = (await db.createBusiness({ name: "Phase exit", currency: "PHP" })).id;
  const branches = new BranchService(db);
  const a = await branches.createBranch(businessId, "u1", "r0", { name: "North" }, "owner");
  const b = await branches.createBranch(businessId, "u1", "r0", { name: "South" }, "owner");
  const prod = await db.createProduct({
    businessId: businessId, categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: businessId, branchId: a.id, productId: prod.id, qtyOnHand: 20 });
  // Legacy null-scope stock for the null-branch sale test below.
  await db.upsertBalance({ businessId: businessId, branchId: null, productId: prod.id, qtyOnHand: 10 });
  return { db, businessId, branches, transfers: new TransferService(db), sales: new SalesService(db), reports: new ReportingService(db), a: a.id, b: b.id, productId: prod.id };
}

describe("phase9a exit", () => {
  it("transfers stock between branches with dual ledger entries", async () => {
    const { db, businessId, transfers, a, b, productId } = await setup();
    const t = await transfers.createTransfer(businessId, "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 6 }],
    }, GRANT);
    await transfers.dispatchTransfer(businessId, "u1", "r2", t.id, "exit9a-d1");
    await transfers.receiveTransfer(businessId, "u1", "r3", t.id, "exit9a-r1");
    expect((await db.findBalance(productId, businessId, a))!.qtyOnHand).toBe(14);
    expect((await db.findBalance(productId, businessId, b))!.qtyOnHand).toBe(6);
    const out = await db.listMovementsByBusiness(businessId);
    expect(out.filter((m) => m.type === "transfer_out" && m.branchId === a).length).toBe(1);
    expect(out.filter((m) => m.type === "transfer_in" && m.branchId === b).length).toBe(1);
  });
  it("branch lifecycle guards hold", () => {
    expect(canTransitionTransfer("DRAFT", "IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(() => canTransitionTransfer("DRAFT", "RECEIVED")).toThrow("TRANSFER_INVALID_STATE");
    expect(() => canTransitionTransfer("RECEIVED", "CANCELLED")).toThrow("TRANSFER_INVALID_STATE");
  });
  it("branch-filtered analytics reconcile with unfiltered totals", async () => {
    const { db, businessId, sales, reports, a, productId } = await setup();
    const draft = await sales.createDraft(businessId, "u1", "r1", {
      lines: [{ productId, qty: 2, lineDiscountMinor: 0 }], orderDiscountMinor: 0, branchId: a,
    }, ALL);
    await sales.completeSale(businessId, "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit9a-s1", granted: ALL,
    });
    await db.updateSale(draft.id, businessId, { createdAt: new Date("2026-09-10T10:00:00.000Z") });
    const range = { dateFrom: "2026-09-01T00:00:00.000Z", dateTo: "2026-09-30T00:00:00.000Z", compare: "none" };
    const all = await reports.getSalesReport(businessId, range, "owner", ALL);
    const filtered = await reports.getSalesReport(businessId, { ...range, branchId: a }, "owner", ALL);
    expect(filtered.totals.netRevenue).toBe(5000);
    expect(all.totals.netRevenue).toBe(5000);
    const branches = await reports.getBranchesReport(businessId, range, "owner", ALL);
    const row = branches.rows.find((r) => r.branchId === a)!;
    expect(row.sales).toBe(5000);
    expect(branches.rows.reduce((s, r) => s + r.sales, 0)).toBe(all.totals.netRevenue);
  });
  it("legacy null-scope sales still complete without a branch", async () => {
    const { businessId, sales, productId } = await setup();
    const draft = await sales.createDraft(businessId, "u1", "r1", {
      lines: [{ productId, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, ALL);
    const done = await sales.completeSale(businessId, "u1", "r2", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }], key: "exit9a-s2", granted: ALL,
    });
    expect(done.sale.status).toBe("COMPLETED");
    expect(done.sale.branchId).toBeNull();
  });
});
