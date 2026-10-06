import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/common/memory.db";
import { ReservationService } from "../src/orders/reservation-service";
import { OrderService } from "../src/orders/order-service";
import { OrderExpiryService } from "../src/orders/order-expiry-service";
import { DisabledPayMongo } from "../src/payments/paymongo";
import { SalesService } from "../src/sales/nest/sales.service";
import { TransferService } from "../src/transfers/nest/transfer.service";
import { ProcurementService } from "../src/procurement/nest/procurement.service";
import { InventoryCountService } from "../src/inventory/nest/inventory-count.service";
import { FulfillmentService } from "../src/orders/fulfillment-service";

async function setupLastUnit() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Race", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id, categoryId: null, name: "Last", sku: "LAST", barcode: null, brand: null,
    unit: "pc", costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
    trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: business.id, branchId: branch.id, productId: product.id, qtyOnHand: 1 });
  const makeOrder = async (suffix: string) => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const order = await db.createOrder({
      businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: branch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 100, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "order-" + suffix, createdAt: now, updatedAt: now,
    });
    await db.createOrderLine({
      businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: product.name,
      sku: product.sku, barcode: product.barcode, unit: product.unit, qty: 1, priceMinor: 100, costMinor: 10,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 100, bundleComponentsSnapshot: null, createdAt: now,
    });
    return order;
  };
  return { db, business, branch, product, makeOrder };
}

