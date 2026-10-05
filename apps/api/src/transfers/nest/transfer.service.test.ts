import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { TransferService } from "./transfer.service";

const GRANT = ["inventory.adjust"];

async function setupTransfer() {
  const db = createMemoryDb();
  const svc = new TransferService(db);
  const a = await db.createBranch({ businessId: "b1", name: "A", type: "store", isActive: true });
  const b = await db.createBranch({ businessId: "b1", name: "B", type: "store", isActive: true });
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", branchId: a.id, productId: prod.id, qtyOnHand: 10 });
  return { db, svc, a: a.id, b: b.id, productId: prod.id };
}

async function holdTransferStock(
  db: ReturnType<typeof createMemoryDb>,
  branchId: string,
  productId: string,
  qty: number,
) {
  const now = new Date();
  const order = await db.createOrder({ businessId: "b1", channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP", branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "hold-transfer", createdAt: now, updatedAt: now });
  const line = await db.createOrderLine({ businessId: "b1", orderId: order.id, position: 0, productId, name: "Held", sku: null, barcode: null, unit: "pc", qty, priceMinor: 100, costMinor: 50, taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100 * qty, bundleComponentsSnapshot: null, createdAt: now });
  await db.createInventoryReservation({ businessId: "b1", branchId, orderId: order.id, orderLineId: line.id, productId, qty, status: "HELD", expiresAt: new Date(Date.now() + 60_000), idempotencyKey: "hold-transfer", createdAt: now, updatedAt: now });
}

describe("phase9a transfer service", () => {
  it("dispatches and receives with dual-location ledger entries", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 4 }],
    }, GRANT);
    expect(t.status).toBe("DRAFT");
    await svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d1");
    expect((await db.findBalance(productId, "b1", a))!.qtyOnHand).toBe(6);
    await svc.receiveTransfer("b1", "u1", "r3", t.id, "key-r1");
    expect((await db.findBalance(productId, "b1", b))!.qtyOnHand).toBe(4);
    const moves = await db.listMovementsByBusiness("b1");
    expect(moves.filter((m) => m.type === "transfer_out").length).toBe(1);
    expect(moves.filter((m) => m.type === "transfer_in").length).toBe(1);
    const actions = (await db.listAudit()).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["transfer.create", "transfer.dispatch", "transfer.receive"]));
  });
  it("rejects oversell dispatch with nothing written", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 99 }],
    }, GRANT);
    await expect(svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d2")).rejects.toThrow("INSUFFICIENT_STOCK");
    expect(await db.listMovementsByBusiness("b1")).toEqual([]);
    expect((await db.findTransferById(t.id, "b1"))!.status).toBe("DRAFT");
  });
  it("rejects dispatch that would consume another Order's HELD stock", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    await holdTransferStock(db, a, productId, 7);
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 4 }],
    }, GRANT);
    await expect(svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-held")).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await db.findBalance(productId, "b1", a))?.qtyOnHand).toBe(10);
    expect((await db.listMovementsByBusiness("b1")).filter((m) => m.type === "transfer_out")).toHaveLength(0);
  });
  it("rejects double dispatch and receive-before-dispatch", async () => {
    const { svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 1 }],
    }, GRANT);
    await expect(svc.receiveTransfer("b1", "u1", "r2", t.id, "key-rx")).rejects.toThrow("TRANSFER_INVALID_STATE");
    await svc.dispatchTransfer("b1", "u1", "r3", t.id, "key-d3");
    await expect(svc.dispatchTransfer("b1", "u1", "r4", t.id, "key-d4")).rejects.toThrow("TRANSFER_INVALID_STATE");
  });
  it("cancels in-transit by restoring source stock", async () => {
    const { db, svc, a, b, productId } = await setupTransfer();
    const t = await svc.createTransfer("b1", "u1", "r1", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 4 }],
    }, GRANT);
    await svc.dispatchTransfer("b1", "u1", "r2", t.id, "key-d5");
    await svc.cancelTransfer("b1", "u1", "r3", t.id, "key-c5");
    expect((await db.findBalance(productId, "b1", a))!.qtyOnHand).toBe(10);
    // Destination never received stock, so no balance row exists there.
    expect(await db.findBalance(productId, "b1", b)).toBeNull();
  });
  it("requires inventory.adjust and blocks cross-tenant access", async () => {
    const { svc, a, b, productId } = await setupTransfer();
    await expect(svc.createTransfer("b1", "u9", "r9", {
      fromBranchId: a, toBranchId: b, lines: [{ productId, qty: 1 }],
    }, [])).rejects.toThrow("FORBIDDEN");
    await expect(svc.getTransfer("b2", "nope")).rejects.toThrow("NOT_FOUND");
  });
});
