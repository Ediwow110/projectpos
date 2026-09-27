import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import { SalesReceiptService } from "./receipt-service";

async function setupReceipt() {
  const db = createMemoryDb();
  const sale = await db.createSale({
    businessId: "b1",
    receiptNo: "2026-000001",
    status: "COMPLETED",
    subtotalMinor: 2500,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 2500,
    paidMinor: 3000,
    changeMinor: 500,
    currency: "PHP",
    customerId: null,
    customerName: "Walk In",
    notes: null,
    actorId: "u1",
    requestId: "r1",
    idempotencyKey: "sale-key",
    registerId: null,
    branchId: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
    completedAt: new Date("2026-09-20T00:01:00.000Z"),
  });
  await db.createSaleItem({
    businessId: "b1",
    saleId: sale.id,
    productId: "p1",
    name: "Coffee",
    unit: "pc",
    qty: 1,
    priceMinor: 2500,
    costMinor: 1000,
    taxRateBps: null,
    lineDiscountMinor: 0,
    lineTotalMinor: 2500,
  });
  await db.createPayment({
    businessId: "b1",
    saleId: sale.id,
    method: "cash",
    amountMinor: 3000,
    status: "SUCCEEDED",
    providerRef: null,
    idempotencyKey: "payment-key",
  });
  return { db, sale, receipts: new SalesReceiptService(db) };
}

describe("sales receipt service", () => {
  it("loads and renders tenant-scoped receipt data", async () => {
    const { sale, receipts } = await setupReceipt();

    const data = await receipts.receiptData("b1", sale.id);
    expect(data).toMatchObject({
      receiptNo: "2026-000001",
      status: "COMPLETED",
      customerName: "Walk In",
      totalMinor: 2500,
      paidMinor: 3000,
      changeMinor: 500,
    });
    expect(data.items).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
    await expect(receipts.receiptData("b2", sale.id)).rejects.toThrow("NOT_FOUND");

    const download = await receipts.downloadReceipt("b1", sale.id);
    expect(download.filename).toBe("receipt-2026-000001.txt");
    expect(download.text).toContain("Coffee x 1");
    expect(download.text).toContain("TOTAL 25.00");
  });

  it("creates hashed share tokens and resolves public receipt projections", async () => {
    const { db, sale, receipts } = await setupReceipt();

    const shared = await receipts.createShareToken("b1", "u1", "req-share", sale.id);
    expect(shared.token.length).toBeGreaterThanOrEqual(16);
    expect(shared.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const projection = await receipts.sharedReceipt(shared.token);
    expect(projection).toMatchObject({
      receiptNo: "2026-000001",
      status: "COMPLETED",
      totalMinor: 2500,
      paidMinor: 3000,
      changeMinor: 500,
    });
    expect(projection.items).toEqual([{ name: "Coffee", qty: 1, lineTotalMinor: 2500 }]);
    expect(projection.tenders).toEqual([{ method: "cash", amountMinor: 3000 }]);
    expect((await db.listAudit()).some((entry) => entry.action === "receipt.shared")).toBe(true);
    await expect(receipts.sharedReceipt("too-short")).rejects.toThrow("NOT_FOUND");
  });
});
