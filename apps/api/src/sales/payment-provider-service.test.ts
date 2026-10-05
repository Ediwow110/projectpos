import { describe, expect, it, vi } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import type { DbSale } from "../common/db.port";
import type {
  PayMongoCheckoutInput,
  PayMongoCheckoutResult,
  PayMongoCheckoutSnapshot,
  PayMongoPort,
} from "../payments/paymongo";
import { SalesPaymentProviderService } from "./payment-provider-service";

class FakePayMongo implements PayMongoPort {
  paid = false;
  status: PayMongoCheckoutSnapshot["status"] = "active";
  lastInput: PayMongoCheckoutInput | null = null;

  configured(): boolean { return true; }

  async createCheckout(input: PayMongoCheckoutInput): Promise<PayMongoCheckoutResult> {
    this.lastInput = input;
    return {
      sessionId: "cs_sale_1",
      checkoutUrl: "https://checkout.paymongo.test/cs_sale_1",
    };
  }

  async retrieveCheckout(sessionId: string): Promise<PayMongoCheckoutSnapshot> {
    return {
      sessionId,
      checkoutUrl: "https://checkout.paymongo.test/" + sessionId,
      status: this.status,
      paid: this.paid,
    };
  }

  verifyWebhook(): boolean { return true; }
}

async function setup() {
  const db = createMemoryDb();
  const sale = await db.createSale({
    businessId: "b1",
    receiptNo: "2026-000001",
    status: "DRAFT",
    subtotalMinor: 2500,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 2500,
    paidMinor: 0,
    changeMinor: 0,
    currency: "PHP",
    customerId: null,
    customerName: null,
    notes: null,
    actorId: "u1",
    requestId: "r1",
    idempotencyKey: null,
    registerId: null,
    branchId: null,
    createdAt: new Date("2026-09-20T00:00:00.000Z"),
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
  const paymongo = new FakePayMongo();
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
  const service = new SalesPaymentProviderService(db, paymongo, {
    requireSale,
    embedSale,
    assertStockAvailable: async () => undefined,
  });
  return { db, sale, paymongo, service };
}

describe("sales payment provider service", () => {
  it("passes a linked Order id to the stock preflight so its own hold is excluded", async () => {
    const { db, sale, paymongo } = await setup();
    const now = new Date();
    const order = await db.createOrder({
      businessId: "b1", channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PREPAID",
      branchId: null, customerId: null, contactName: "Ana", email: "ana@example.com", phone: "+639171234567",
      deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 2500, discountMinor: 0,
      taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 2500, saleId: sale.id, status: "SUBMITTED",
      version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null, completedAt: null, cancelledAt: null,
      actorId: "public", requestId: "order-owner", createdAt: now, updatedAt: now,
    });
    const requireSale = async (businessId: string, saleId: string): Promise<DbSale> => {
      const row = await db.findSaleById(saleId, businessId);
      if (!row) throw new Error("NOT_FOUND");
      return row;
    };
    const assertStockAvailable = vi.fn(async () => undefined);
    const service = new SalesPaymentProviderService(db, paymongo, {
      requireSale,
      embedSale: async (row) => ({
        ...row,
        items: await db.listSaleItems(row.id, row.businessId),
        payments: await db.listPaymentsBySale(row.id, row.businessId),
      }),
      assertStockAvailable,
    });

    await service.startPayMongoCheckout("b1", "u1", "req-owner", sale.id, "card", "owner-key", "https://nexpos.example");
    expect(assertStockAvailable).toHaveBeenCalledWith("b1", expect.any(Array), null, order.id);
  });

  it("starts and replays one PayMongo checkout without duplicating the payment", async () => {
    const { db, sale, paymongo, service } = await setup();

    const first = await service.startPayMongoCheckout(
      "b1",
      "u1",
      "req-1",
      sale.id,
      "qrph",
      "checkout-key",
      "https://nexpos.example/",
    );
    expect(first.replayed).toBe(false);
    expect(first.checkoutSessionId).toBe("cs_sale_1");
    expect(first.checkoutUrl).toBe("https://checkout.paymongo.test/cs_sale_1");
    expect(paymongo.lastInput).toMatchObject({
      businessId: "b1",
      method: "qrph",
      successUrl: `https://nexpos.example/sales/${sale.id}?paymongo=success`,
      cancelUrl: `https://nexpos.example/sales/${sale.id}?paymongo=cancelled`,
    });

    const replay = await service.startPayMongoCheckout(
      "b1",
      "u1",
      "req-2",
      sale.id,
      "qrph",
      "checkout-key",
      "https://nexpos.example",
    );
    expect(replay.replayed).toBe(true);
    expect((await db.listPaymentsBySale(sale.id, "b1"))).toHaveLength(1);
  });

  it("rejects an idempotency key reused with different checkout parameters", async () => {
    const { sale, service } = await setup();

    await service.startPayMongoCheckout(
      "b1",
      "u1",
      "req-1",
      sale.id,
      "qrph",
      "checkout-key-conflict",
      "https://nexpos.example",
    );

    await expect(
      service.startPayMongoCheckout(
        "b1",
        "u1",
        "req-2",
        sale.id,
        "card",
        "checkout-key-conflict",
        "https://nexpos.example",
      ),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });

  it("does not create a second checkout while an existing PayMongo session is uncertain", async () => {
    const { db, sale, paymongo, service } = await setup();

    await service.startPayMongoCheckout(
      "b1",
      "u1",
      "req-1",
      sale.id,
      "gcash",
      "checkout-key-uncertain-1",
      "https://nexpos.example",
    );
    paymongo.status = "unknown";

    await expect(
      service.startPayMongoCheckout(
        "b1",
        "u1",
        "req-2",
        sale.id,
        "gcash",
        "checkout-key-uncertain-2",
        "https://nexpos.example",
      ),
    ).rejects.toThrow("PAYMENT_PROVIDER_UNAVAILABLE");

    const payments = await db.listPaymentsBySale(sale.id, "b1");
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ method: "gcash", status: "PENDING" });
  });

  it("maps PayMongo provider snapshots to reconciliation verdicts", async () => {
    const { sale, paymongo, service } = await setup();
    const checkout = await service.startPayMongoCheckout(
      "b1",
      "u1",
      "req-1",
      sale.id,
      "card",
      "checkout-key-2",
      "https://nexpos.example",
    );

    expect(await service.queryProvider("b1", checkout.payment.id, "paymongo")).toEqual({ status: "UNKNOWN" });
    paymongo.paid = true;
    expect(await service.queryProvider("b1", checkout.payment.id, "paymongo")).toEqual({ status: "SUCCEEDED" });
    paymongo.paid = false;
    paymongo.status = "expired";
    expect(await service.queryProvider("b1", checkout.payment.id, "paymongo")).toEqual({ status: "FAILED" });
  });
});
