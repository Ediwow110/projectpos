import { describe, expect, it } from "vitest";

import { createMemoryDb } from "../common/memory.db";
import type { TransactionalEmailPort } from "../email/email.service";
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
  it("projects delivery fee and delivery tax distinctly", async () => {
    const { db, sale, receipts } = await setupReceipt();
    await db.updateSale(sale.id, "b1", {
      deliveryFeeMinor: 500,
      deliveryTaxMinor: 60,
      totalMinor: 3060,
    });
    const data = await receipts.receiptData("b1", sale.id);
    expect(data).toMatchObject({ deliveryFeeMinor: 500, deliveryTaxMinor: 60 });
    const download = await receipts.downloadReceipt("b1", sale.id);
    expect(download.text).toContain("DELIVERY 5.00");
    expect(download.text).toContain("DELIVERY TAX 0.60");
  });

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

  it("exposes delivery fee and delivery tax distinctly in receipt projections", async () => {
    const db = createMemoryDb();
    const sale = await db.createSale({
      businessId: "b-delivery-receipt", receiptNo: "DEL-RECEIPT", status: "COMPLETED",
      subtotalMinor: 2500, discountMinor: 0, taxMinor: 0,
      deliveryFeeMinor: 1000, deliveryTaxMinor: 120, totalMinor: 3620,
      paidMinor: 3620, changeMinor: 0, currency: "PHP", customerId: null, customerName: "Guest",
      notes: null, actorId: "u1", requestId: "delivery-receipt", idempotencyKey: null,
      registerId: null, branchId: null, completedAt: new Date(), createdAt: new Date(),
    });
    await db.createPayment({
      businessId: sale.businessId, saleId: sale.id, method: "card", amountMinor: 3620,
      status: "SUCCEEDED", providerRef: null, idempotencyKey: "delivery-receipt-pay",
    });
    const receipts = new SalesReceiptService(db);
    expect(await receipts.receiptData(sale.businessId, sale.id)).toMatchObject({
      deliveryFeeMinor: 1000,
      deliveryTaxMinor: 120,
    });
    const download = await receipts.downloadReceipt(sale.businessId, sale.id);
    expect(download.text).toContain("DELIVERY 10.00");
    expect(download.text).toContain("DELIVERY TAX 1.20");
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

  it("sends receipt email exactly once per idempotency key and persists delivery status", async () => {
    const db = createMemoryDb();
    const sent: Array<{ to: string; receiptNo: string; token: string }> = [];
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendReceiptShare(input) {
        sent.push({ to: input.to, receiptNo: input.receiptNo, token: input.token });
      },
      async sendOrderUpdate() {},
    };
    const sale = await db.createSale({
      businessId: "b1", receiptNo: "2026-000900", status: "COMPLETED",
      subtotalMinor: 1000, discountMinor: 0, taxMinor: 0, totalMinor: 1000,
      paidMinor: 1000, changeMinor: 0, currency: "PHP", customerId: null,
      customerName: "Ana", notes: null, actorId: "u1", requestId: "r1",
      idempotencyKey: "sale-1", registerId: null, branchId: null,
      createdAt: new Date("2026-09-30T00:00:00.000Z"), completedAt: new Date("2026-09-30T00:01:00.000Z"),
    });
    const receipts = new SalesReceiptService(db, email);

    const first = await receipts.sendEmailReceipt("b1", "u1", "req-email-1", sale.id, "ana@example.com", "receipt-email-key-1");
    const replay = await receipts.sendEmailReceipt("b1", "u1", "req-email-2", sale.id, "ana@example.com", "receipt-email-key-1");

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.com", receiptNo: "2026-000900" });
    expect((await receipts.listDeliveries("b1", sale.id)).items).toEqual([
      expect.objectContaining({
        channel: "email",
        recipient: "ana@example.com",
        status: "SENT",
        idempotencyKey: "receipt-email-key-1",
      }),
    ]);
  });

  it("records a failed receipt email without retrying it under the same idempotency key", async () => {
    const db = createMemoryDb();
    let attempts = 0;
    const email: TransactionalEmailPort = {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendReceiptShare() {
        attempts += 1;
        throw new Error("EMAIL_DELIVERY_FAILED");
      },
      async sendOrderUpdate() {},
    };
    const sale = await db.createSale({
      businessId: "b1", receiptNo: "2026-000901", status: "COMPLETED",
      subtotalMinor: 1000, discountMinor: 0, taxMinor: 0, totalMinor: 1000,
      paidMinor: 1000, changeMinor: 0, currency: "PHP", customerId: null,
      customerName: null, notes: null, actorId: "u1", requestId: "r1",
      idempotencyKey: "sale-2", registerId: null, branchId: null,
      createdAt: new Date("2026-09-30T00:00:00.000Z"), completedAt: new Date("2026-09-30T00:01:00.000Z"),
    });
    const receipts = new SalesReceiptService(db, email);

    await expect(
      receipts.sendEmailReceipt("b1", "u1", "req-fail-1", sale.id, "ana@example.com", "receipt-email-key-fail"),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    await expect(
      receipts.sendEmailReceipt("b1", "u1", "req-fail-2", sale.id, "ana@example.com", "receipt-email-key-fail"),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    expect(attempts).toBe(1);
    expect((await receipts.listDeliveries("b1", sale.id)).items[0]).toMatchObject({
      status: "FAILED",
      errorCode: "EMAIL_DELIVERY_FAILED",
    });
  });
});
