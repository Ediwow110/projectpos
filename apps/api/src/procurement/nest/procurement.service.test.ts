import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ProcurementService } from "./procurement.service";

const WRITE = ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.cancel", "purchase_order.receive", "supplier_return.write", "supplier_return.post", "supplier_return.cancel"];

async function setup() {
  const db = createMemoryDb();
  const svc = new ProcurementService(db);
  const business = await db.createBusiness({ name: "Procurement", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const productA = await db.createProduct({ businessId: business.id, categoryId: null, name: "Product A", sku: "A", barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
  const productB = await db.createProduct({ businessId: business.id, categoryId: null, name: "Product B", sku: "B", barcode: null, brand: null, unit: "pc", costMinor: 250, priceMinor: 400, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
  await db.createMovement({ businessId: business.id, productId: productA.id, type: "opening_stock", qtyDelta: 8, reason: null, referenceType: null, referenceId: null, actorId: "seed", requestId: "seed", branchId: branch.id });
  await db.upsertBalance({ businessId: business.id, productId: productA.id, branchId: branch.id, qtyOnHand: 8 });
  return { db, svc, businessId: business.id, branchId: branch.id, productA, productB };
}

describe("Phase 16 procurement service", () => {
  it("runs supplier → mapping → draft → edit → order without inventory effects", async () => {
    const { db, svc, businessId, branchId, productA, productB } = await setup();
    const beforeMovements = await db.listMovementsByBusiness(businessId);
    const beforeBalances = await db.listBalances(businessId);
    const supplierInput = { name: " ACME Foods ", code: " acme " };
    const created = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", supplierInput, WRITE);
    const replay = await svc.createSupplier(businessId, "owner", "r2", "supplier-key", supplierInput, WRITE);
    expect(replay.replayed).toBe(true);
    expect(created.supplier.code).toBe("ACME");

    const mapping = await svc.createProductSupplier(businessId, "owner", "r3", created.supplier.id, { productId: productA.id, supplierSku: "A-ACME", unitCostMinor: 125, isPreferred: true }, WRITE);
    expect(mapping.isPreferred).toBe(true);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "r4", "po-create", { supplierId: created.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 2 }, { productId: productB.id, quantity: 3, unitCostMinor: 300 }] }, WRITE);
    expect(draft.purchaseOrder.status).toBe("DRAFT");
    expect(draft.purchaseOrder.lines.map((line) => line.unitCostMinor)).toEqual([125, 300]);
    expect(draft.purchaseOrder.totalMinor).toBe(1150);
    const updated = await svc.updatePurchaseOrder(businessId, "owner", "r5", draft.purchaseOrder.id, 1, { lines: [{ productId: productA.id, quantity: 4 }] }, WRITE);
    expect(updated.version).toBe(2);
    expect(updated.totalMinor).toBe(500);
    const ordered = await svc.orderPurchaseOrder(businessId, "owner", "r6", draft.purchaseOrder.id, "order-key", updated.version, WRITE);
    expect(ordered.purchaseOrder.status).toBe("ORDERED");
    expect(ordered.purchaseOrder.lines[0]?.supplierSkuSnapshot).toBe("A-ACME");
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r7", draft.purchaseOrder.id, ordered.purchaseOrder.version, { notes: "late" }, WRITE)).rejects.toThrow("PURCHASE_ORDER_INVALID_STATE");
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r8", draft.purchaseOrder.id, 1, { notes: "stale" }, WRITE)).rejects.toThrow("PURCHASE_ORDER_INVALID_STATE");
    const cancelled = await svc.cancelPurchaseOrder(businessId, "owner", "r9", draft.purchaseOrder.id, "cancel-key", "Supplier changed", ordered.purchaseOrder.version, WRITE);
    expect(cancelled.purchaseOrder.status).toBe("CANCELLED");
    expect(await db.listMovementsByBusiness(businessId)).toEqual(beforeMovements);
    expect(await db.listBalances(businessId)).toEqual(beforeBalances);
    expect((await db.listAudit()).map((row) => row.action)).toEqual(expect.arrayContaining(["supplier.create", "product_supplier.create", "purchase_order.create", "purchase_order.update", "purchase_order.ordered", "purchase_order.cancelled"]));
  });

  it("rejects stale drafts, inactive suppliers, duplicate mappings, and cashier writes", async () => {
    const { svc, businessId, branchId, productA, productB } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", { name: "ACME" }, WRITE);
    await expect(svc.createSupplier(businessId, "cashier", "r2", "cashier-key", { name: "Nope" }, [])).rejects.toThrow("FORBIDDEN");
    await svc.createProductSupplier(businessId, "owner", "r3", supplier.supplier.id, { productId: productA.id, unitCostMinor: 100 }, WRITE);
    await expect(svc.createProductSupplier(businessId, "owner", "r3-invalid", supplier.supplier.id, { productId: productB.id, unitCostMinor: -1 }, WRITE)).rejects.toThrow("VALIDATION");
    await expect(svc.createProductSupplier(businessId, "owner", "r4", supplier.supplier.id, { productId: productA.id }, WRITE)).rejects.toThrow("PRODUCT_SUPPLIER_DUPLICATE");
    await svc.setSupplierActive(businessId, "owner", "r5", supplier.supplier.id, false, WRITE);
    await expect(svc.createPurchaseOrder(businessId, "owner", "r6", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [] }, WRITE)).rejects.toThrow("SUPPLIER_INACTIVE");
  });

  it("rejects conflicting idempotency payloads and stale version updates", async () => {
    const { svc, businessId, branchId, productA } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "r1", "supplier-key", { name: "ACME" }, WRITE);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "r2", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 1 }] }, WRITE);
    await expect(svc.createPurchaseOrder(businessId, "owner", "r3", "po-key", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 2 }] }, WRITE)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await svc.updatePurchaseOrder(businessId, "owner", "r4", draft.purchaseOrder.id, 1, { notes: "new" }, WRITE);
    await expect(svc.updatePurchaseOrder(businessId, "owner", "r5", draft.purchaseOrder.id, 1, { notes: "lost" }, WRITE)).rejects.toThrow("STALE_VERSION");
  });
});