describe("phase22 reservation concurrency contract", () => {
  it("serializes two last-unit Order holds and creates no inventory movement", async () => {
    const { db, business, product, makeOrder } = await setupLastUnit();
    const [a, b] = await Promise.all([makeOrder("a"), makeOrder("b")]);
    const reservations = new ReservationService(db);
    const holdNow = new Date();
    const results = await Promise.allSettled([
      reservations.holdSubmittedOrder(business.id, a.id, "hold-a", holdNow),
      reservations.holdSubmittedOrder(business.id, b.id, "hold-b", holdNow),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
    expect((results.find((row) => row.status === "rejected") as PromiseRejectedResult).reason.message)
      .toBe("RESERVATION_CONFLICT");
    expect(await db.listMovements(product.id, business.id, null)).toEqual([]);
    expect((await db.listReservationsByOrder(a.id, business.id)).filter((row) => row.status === "HELD").length +
      (await db.listReservationsByOrder(b.id, business.id)).filter((row) => row.status === "HELD").length).toBe(1);
  });

  it("acceptance versus expiry produces exactly one coherent terminal outcome", async () => {
    const { db, business, makeOrder } = await setupLastUnit();
    const order = await makeOrder("accept-expire");
    const reservations = new ReservationService(db);
    const now = new Date();
    await reservations.holdSubmittedOrder(business.id, order.id, "hold-race", now);
    const hold = (await db.listReservationsByOrder(order.id, business.id))[0]!;
    await db.updateInventoryReservation(hold.id, business.id, { expiresAt: now });
    const orders = new OrderService(db);
    const expiry = new OrderExpiryService(db, new DisabledPayMongo());
    await Promise.allSettled([
      orders.acceptPayAtPickup(business.id, "staff", "accept", order.id, order.version, "accept-key", now),
      expiry.sweep(now),
    ]);
    const finalOrder = (await db.findOrderById(order.id, business.id))!;
    const finalHold = (await db.listReservationsByOrder(order.id, business.id))[0]!;
    const coherent =
      (finalOrder.status === "CONFIRMED" && finalHold.status === "HELD" && finalHold.expiresAt === null)
      || (finalOrder.status === "EXPIRED" && finalHold.status === "EXPIRED");
    expect(coherent).toBe(true);
  });

  it("prevents a POS Sale from consuming stock held by a WEB Order", async () => {
    const { db, business, branch, product, makeOrder } = await setupLastUnit();
    const order = await makeOrder("hold-vs-pos");
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "hold-pos", new Date());
    const sales = new SalesService(db);
    const draft = await sales.createDraft(business.id, "cashier", "pos-draft", {
      lines: [{ productId: product.id, qty: 1, lineDiscountMinor: 0 }],
      orderDiscountMinor: 0,
      branchId: branch.id,
    }, []);
    await expect(sales.completeSale(business.id, "cashier", "pos-complete", draft.id, {
      payments: [{ method: "cash", amountMinor: draft.totalMinor }],
      key: "pos-complete-held",
      granted: [],
      branchId: branch.id,
    })).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await db.findBalance(product.id, business.id, branch.id))?.qtyOnHand).toBe(1);
    expect((await db.listMovements(product.id, business.id, branch.id)).filter((row) => row.type === "sale")).toHaveLength(0);
  });

  it("prevents transfer dispatch, supplier return, and negative count from consuming HELD stock", async () => {
    const transferDb = createMemoryDb();
    const transferBusiness = await transferDb.createBusiness({ name: "Transfer held", currency: "PHP" });
    const from = await transferDb.createBranch({ businessId: transferBusiness.id, name: "From", type: "store", isActive: true });
    const to = await transferDb.createBranch({ businessId: transferBusiness.id, name: "To", type: "store", isActive: true });
    const transferProduct = await transferDb.createProduct({
      businessId: transferBusiness.id, categoryId: null, name: "Held", sku: "T", barcode: null, brand: null,
      unit: "pc", costMinor: 10, priceMinor: 100, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await transferDb.upsertBalance({ businessId: transferBusiness.id, branchId: from.id, productId: transferProduct.id, qtyOnHand: 10 });
    const transferNow = new Date();
    const transferOrder = await transferDb.createOrder({
      businessId: transferBusiness.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
      branchId: from.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 700, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 700, saleId: null, status: "SUBMITTED",
      version: 1, checkoutAt: transferNow, submittedAt: transferNow, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "transfer-hold", createdAt: transferNow, updatedAt: transferNow,
    });
    const transferLine = await transferDb.createOrderLine({
      businessId: transferBusiness.id, orderId: transferOrder.id, position: 0, productId: transferProduct.id, name: "Held",
      sku: "T", barcode: null, unit: "pc", qty: 7, priceMinor: 100, costMinor: 10,
      taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 700, bundleComponentsSnapshot: null, createdAt: transferNow,
    });
    await transferDb.createInventoryReservation({
      businessId: transferBusiness.id, branchId: from.id, orderId: transferOrder.id, orderLineId: transferLine.id,
      productId: transferProduct.id, qty: 7, status: "HELD", expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: "transfer-held-res", createdAt: transferNow, updatedAt: transferNow,
    });
    const transfers = new TransferService(transferDb);
    const transfer = await transfers.createTransfer(transferBusiness.id, "owner", "transfer-create", {
      fromBranchId: from.id, toBranchId: to.id, lines: [{ productId: transferProduct.id, qty: 4 }],
    }, ["inventory.adjust"]);
    await expect(transfers.dispatchTransfer(transferBusiness.id, "owner", "transfer-dispatch", transfer.id, "transfer-dispatch-key"))
      .rejects.toThrow("RESERVATION_CONFLICT");
    expect((await transferDb.findBalance(transferProduct.id, transferBusiness.id, from.id))?.qtyOnHand).toBe(10);

    const procurementDb = createMemoryDb();
    const procurement = new ProcurementService(procurementDb);
    const pBiz = await procurementDb.createBusiness({ name: "Return held", currency: "PHP" });
    const pBranch = await procurementDb.createBranch({ businessId: pBiz.id, name: "Main", type: "store", isActive: true });
    const pProduct = await procurementDb.createProduct({
      businessId: pBiz.id, categoryId: null, name: "P", sku: "P", barcode: null, brand: null,
      unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0,
      trackInventory: true, isActive: true, imageUrl: null,
    });
    await procurementDb.createMovement({ businessId: pBiz.id, productId: pProduct.id, type: "opening_stock", qtyDelta: 8, reason: null, referenceType: null, referenceId: null, actorId: "seed", requestId: "seed", branchId: pBranch.id });
    await procurementDb.upsertBalance({ businessId: pBiz.id, branchId: pBranch.id, productId: pProduct.id, qtyOnHand: 8 });
    const write = ["supplier.write", "purchase_order.write", "purchase_order.order", "purchase_order.receive", "supplier_return.write", "supplier_return.post"];
    const supplier = await procurement.createSupplier(pBiz.id, "owner", "s1", "supplier-held", { name: "Supplier" }, write);
    const po = await procurement.createPurchaseOrder(pBiz.id, "owner", "s2", "po-held", { supplierId: supplier.supplier.id, branchId: pBranch.id, lines: [{ productId: pProduct.id, quantity: 1 }] }, write);
    const ordered = await procurement.orderPurchaseOrder(pBiz.id, "owner", "s3", po.purchaseOrder.id, "po-order-held", po.purchaseOrder.version, write);
    await procurement.receivePurchaseOrder(pBiz.id, "owner", "s4", po.purchaseOrder.id, "po-receive-held", { lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantityReceived: 1 }] }, write);
    const returned = await procurement.createSupplierReturn(pBiz.id, "owner", "s5", "return-held", { supplierId: supplier.supplier.id, purchaseOrderId: po.purchaseOrder.id, reason: "Return", lines: [{ purchaseOrderLineId: ordered.purchaseOrder.lines[0]!.id, quantity: 1 }] }, write);
    const pNow = new Date();
    const pOrder = await procurementDb.createOrder({ businessId: pBiz.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP", branchId: pBranch.id, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567", deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 900, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 900, saleId: null, status: "SUBMITTED", version: 1, checkoutAt: pNow, submittedAt: pNow, confirmedAt: null, completedAt: null, cancelledAt: null, actorId: "public", requestId: "return-hold-order", createdAt: pNow, updatedAt: pNow });
    const pLine = await procurementDb.createOrderLine({ businessId: pBiz.id, orderId: pOrder.id, position: 0, productId: pProduct.id, name: pProduct.name, sku: pProduct.sku, barcode: null, unit: pProduct.unit, qty: 9, priceMinor: 100, costMinor: 100, taxRateBps: null, discountMinor: 0, taxMinor: 0, lineTotalMinor: 900, bundleComponentsSnapshot: null, createdAt: pNow });
    await procurementDb.createInventoryReservation({ businessId: pBiz.id, branchId: pBranch.id, orderId: pOrder.id, orderLineId: pLine.id, productId: pProduct.id, qty: 9, status: "HELD", expiresAt: new Date(Date.now() + 60_000), idempotencyKey: "return-held-res", createdAt: pNow, updatedAt: pNow });
    await expect(procurement.postSupplierReturn(pBiz.id, "owner", "s6", returned.supplierReturn.id, "return-post-held", returned.supplierReturn.version, write))
      .rejects.toThrow("RESERVATION_CONFLICT");

    const countService = new InventoryCountService(procurementDb, procurement);
    const count = await countService.createCount(pBiz.id, "owner", "c1", { scopeType: "PARTIAL", name: "Held", branchId: pBranch.id, productIds: [pProduct.id] }, ["inventory.adjust", "purchase_order.write"]);
    const started = await countService.startCount(pBiz.id, "owner", "c2", count.id, count.version, ["inventory.adjust", "purchase_order.write"]);
    const updated = await countService.updateLines(pBiz.id, "owner", "c3", count.id, { expectedVersion: started.version, lines: [{ lineId: started.lines[0]!.id, countedQty: 8 }] }, ["inventory.adjust", "purchase_order.write"]);
    const submitted = await countService.submitCount(pBiz.id, "owner", "c4", count.id, updated.version, ["inventory.adjust", "purchase_order.write"]);
    const approved = await countService.approveCount(pBiz.id, "owner", "c5", count.id, submitted.version, ["inventory.adjust", "purchase_order.write"]);
    await expect(countService.postCount(pBiz.id, "owner", "c6", count.id, "count-post-held", approved.version, ["inventory.adjust", "purchase_order.write"]))
      .rejects.toThrow("RESERVATION_CONFLICT");
  });

  it("replays cancellation/release and fulfillment transitions without duplicate effects", async () => {
    const { db, business, makeOrder } = await setupLastUnit();
    const order = await makeOrder("replay");
    const now = new Date();
    await new ReservationService(db).holdSubmittedOrder(business.id, order.id, "replay-hold", now);
    const orders = new OrderService(db);
    const confirmed = await orders.acceptPayAtPickup(business.id, "owner", "accept-replay", order.id, order.version, "accept-replay-key", now);
    const fulfillment = (await db.listFulfillmentsByOrder(order.id, business.id))[0]!;
    const fulfillments = new FulfillmentService(db);
    const ready = await fulfillments.transition(business.id, "owner", "ready-replay", order.id, fulfillment.id, "READY", fulfillment.version, "ready-replay-key");
    const readyReplay = await fulfillments.transition(business.id, "owner", "ready-replay-2", order.id, fulfillment.id, "READY", fulfillment.version, "ready-replay-key");
    expect(readyReplay.version).toBe(ready.version);
    const cancelled = await orders.cancelOrder(business.id, "owner", "cancel-replay", order.id, confirmed.version, "cancel-replay-key", "Customer request");
    const replay = await orders.cancelOrder(business.id, "owner", "cancel-replay-2", order.id, confirmed.version, "cancel-replay-key", "Customer request");
    expect(replay.id).toBe(cancelled.id);
    expect((await db.listReservationsByOrder(order.id, business.id)).filter((row) => row.status === "RELEASED")).toHaveLength(1);
  });
});
