import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";

function orderInput(businessId: string, branchId: string) {
  const now = new Date("2026-10-06T12:00:00.000Z");
  return {
    businessId,
    channel: "WEB",
    fulfillmentMode: "PICKUP",
    paymentMode: "PREPAID",
    branchId,
    customerId: null,
    contactName: "Ana Reyes",
    email: "ana@example.com",
    phone: "+639171234567",
    deliveryAddress: null,
    fulfillmentInstructions: "Call on arrival",
    currency: "PHP",
    subtotalMinor: 1000,
    discountMinor: 0,
    taxMinor: 120,
    deliveryFeeMinor: 0,
    deliveryTaxMinor: 0,
    totalMinor: 1120,
    saleId: null,
    status: "SUBMITTED",
    version: 1,
    checkoutAt: now,
    submittedAt: now,
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
    actorId: "public:test",
    requestId: "req-order-1",
    createdAt: now,
    updatedAt: now,
  };
}

async function seed(db: any) {
  const business = await db.createBusiness({ name: "PG Store", currency: "PHP" });
  const branch = await db.createBranch({ businessId: business.id, name: "Main", type: "store", isActive: true });
  const product = await db.createProduct({
    businessId: business.id,
    categoryId: null,
    name: "Coffee",
    sku: "COF-1",
    barcode: null,
    brand: null,
    unit: "pc",
    costMinor: 500,
    priceMinor: 1000,
    taxRateBps: 1200,
    reorderLevel: 0,
    trackInventory: true,
    isActive: true,
    imageUrl: null,
  });
  return { business, branch, product };
}

