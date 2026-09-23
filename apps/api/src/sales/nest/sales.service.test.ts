import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase4 sales port", () => {
  it("round-trips a sale scoped to its business", async () => {
    const db = createMemoryDb();
    const sale = await db.createSale({
      businessId: "b1", receiptNo: "2026-000001", status: "DRAFT",
      subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0,
      paidMinor: 0, changeMinor: 0, currency: "PHP",
      customerId: null, customerName: null, notes: null,
      actorId: "u1", requestId: "r1", idempotencyKey: null,
    });
    expect(await db.findSaleById(sale.id, "b1")).not.toBeNull();
    expect(await db.findSaleById(sale.id, "b2")).toBeNull();
    expect(await db.listSalesByBusiness("b2")).toEqual([]);
  });
  it("claims idempotency keys once per command type", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({
      businessId: "b1", key: "k1", commandType: "sale.complete",
      fingerprint: "fp1", resultId: "s1",
    });
    await expect(
      db.claimIdempotency({
        businessId: "b1", key: "k1", commandType: "sale.complete",
        fingerprint: "fp1", resultId: "s1",
      }),
    ).rejects.toThrow("IDEMPOTENCY_REPLAY");
    expect(await db.findIdempotency("b1", "k1", "sale.complete")).not.toBeNull();
  });
  it("issues sequential receipt numbers per business", async () => {
    const db = createMemoryDb();
    const first = await db.nextReceiptNo("b1");
    const second = await db.nextReceiptNo("b1");
    expect(first).not.toBe(second);
    expect(await db.nextReceiptNo("b2")).toBe(first);
  });
});
