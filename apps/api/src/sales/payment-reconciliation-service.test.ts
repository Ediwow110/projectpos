import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import type { DbPayment, DbSale } from "../common/db.port";
import { SalesPaymentReconciliationService } from "./payment-reconciliation-service";

async function setup() {
  const db = createMemoryDb();
  const sale = await db.createSale({
    businessId: "b1",
    receiptNo: "2026-000001",
    status: "PAYMENT_UNKNOWN",
    subtotalMinor: 5000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 5000,
    paidMinor: 0,
    changeMinor: 0,
    currency: "PHP",
    customerId: null,
    customerName: null,
    notes: null,
    actorId: "u1",
    requestId: "r1",
    idempotencyKey: "sale-key",
    registerId: null,
    branchId: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
  });
  const first = await db.createPayment({
    businessId: "b1",
    saleId: sale.id,
    method: "gcash",
    amountMinor: 2500,
    status: "UNKNOWN",
    providerRef: "ref-1",
    idempotencyKey: "pay-1",
  });
  const second = await db.createPayment({
    businessId: "b1",
    saleId: sale.id,
    method: "maya",
    amountMinor: 2500,
    status: "UNKNOWN",
    providerRef: "ref-2",
    idempotencyKey: "pay-2",
  });
  let stockApplications = 0;
  let metered = 0;
  const requireSale = async (businessId: string, saleId: string): Promise<DbSale> => {
    const row = await db.findSaleById(saleId, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  };
  const embedSale = async (row: DbSale) => ({
    ...row,
    items: await db.listSaleItems(row.id, row.businessId),
    payments: await db.listPaymentsBySale(row.id, row.businessId),
  });
  const service = new SalesPaymentReconciliationService(db, {
    requireSale,
    embedSale,
    applyStockEffect: async () => { stockApplications += 1; },
    postCashSale: async () => undefined,
    recordSale: async () => { metered += 1; },
  });
  return { db, sale, first, second, service, effects: () => ({ stockApplications, metered }) };
}

describe("sales payment reconciliation service", () => {
  it("waits for all unknown legs, then completes and meters exactly once", async () => {
    const { sale, first, second, service, effects } = await setup();

    const partial = await service.reconcilePayment("b1", "u1", "r2", first.id, "SUCCEEDED", "rec-1");
    expect(partial.sale.status).toBe("PAYMENT_UNKNOWN");
    expect(effects()).toEqual({ stockApplications: 0, metered: 0 });

    const done = await service.reconcilePayment("b1", "u1", "r3", second.id, "SUCCEEDED", "rec-2");
    expect(done.sale.status).toBe("COMPLETED");
    expect(done.sale.id).toBe(sale.id);
    expect(effects()).toEqual({ stockApplications: 1, metered: 1 });

    const replay = await service.reconcilePayment("b1", "u1", "r4", second.id, "SUCCEEDED", "rec-2");
    expect(replay.sale.status).toBe("COMPLETED");
    expect(effects()).toEqual({ stockApplications: 1, metered: 1 });
  });

  it("moves the sale to payment failed when one resolved leg fails", async () => {
    const { first, second, service, effects } = await setup();

    await service.reconcilePayment("b1", "u1", "r2", first.id, "SUCCEEDED", "rec-a");
    const failed = await service.reconcilePayment("b1", "u1", "r3", second.id, "FAILED", "rec-b");

    expect(failed.sale.status).toBe("PAYMENT_FAILED");
    expect((failed.payment as DbPayment).status).toBe("FAILED");
    expect(effects()).toEqual({ stockApplications: 0, metered: 0 });
  });
});