describe("phase22 pg order persistence", () => {
  it("stores Order + submitted OrderLine snapshots and version", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch, product } = await seed(db);
      const order = await db.createOrder(orderInput(business.id, branch.id));
      const line = await db.createOrderLine({
        businessId: business.id,
        orderId: order.id,
        position: 0,
        productId: product.id,
        name: "Coffee",
        sku: "COF-1",
        barcode: null,
        unit: "pc",
        qty: 1,
        priceMinor: 1000,
        costMinor: 500,
        taxRateBps: 1200,
        discountMinor: 0,
        taxMinor: 120,
        lineTotalMinor: 1120,
        bundleComponentsSnapshot: [{ componentProductId: product.id, componentNameSnapshot: "Coffee", quantityPerBundleSnapshot: 1, costMinorSnapshot: 500, compositionVersion: 1 }],
        createdAt: order.createdAt,
      });
      expect(await db.findOrderById(order.id, business.id)).toEqual(order);
      expect(await db.listOrderLines(order.id, business.id)).toEqual([line]);
      expect(order.version).toBe(1);
    });
  });

  it("enforces one Order per Sale and one Sale per Order", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch } = await seed(db);
      const sale = await db.createSale({
        businessId: business.id, receiptNo: "2026-000001", status: "DRAFT",
        subtotalMinor: 1000, discountMinor: 0, taxMinor: 120, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
        totalMinor: 1120, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
        notes: null, actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, branchId: branch.id,
        completedAt: null, voidedAt: null, voidReason: null, createdAt: new Date(),
      });
      const first = await db.createOrder({ ...orderInput(business.id, branch.id), saleId: sale.id });
      expect(first.saleId).toBe(sale.id);
      await expect(db.createOrder({ ...orderInput(business.id, branch.id), requestId: "r2", saleId: sale.id })).rejects.toBeTruthy();
      expect((await db.findOrderBySaleId(sale.id, business.id))?.id).toBe(first.id);
    });
  });

  it("stores HELD reservation with nullable expiresAt", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch, product } = await seed(db);
      const order = await db.createOrder(orderInput(business.id, branch.id));
      const line = await db.createOrderLine({
        businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: "Coffee",
        sku: "COF-1", barcode: null, unit: "pc", qty: 1, priceMinor: 1000, costMinor: 500,
        taxRateBps: 1200, discountMinor: 0, taxMinor: 120, lineTotalMinor: 1120,
        bundleComponentsSnapshot: null, createdAt: order.createdAt,
      });
      const row = await db.createInventoryReservation({
        businessId: business.id, branchId: branch.id, orderId: order.id, orderLineId: line.id,
        productId: product.id, qty: 1, status: "HELD", expiresAt: null,
        idempotencyKey: "hold:1", createdAt: order.createdAt, updatedAt: order.createdAt,
      });
      expect(row.expiresAt).toBeNull();
      expect(await db.listReservationsByOrder(order.id, business.id)).toEqual([row]);
    });
  });

  it("lists only aged non-expiring HELD operational reservations", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch, product } = await seed(db);
      const now = new Date("2026-10-06T12:00:00.000Z");
      const make = async (suffix: string, createdAt: Date, expiresAt: Date | null, status = "HELD") => {
        const order = await db.createOrder({ ...orderInput(business.id, branch.id), requestId: "aged-" + suffix, createdAt, updatedAt: createdAt });
        const line = await db.createOrderLine({
          businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: "Coffee",
          sku: "COF-1", barcode: null, unit: "pc", qty: 1, priceMinor: 1000, costMinor: 500,
          taxRateBps: 1200, discountMinor: 0, taxMinor: 120, lineTotalMinor: 1120,
          bundleComponentsSnapshot: null, createdAt,
        });
        return db.createInventoryReservation({
          businessId: business.id, branchId: branch.id, orderId: order.id, orderLineId: line.id,
          productId: product.id, qty: 1, status, expiresAt,
          idempotencyKey: "aged:" + suffix, createdAt, updatedAt: createdAt,
        });
      };
      const aged = await make("old", new Date("2026-10-05T11:59:59.000Z"), null);
      await make("fresh", new Date("2026-10-06T11:30:00.000Z"), null);
      await make("timed", new Date("2026-10-04T00:00:00.000Z"), new Date("2026-10-06T12:20:00.000Z"));
      await make("committed", new Date("2026-10-04T00:00:00.000Z"), null, "COMMITTED");
      expect((await db.listAgedOperationalReservations(new Date(now.getTime() - 24 * 60 * 60_000), 100)).map((row: { id: string }) => row.id)).toEqual([aged.id]);
    });
  });

  it("stores Fulfillment + FulfillmentLine allocation", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch, product } = await seed(db);
      const order = await db.createOrder(orderInput(business.id, branch.id));
      const line = await db.createOrderLine({
        businessId: business.id, orderId: order.id, position: 0, productId: product.id, name: "Coffee",
        sku: "COF-1", barcode: null, unit: "pc", qty: 2, priceMinor: 1000, costMinor: 500,
        taxRateBps: 1200, discountMinor: 0, taxMinor: 240, lineTotalMinor: 2240,
        bundleComponentsSnapshot: null, createdAt: order.createdAt,
      });
      const fulfillment = await db.createFulfillment({
        businessId: business.id, orderId: order.id, type: "PICKUP", status: "PENDING", branchId: branch.id,
        assignedUserId: null, contactName: "Ana Reyes", email: "ana@example.com", phone: "+639171234567",
        deliveryAddress: null, instructions: null, version: 1, readyAt: null, dispatchedAt: null,
        deliveredAt: null, collectedAt: null, failedAt: null, cancelledAt: null,
        createdAt: order.createdAt, updatedAt: order.createdAt,
      });
      const allocation = await db.createFulfillmentLine({
        businessId: business.id, fulfillmentId: fulfillment.id, orderLineId: line.id, qty: 2, createdAt: order.createdAt,
      });
      expect(await db.listFulfillmentsByOrder(order.id, business.id)).toEqual([fulfillment]);
      expect(await db.listFulfillmentLines(fulfillment.id, business.id)).toEqual([allocation]);
    });
  });

  it("stores/revokes OrderAccessToken by tokenHash", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch } = await seed(db);
      const order = await db.createOrder(orderInput(business.id, branch.id));
      const token = await db.createOrderAccessToken({
        businessId: business.id, orderId: order.id, kind: "STATUS", tokenHash: "b".repeat(64),
        expiresAt: new Date("2026-11-05T12:00:00.000Z"), revokedAt: null, createdAt: order.createdAt,
      });
      expect(await db.findOrderAccessTokenByHash(token.tokenHash)).toEqual(token);
      const revokedAt = new Date("2026-10-07T12:00:00.000Z");
      expect(await db.revokeOrderAccessToken(token.id, business.id, revokedAt)).toEqual({ ...token, revokedAt });
    });
  });

  it("looks up Business by storefrontKey", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const business = await db.createBusiness({ name: "Key Store", currency: "PHP" });
      const updated = await db.setBusinessStorefrontKey(business.id, "0123456789abcdef0123456789abcdef");
      expect(updated.storefrontKey).toBe("0123456789abcdef0123456789abcdef");
      expect(await db.findBusinessByStorefrontKey(updated.storefrontKey)).toEqual(updated);
    });
  });

  it("round-trips Refund delivery-refund fields", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch } = await seed(db);
      const sale = await db.createSale({
        businessId: business.id, receiptNo: "2026-000002", status: "COMPLETED",
        subtotalMinor: 1000, discountMinor: 0, taxMinor: 120, deliveryFeeMinor: 100, deliveryTaxMinor: 12,
        totalMinor: 1232, paidMinor: 1232, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
        notes: null, actorId: "u1", requestId: "r1", idempotencyKey: null, registerId: null, branchId: branch.id,
        completedAt: new Date(), voidedAt: null, voidReason: null, createdAt: new Date(),
      });
      const refund = await db.createRefund({
        businessId: business.id, saleId: sale.id, status: "APPROVED", totalMinor: 112,
        deliveryFeeRefundMinor: 100, deliveryTaxRefundMinor: 12, reason: "Delivery issue",
        requestedBy: "u1", approvedBy: "u1", requestId: "req-ref", approvedRequestId: "req-ref",
        singleStep: true,
      });
      expect((await db.listRefundsBySale(sale.id, business.id))[0]).toEqual(refund);
    });
  });

  it("applies stable bounded cursor and financial projection filters in PostgreSQL", async () => {
    await withPg(async (raw) => {
      const db = raw as any;
      const { business, branch } = await seed(db);
      const createdAt = new Date("2026-10-06T12:00:00.000Z");
      const first = await db.createOrder({ ...orderInput(business.id, branch.id), requestId: "page-1", createdAt, updatedAt: createdAt });
      const sale = await db.createSale({
        businessId: business.id, receiptNo: "2026-009999", status: "PENDING_PAYMENT",
        subtotalMinor: 100, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
        totalMinor: 100, paidMinor: 0, changeMinor: 0, currency: "PHP", customerId: null, customerName: null,
        notes: null, actorId: "u1", requestId: "sale-page", idempotencyKey: null, registerId: null, branchId: branch.id,
        completedAt: null, voidedAt: null, voidReason: null, createdAt,
      });
      const second = await db.createOrder({
        ...orderInput(business.id, branch.id), requestId: "page-2", saleId: sale.id, createdAt, updatedAt: createdAt,
      });

      const page = await db.listOrdersPage(business.id, { cursor: null, limit: 1, branchId: branch.id });
      expect(page).toHaveLength(1);
      const next = await db.listOrdersPage(business.id, {
        cursor: { createdAt: page[0].createdAt, id: page[0].id }, limit: 2, branchId: branch.id,
      });
      expect(new Set([page[0].id, ...next.map((row: { id: string }) => row.id)])).toEqual(new Set([first.id, second.id]));

      expect((await db.listOrdersPage(business.id, {
        cursor: null, limit: 10, paymentStatus: "PENDING",
      })).map((row: { id: string }) => row.id)).toEqual([second.id]);
      await db.createPayment({
        businessId: business.id, saleId: sale.id, method: "card", amountMinor: 100, status: "SUCCEEDED",
        providerRef: "provider-page", internalInstrumentType: null, internalInstrumentId: null,
        idempotencyKey: "pay-page",
      });
      expect((await db.listOrdersPage(business.id, {
        cursor: null, limit: 10, paymentStatus: "PAID",
      })).map((row: { id: string }) => row.id)).toEqual([second.id]);
    });
  });
});