describe("Phase 17 receiving and supplier returns", () => {
  it("receives partially, completes exactly once, and returns stock without changing product cost", async () => {
    const { db, svc, businessId, branchId, productA } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "r10", "supplier-key-17", { name: "ACME" }, WRITE);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "r11", "po-key-17", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 10, unitCostMinor: 125 }] }, WRITE);
    const lineId = draft.purchaseOrder.lines[0]!.id;
    const first = await svc.orderPurchaseOrder(businessId, "owner", "r12", draft.purchaseOrder.id, "order-key-17", draft.purchaseOrder.version, WRITE);
    const received1 = await svc.receivePurchaseOrder(businessId, "owner", "r13", draft.purchaseOrder.id, "receipt-key-17-a", { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 4 }] }, WRITE);
    expect(received1.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(12);
    expect((await db.listMovements(productA.id, businessId, branchId)).filter((m) => m.type === "receive")).toHaveLength(1);
    await expect(svc.receivePurchaseOrder(businessId, "owner", "r14", draft.purchaseOrder.id, "receipt-key-17-bad", { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 7 }] }, WRITE)).rejects.toThrow("RECEIPT_EXCEEDS_OUTSTANDING");
    const replay = await svc.receivePurchaseOrder(businessId, "owner", "r15", draft.purchaseOrder.id, "receipt-key-17-a", { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 4 }] }, WRITE);
    expect(replay.replayed).toBe(true);
    const received2 = await svc.receivePurchaseOrder(businessId, "owner", "r16", draft.purchaseOrder.id, "receipt-key-17-b", { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 6 }] }, WRITE);
    expect(received2.purchaseOrder.status).toBe("RECEIVED");
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(18);
    expect((await db.findProductById(productA.id, businessId))?.costMinor).toBe(100);
    const createdReturn = await svc.createSupplierReturn(businessId, "owner", "r17", "return-key-17", { supplierId: supplier.supplier.id, purchaseOrderId: draft.purchaseOrder.id, reason: "Damaged delivery", lines: [{ purchaseOrderLineId: lineId, quantity: 3 }] }, WRITE);
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(18);
    const posted = await svc.postSupplierReturn(businessId, "owner", "r18", createdReturn.supplierReturn.id, "return-post-key-17", createdReturn.supplierReturn.version, WRITE);
    expect(posted.supplierReturn.status).toBe("POSTED");
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(15);
    const supplierMoves = (await db.listMovements(productA.id, businessId, branchId)).filter((m) => m.type === "supplier_return");
    expect(supplierMoves).toHaveLength(1);
    expect(supplierMoves[0]?.qtyDelta).toBe(-3);
    const returnReplay = await svc.postSupplierReturn(businessId, "owner", "r19", createdReturn.supplierReturn.id, "return-post-key-17", createdReturn.supplierReturn.version, WRITE);
    expect(returnReplay.replayed).toBe(true);
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(15);
    void first;
  });

  it("denies cashier receiving and supplier return writes", async () => {
    const { svc, businessId } = await setup();
    await expect(svc.receivePurchaseOrder(businessId, "cashier", "cashier-r", "missing", "key-cashier-17", { lines: [] }, [])).rejects.toThrow("FORBIDDEN");
    await expect(svc.createSupplierReturn(businessId, "cashier", "cashier-r2", "key-cashier-17b", { supplierId: "s", purchaseOrderId: "p", reason: "No", lines: [] }, [])).rejects.toThrow("FORBIDDEN");
  });

  it("rejects supplier-return posting that would consume HELD Order stock", async () => {
    const { db, svc, businessId, branchId, productA } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "h1", "h-supplier", { name: "Held Supplier" }, WRITE);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "h2", "h-po", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 1 }] }, WRITE);
    const ordered = await svc.orderPurchaseOrder(businessId, "owner", "h3", draft.purchaseOrder.id, "h-order", draft.purchaseOrder.version, WRITE);
    await svc.receivePurchaseOrder(businessId, "owner", "h4", draft.purchaseOrder.id, "h-receive", { lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantityReceived: 1 }] }, WRITE);
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(9);
    const returned = await svc.createSupplierReturn(businessId, "owner", "h5", "h-return", { supplierId: supplier.supplier.id, purchaseOrderId: draft.purchaseOrder.id, reason: "Return", lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantity: 1 }] }, WRITE);
    const now = new Date();
    const order = await db.createOrder({ businessId, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP", branchId, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 900, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 900, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "h-order", createdAt: now, updatedAt: now });
    const line = await db.createOrderLine({ businessId, orderId: order.id, position: 0, productId: productA.id, name: productA.name, sku: productA.sku, barcode: null, unit: productA.unit, qty: 9, priceMinor: 100, costMinor: 100, taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 900, bundleComponentsSnapshot: null, createdAt: now });
    await db.createInventoryReservation({ businessId, branchId, orderId: order.id, orderLineId: line.id, productId: productA.id, qty: 9, status: "HELD", expiresAt: new Date(Date.now() + 60_000), idempotencyKey: "h-res", createdAt: now, updatedAt: now });
    await expect(svc.postSupplierReturn(businessId, "owner", "h6", returned.supplierReturn.id, "h-post", returned.supplierReturn.version, WRITE)).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await db.findBalance(productA.id, businessId, branchId))?.qtyOnHand).toBe(9);
    expect((await db.listMovements(productA.id, businessId, branchId)).filter((m) => m.type === "supplier_return")).toHaveLength(0);
  });

  it("includes supplier-return audit events in purchase-order history", async () => {
    const { svc, businessId, branchId, productA } = await setup();
    const supplier = await svc.createSupplier(businessId, "owner", "audit-r1", "audit-supplier-key", { name: "Audit Supplier" }, WRITE);
    const draft = await svc.createPurchaseOrder(businessId, "owner", "audit-r2", "audit-po-key", { supplierId: supplier.supplier.id, branchId, lines: [{ productId: productA.id, quantity: 2 }] }, WRITE);
    const ordered = await svc.orderPurchaseOrder(businessId, "owner", "audit-r3", draft.purchaseOrder.id, "audit-order-key", draft.purchaseOrder.version, WRITE);
    const received = await svc.receivePurchaseOrder(businessId, "owner", "audit-r4", draft.purchaseOrder.id, "audit-receive-key", { lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantityReceived: 1 }] }, WRITE);
    const created = await svc.createSupplierReturn(businessId, "owner", "audit-r5", "audit-return-key", { supplierId: supplier.supplier.id, purchaseOrderId: draft.purchaseOrder.id, reason: "Audit cancellation", lines: [{ purchaseOrderLineId: received.purchaseOrder.lines[0]!.id, quantity: 1 }] }, WRITE);
    await svc.cancelSupplierReturn(businessId, "owner", "audit-r6", created.supplierReturn.id, created.supplierReturn.version, WRITE);

    const events = await svc.listPurchaseOrderEvents(businessId, draft.purchaseOrder.id);
    expect(events.some((event) => event.action === "supplier_return.cancelled" && event.entityId === created.supplierReturn.id)).toBe(true);
  });
});
