import { describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import type { DbPort } from "../../common/db.port";
import { InventoryCountService } from "./inventory-count.service";
import { ProcurementService } from "../../procurement/nest/procurement.service";

const grant = ["inventory.adjust", "purchase_order.write"];

async function fixture(): Promise<{ db: DbPort; service: InventoryCountService; businessId: string; products: string[] }> {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Count test", currency: "PHP" });
  const products = await Promise.all(["A", "B"].map((name) => db.createProduct({ businessId: business.id, categoryId: null, name, sku: name, barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 5, trackInventory: true, isActive: true, imageUrl: null })));
  for (const product of products) {
    await db.createMovement({ businessId: business.id, productId: product.id, type: "opening_stock", qtyDelta: 10, reason: null, referenceType: null, referenceId: null, actorId: "owner", requestId: "seed", branchId: null });
    await db.upsertBalance({ businessId: business.id, productId: product.id, qtyOnHand: 10, branchId: null });
  }
  return { db, service: new InventoryCountService(db, {} as never), businessId: business.id, products: products.map((p) => p.id) };
}

describe("phase 18 inventory counts", () => {
  it("rejects a stale count before submission without writing a stock_count movement", async () => {
    const { db, service, businessId, products } = await fixture();
    const count = await service.createCount(businessId, "owner", "r1", { scopeType: "PARTIAL", name: "Cycle", branchId: null, productIds: [products[0]!] }, grant);
    const started = await service.startCount(businessId, "owner", "r2", count.id, count.version, grant);
    const line = started.lines[0]!;
    await service.updateLines(businessId, "owner", "r3", count.id, { expectedVersion: started.version, lines: [{ lineId: line.id, countedQty: 8 }] }, grant);
    await db.createMovement({ businessId, productId: products[0]!, type: "sale", qtyDelta: -1, reason: null, referenceType: null, referenceId: null, actorId: "owner", requestId: "r4", branchId: null });
    await db.upsertBalance({ businessId, productId: products[0]!, qtyOnHand: 9, branchId: null });
    await expect(service.submitCount(businessId, "owner", "r5", count.id, started.version + 1, grant)).rejects.toThrow("COUNT_STALE");
    expect((await db.listMovements(products[0]!, businessId, null)).filter((row) => row.type === "stock_count")).toHaveLength(0);
  });

  it("rolls back every line on a multi-line post failure and replays exactly once", async () => {
    const { db, service, businessId, products } = await fixture();
    const count = await service.createCount(businessId, "owner", "r1", { scopeType: "FULL", name: "Full", branchId: null }, grant);
    const started = await service.startCount(businessId, "owner", "r2", count.id, count.version, grant);
    const updated = await service.updateLines(businessId, "owner", "r3", count.id, { expectedVersion: started.version, lines: started.lines.map((line, index) => ({ lineId: line.id, countedQty: index === 0 ? 8 : 12 })) }, grant);
    const submitted = await service.submitCount(businessId, "owner", "r4", count.id, updated.version, grant);
    const approved = await service.approveCount(businessId, "owner", "r5", count.id, submitted.version, grant);
    const original = db.createMovement.bind(db);
    let calls = 0;
    vi.spyOn(db, "createMovement").mockImplementation(async (...args) => { calls += 1; if (calls === 2) throw new Error("INJECTED"); return original(...args); });
    await expect(service.postCount(businessId, "owner", "r6", count.id, "post-key", approved.version, grant)).rejects.toThrow("INJECTED");
    expect((await db.findBalance(products[0]!, businessId, null))?.qtyOnHand).toBe(10);
    expect((await db.findBalance(products[1]!, businessId, null))?.qtyOnHand).toBe(10);
    expect((await db.findInventoryCountById(count.id, businessId))?.status).toBe("APPROVED");
    vi.restoreAllMocks();
    const posted = await service.postCount(businessId, "owner", "r7", count.id, "post-key", approved.version, grant);
    expect(posted.replayed).toBe(false);
    expect((await db.listMovementsByBusiness(businessId)).filter((row) => row.type === "stock_count")).toHaveLength(2);
    const countEntry = await db.findJournalEntryBySource(businessId, "InventoryCount", count.id, "posted");
    expect(countEntry).not.toBeNull();
    const countLines = await db.listJournalLines(countEntry!.entry.id, businessId);
    expect(countLines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(400);
    expect(countLines.reduce((sum, line) => sum + line.creditMinor, 0)).toBe(400);
    const replay = await service.postCount(businessId, "owner", "r8", count.id, "post-key", approved.version, grant);
    expect(replay.replayed).toBe(true);
    expect((await db.listMovementsByBusiness(businessId)).filter((row) => row.type === "stock_count")).toHaveLength(2);
  });

  it("rejects a negative count that would make on-hand lower than HELD reservations", async () => {
    const { db, service, businessId, products } = await fixture();
    const branch = await db.createBranch({ businessId, name: "Held branch", type: "store", isActive: true });
    await db.createMovement({ businessId, productId: products[0]!, type: "opening_stock", qtyDelta: 10, reason: null, referenceType: null, referenceId: null, actorId: "owner", requestId: "held-seed", branchId: branch.id });
    await db.upsertBalance({ businessId, productId: products[0]!, qtyOnHand: 10, branchId: branch.id });
    const now = new Date();
    const order = await db.createOrder({ businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP", branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 900, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 900, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "held-count-order", createdAt: now, updatedAt: now });
    const line = await db.createOrderLine({ businessId, orderId: order.id, position: 0, productId: products[0]!, name: "A", sku: "A", barcode: null, unit: "pc", qty: 9, priceMinor: 100, costMinor: 100, taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 900, bundleComponentsSnapshot: null, createdAt: now });
    await db.createInventoryReservation({ businessId, branchId: branch.id, orderId: order.id, orderLineId: line.id, productId: products[0]!, qty: 9, status: "HELD", expiresAt: new Date(Date.now() + 60_000), idempotencyKey: "held-count-res", createdAt: now, updatedAt: now });

    const count = await service.createCount(businessId, "owner", "hc1", { scopeType: "PARTIAL", name: "Held count", branchId: branch.id, productIds: [products[0]!] }, grant);
    const started = await service.startCount(businessId, "owner", "hc2", count.id, count.version, grant);
    const updated = await service.updateLines(businessId, "owner", "hc3", count.id, { expectedVersion: started.version, lines: [{ lineId: started.lines[0]!.id, countedQty: 8 }] }, grant);
    const submitted = await service.submitCount(businessId, "owner", "hc4", count.id, updated.version, grant);
    const approved = await service.approveCount(businessId, "owner", "hc5", count.id, submitted.version, grant);
    await expect(service.postCount(businessId, "owner", "hc6", count.id, "held-count-post", approved.version, grant)).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await db.findBalance(products[0]!, businessId, branch.id))?.qtyOnHand).toBe(10);
    expect((await db.listMovements(products[0]!, businessId, branch.id)).filter((m) => m.type === "stock_count")).toHaveLength(0);
  });

  it("suppresses inbound stock, counts partial receipts, surfaces missing suppliers, and keeps draft PO creation commercial", async () => {
    const { db, businessId, products } = await fixture();
    const procurement = new ProcurementService(db);
    const service = new InventoryCountService(db, procurement);
    const supplierResult = await procurement.createSupplier(businessId, "owner", "s1", "supplier-key", { name: "Replenishment supplier" }, ["supplier.write"]);
    const supplier = supplierResult.supplier;
    await procurement.createProductSupplier(businessId, "owner", "s2", supplier.id, { productId: products[0]!, unitCostMinor: 125, leadTimeDays: 4, isPreferred: true }, ["supplier.write"]);
    await db.upsertBalance({ businessId, productId: products[0]!, qtyOnHand: 2, branchId: null });
    await db.upsertBalance({ businessId, productId: products[1]!, qtyOnHand: 2, branchId: null });
    const first = await service.listReplenishment(businessId, null);
    expect(first.find((row) => row.productId === products[0])).toMatchObject({ onHand: 2, onOrderQty: 0, suggestedQty: 8, supplierId: supplier.id });
    expect(first.find((row) => row.productId === products[1])).toMatchObject({ supplierId: null, supplierName: null });
    const po = await procurement.createPurchaseOrder(businessId, "owner", "s3", "po-key", { supplierId: supplier.id, branchId: null, lines: [{ productId: products[0]!, quantity: 8 }] }, ["purchase_order.write"]);
    await procurement.orderPurchaseOrder(businessId, "owner", "s3b", po.purchaseOrder.id, "order-key", po.purchaseOrder.version, ["purchase_order.order"]);
    const suppressed = await service.listReplenishment(businessId, null);
    expect(suppressed.find((row) => row.productId === products[0])).toBeUndefined();
    const line = po.purchaseOrder.lines[0]!;
    const receipt = await db.createPurchaseReceipt({ businessId, purchaseOrderId: po.purchaseOrder.id, branchId: null, receiptNumber: "GRN-TEST", status: "POSTED", receivedBy: "owner", receivedAt: new Date(), notes: null });
    await db.createPurchaseReceiptLine({ businessId, purchaseReceiptId: receipt.id, purchaseOrderLineId: line.id, productId: products[0]!, quantityReceived: 3, unitCostMinorSnapshot: 100, productNameSnapshot: "A", supplierSkuSnapshot: null });
    await db.updatePurchaseOrder(po.purchaseOrder.id, businessId, { status: "PARTIALLY_RECEIVED" }, po.purchaseOrder.version + 1);
    await db.updateProduct(products[0]!, businessId, { reorderLevel: 10 });
    const partial = await service.listReplenishment(businessId, null);
    expect(partial.find((row) => row.productId === products[0])).toMatchObject({ onOrderQty: 5, effectiveQty: 7 });
    const draft = await service.createDraftPoFromReplenishment(businessId, "owner", "s4", "draft-key", { branchId: null, supplierId: supplier.id, lines: [{ productId: products[0]!, quantity: 2 }] }, ["purchase_order.write"]);
    expect((draft as { purchaseOrder: { status: string; supplierId: string } }).purchaseOrder).toMatchObject({ status: "DRAFT", supplierId: supplier.id });
    expect((await db.findBalance(products[0]!, businessId, null))?.qtyOnHand).toBe(2);
  });
});
