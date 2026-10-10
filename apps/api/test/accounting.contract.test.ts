import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";
import { JournalPostingService } from "../src/accounting/journal-posting.service";
import { buildBalancedDraft } from "../src/accounting/journal-rules";

let app: INestApplication;
let ownerCookie = "";
let csrf = "";

function cookie(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({
    ownerName: "Accounting Owner", email: `accounting-owner-${Date.now()}@example.com`, password: "correct-horse-12", businessName: "Accounting Activation Test",
  });
  ownerCookie = cookie(registration.headers["set-cookie"]);
  csrf = registration.body.csrfToken as string;
});

afterAll(async () => { await app.close(); });

describe("Phase 23 accounting activation", () => {
  it("requires a confirmed opening entry and cutoff before starting backfill", async () => {
    const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "No Opening Owner", email: `no-opening-${Date.now()}@example.com`, password: "correct-horse-12", businessName: "No Opening Backfill Test" });
    const cookieHeader = cookie(registration.headers["set-cookie"]);
    const response = await request(app.getHttpServer()).post("/api/v1/accounting/activation/backfill")
      .set("Cookie", cookieHeader).set("X-CSRF-Token", registration.body.csrfToken as string).set("Idempotency-Key", "backfill-without-open")
      .send();
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ACCOUNTING_OPENING_REQUIRED");
  });

  it("requires owner CSRF and idempotency, confirms balanced owner-entered opening balances once", async () => {
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", ownerCookie);
    const db = app.get<DbPort>("DbPort");
    const status = await request(app.getHttpServer()).get("/api/v1/accounting/activation").set("Cookie", ownerCookie);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe("NOT_STARTED");

    const body = {
      accountingStartAt: "2026-01-01",
      lines: [
        { accountCode: "1000", debitMinor: 25_000, creditMinor: 0 },
        { accountCode: "2000", debitMinor: 0, creditMinor: 5_000 },
      ],
    };
    const preview = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance/preview").set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).send({ accountingStartAt: body.accountingStartAt, lines: [{ accountCode: "1000", debitMinor: 25_000, creditMinor: 0 }] });
    expect(preview.status).toBe(200);
    expect(preview.body.totals).toEqual({ debitMinor: 25_000, creditMinor: 25_000 });
    expect(preview.body.draft.lines.at(-1)).toMatchObject({ accountCode: "3000", creditMinor: 25_000 });
    const noCsrf = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance").set("Cookie", ownerCookie).set("Idempotency-Key", "opening-key-001").send(body);
    expect(noCsrf.status).toBe(403);
    const noKey = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance").set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).send(body);
    expect(noKey.status).toBe(400);

    const confirmed = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "opening-key-001").send(body);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.activation).toMatchObject({ status: "REVIEW", accountingStartAt: "2026-01-01T00:00:00.000Z" });
    expect(confirmed.body.entry.sourceType).toBe("AccountingOpening");
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/activation").set("Cookie", ownerCookie)).body.openingEntryId).toBe(confirmed.body.entry.id);

    const replay = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "opening-key-001").send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.entry.id).toBe(confirmed.body.entry.id);
    const revisedBody = { accountingStartAt: "2026-02-01", lines: [{ accountCode: "1000", debitMinor: 30_000, creditMinor: 0 }, { accountCode: "2000", debitMinor: 0, creditMinor: 5_000 }] };
    const revised = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "opening-key-002").send(revisedBody);
    expect(revised.status).toBe(201);
    expect(revised.body.activation).toMatchObject({ status: "REVIEW", accountingStartAt: "2026-02-01T00:00:00.000Z", openingEntryId: revised.body.entry.id });
    expect(revised.body.entry.sourceType).toBe("AccountingOpeningRevision");
    expect(revised.body.entry.id).not.toBe(confirmed.body.entry.id);
    expect((await db.findJournalEntryBySource(profile.body.businessId, "JournalReversal", confirmed.body.entry.id, "reversal"))?.entry.reversesEntryId).toBe(confirmed.body.entry.id);
    const revisionReplay = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "opening-key-002").send(revisedBody);
    expect(revisionReplay.status).toBe(201);
    expect(revisionReplay.body.entry.id).toBe(revised.body.entry.id);
    const mismatch = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", ownerCookie).set("X-CSRF-Token", csrf).set("Idempotency-Key", "opening-key-002").send(body);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.code).toBe("IDEMPOTENCY_MISMATCH");
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss").set("Cookie", ownerCookie)).body.code).toBe("ACCOUNTING_ACTIVATION_REQUIRED");
  });

  it("aggregates journal-backed P&L with inclusive end-date handling after activation", async () => {
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", ownerCookie);
    const db = app.get<DbPort>("DbPort");
    const businessId = profile.body.businessId as string;
    const ownerId = profile.body.userId as string;
    const business = await db.findBusinessById(businessId);
    if (!business) throw new Error("test business missing");
    await db.saveAccountingActivation({ businessId, status: "ACTIVE", accountingStartAt: new Date("2026-01-01T00:00:00Z"), openingEntryId: null, csvCutoverAt: null });
    const journal = new JournalPostingService(db);
    await journal.postSourceEvent({ businessId, branchId: null, sourceType: "Test", sourceId: "income", sourceEvent: "posted", actorId: ownerId, requestId: "pnl-income-001", draft: buildBalancedDraft({ currency: business.currency, effectiveAt: new Date("2026-10-10T12:00:00Z"), lines: [{ accountCode: "1000", debitMinor: 10_000, creditMinor: 0 }, { accountCode: "4000", debitMinor: 0, creditMinor: 10_000 }] }) });
    await journal.postSourceEvent({ businessId, branchId: null, sourceType: "Test", sourceId: "expense", sourceEvent: "posted", actorId: ownerId, requestId: "pnl-expense-001", draft: buildBalancedDraft({ currency: business.currency, effectiveAt: new Date("2026-10-10T13:00:00Z"), lines: [{ accountCode: "6000", debitMinor: 3_000, creditMinor: 0 }, { accountCode: "1000", debitMinor: 0, creditMinor: 3_000 }] }) });
    const cashAccount = await db.findAccountingAccountByCode(businessId, "1000");
    expect(cashAccount).not.toBeNull();
    const cashActivity = await request(app.getHttpServer()).get(`/api/v1/accounting/journal?limit=20&dateFrom=2026-10-10&accountId=${cashAccount!.id}`).set("Cookie", ownerCookie);
    expect(cashActivity.status).toBe(200);
    expect(cashActivity.body.items).toHaveLength(3); // Includes the auditable reversal from the opening balance revision above.
    expect(cashActivity.body.items.every((item: { lines: Array<{ accountId: string }> }) => item.lines.some((line) => line.accountId === cashAccount!.id))).toBe(true);
    const unknownAccount = await request(app.getHttpServer()).get("/api/v1/accounting/journal?accountId=foreign-account").set("Cookie", ownerCookie);
    expect(unknownAccount.status).toBe(404);
    expect(unknownAccount.body.code).toBe("NOT_FOUND");
    const response = await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss?dateFrom=2026-10-10&dateTo=2026-10-10").set("Cookie", ownerCookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ revenueMinor: 10_000, expensesMinor: 3_000, netIncomeMinor: 7_000, currency: business.currency, historicalActivationRequired: false });
    expect(response.body.latestEntryAt).toMatch(/^2026-10-10T/); // The opening revision reversal is also posted on this date.
    const beforeStart = await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss?dateFrom=2025-12-31").set("Cookie", ownerCookie);
    expect(beforeStart.status).toBe(400);
    expect(beforeStart.body.code).toBe("ACCOUNTING_RANGE_BEFORE_START");
  });

  it("resumes bounded backfill by expected cursor and pauses before unsupported source families", async () => {
    const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Backfill Owner", email: `backfill-owner-${Date.now()}@example.com`, password: "correct-horse-12", businessName: "Backfill API Test" });
    const cookieHeader = cookie(registration.headers["set-cookie"]);
    const csrfToken = registration.body.csrfToken as string;
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookieHeader);
    const db = app.get<DbPort>("DbPort");
    const businessId = profile.body.businessId as string;
    const ownerId = profile.body.userId as string;
    const createdAt = new Date("2026-10-09T12:00:00.000Z");
    const giftCard = await db.createGiftCard({ businessId, codeHash: "backfill-adjustment-hash", codePrefix: "QA", codeLast4: "0001", status: "ACTIVE", createdBy: ownerId, activatedAt: createdAt, suspendedAt: null, version: 1 });
    await db.createGiftCardTransaction({ businessId, giftCardId: giftCard.id, type: "ADJUST_CREDIT", amountDeltaMinor: 500, saleId: null, refundId: null, actorId: ownerId, requestId: "backfill-gift-adjust", idempotencyKey: "backfill-gift-adjust", reason: "Manual value adjustment", branchId: null });
    const sale = await db.createSale({ businessId, receiptNo: "BF-1", status: "COMPLETED", subtotalMinor: 10_000, discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 10_000, paidMinor: 10_000, changeMinor: 0, currency: "PHP", customerId: null, customerName: null, notes: null, actorId: ownerId, requestId: "backfill-sale", idempotencyKey: "backfill-sale", registerId: null, branchId: null, createdAt, completedAt: createdAt, voidedAt: null, voidReason: null });
    await db.createSaleItem({ businessId, saleId: sale.id, position: 0, productId: "historical-product", name: "Historical item", unit: "unit", qty: 1, priceMinor: 10_000, costMinor: 4_000, taxRateBps: null, lineDiscountMinor: 0, lineTotalMinor: 10_000 });
    await db.createPayment({ businessId, saleId: sale.id, method: "cash", amountMinor: 10_000, status: "CAPTURED", providerRef: null, internalInstrumentType: null, internalInstrumentId: null, idempotencyKey: "backfill-payment" });
    const loyaltyAccount = await db.createLoyaltyAccount({ businessId, customerId: "backfill-customer" });
    await db.createSaleLoyalty({ businessId, saleId: sale.id, customerId: "backfill-customer", loyaltyAccountId: loyaltyAccount.id, programVersion: 1, eligibleSpendMinor: 10_000, earnedPoints: 100, redeemedPoints: 0, redeemedValueMinor: 0, earnAmountMinorSnapshot: 100, earnPointsSnapshot: 1, redeemPointsSnapshot: 100, redeemValueMinorSnapshot: 500 });
    const refund = await db.createRefund({ businessId, saleId: sale.id, status: "APPROVED", totalMinor: 2_000, reason: "Return", requestedBy: ownerId, approvedBy: ownerId, requestId: "backfill-refund", approvedRequestId: "backfill-refund", singleStep: true });
    await db.createLoyaltyTransaction({ businessId, accountId: loyaltyAccount.id, customerId: "backfill-customer", type: "REFUND_EARN_REVERSAL", pointsDelta: -40, valueMinorSnapshot: 2_000, saleId: sale.id, refundId: refund.id, actorId: ownerId, requestId: "backfill-refund", idempotencyKey: "backfill-refund-loyalty", reason: "Return" });
    await db.createRefundItem({ businessId, refundId: refund.id, saleItemId: (await db.listSaleItems(sale.id, businessId))[0]!.id, productId: "historical-product", qty: 1, amountMinor: 2_000, restocked: true });
    await db.createPayment({ businessId, saleId: sale.id, method: "cash", amountMinor: 2_000, status: "REFUNDED", providerRef: null, internalInstrumentType: null, internalInstrumentId: null, idempotencyKey: "backfill-refund:refund:cash:0" });
    await db.createExpense({ businessId, category: "Rent", amountMinor: 2_000, description: "Historical rent", method: "cash", shiftId: null, branchId: null, expenseDate: createdAt, actorId: ownerId, requestId: "backfill-expense", attachmentUrl: null, voidedAt: null, voidReason: null, cashAdjusted: true });
    const supplier = await db.createSupplier({ businessId, name: "Backfill supplier", code: "BACKFILL", contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true });
    const order = await db.createPurchaseOrder({ businessId, supplierId: supplier.id, branchId: null, poNumber: "BF-PO-1", status: "RECEIVED", expectedDate: null, notes: null, subtotalMinor: 500, taxMinor: 0, totalMinor: 500, createdBy: ownerId, orderedBy: ownerId, orderedAt: createdAt, cancelledBy: null, cancelledAt: null, cancelReason: null });
    const orderLine = await db.createPurchaseOrderLine({ businessId, purchaseOrderId: order.id, productId: "legacy-stock", position: 0, supplierSkuSnapshot: null, productNameSnapshot: "Legacy stock", quantity: 2, unitCostMinor: 250, lineTotalMinor: 500, notes: null });
    const receipt = await db.createPurchaseReceipt({ businessId, purchaseOrderId: order.id, branchId: null, receiptNumber: "BF-GRN-1", status: "POSTED", receivedBy: ownerId, receivedAt: createdAt, notes: null });
    const receiptLine = await db.createPurchaseReceiptLine({ businessId, purchaseReceiptId: receipt.id, purchaseOrderLineId: orderLine.id, productId: "legacy-stock", quantityReceived: 2, unitCostMinorSnapshot: 250, productNameSnapshot: "Legacy stock", supplierSkuSnapshot: null });
    const accounts = await new JournalPostingService(db).seedChart(businessId);
    const cashAccount = accounts.find((account) => account.code === "1000")!;
    const bill = await db.createSupplierBill({ businessId, supplierId: supplier.id, branchId: null, invoiceNumber: "BF-INV-1", invoiceDate: createdAt, dueDate: null, currency: "PHP", status: "PARTIALLY_PAID", invoiceAmountMinor: 500, nonStockChargeMinor: 0, paidMinor: 200, version: 1, notes: null, createdBy: ownerId, postedBy: ownerId, postedAt: createdAt, voidedBy: null, voidedAt: null, requestId: "backfill-bill" });
    await db.createSupplierBillAllocation({ businessId, billId: bill.id, receiptLineId: receiptLine.id, quantity: 2, unitInvoiceCostMinor: 250, invoiceAmountMinor: 500, receiptCostMinorSnapshot: 500 });
    const supplierPayment = await db.createSupplierPayment({ businessId, supplierId: supplier.id, billId: bill.id, branchId: null, amountMinor: 200, method: "cash", paidFromAccountId: cashAccount.id, reference: null, paidAt: createdAt, shiftId: null, cashMovementId: null, idempotencyKey: "backfill-payment", createdBy: ownerId, requestId: "backfill-payment" });
    const supplierReturn = await db.createSupplierReturn({ businessId, supplierId: supplier.id, purchaseOrderId: order.id, branchId: null, returnNumber: "BF-RET-1", status: "POSTED", reason: "Damaged", createdBy: ownerId, postedBy: ownerId, postedAt: createdAt, cancelledBy: null, cancelledAt: null, version: 1 });
    const returnLine = await db.createSupplierReturnLine({ businessId, supplierReturnId: supplierReturn.id, purchaseOrderLineId: orderLine.id, productId: "legacy-stock", quantity: 1, unitCostMinorSnapshot: 250, productNameSnapshot: "Legacy stock", supplierSkuSnapshot: null });
    await db.createSupplierReturnReceiptAllocation({ businessId, supplierReturnLineId: returnLine.id, receiptLineId: receiptLine.id, quantity: 1, unitCostMinorSnapshot: 250, billedQuantity: 1, billedInvoiceCostMinorSnapshot: 300 });
    await db.createInventoryCount({ businessId, branchId: null, countNumber: "BF-CNT-1", status: "POSTED", scopeType: "FULL", name: "Legacy stock count", notes: null, createdBy: ownerId, startedAt: createdAt, submittedBy: ownerId, submittedAt: createdAt, approvedBy: ownerId, approvedAt: createdAt, approvalFingerprint: "legacy-count", postedBy: ownerId, postedAt: createdAt, cancelledBy: null, cancelledAt: null, version: 1 });
    await db.createMovement({ businessId, productId: "legacy-stock", type: "opening_stock", qtyDelta: 5, reason: "Legacy opening quantity", referenceType: null, referenceId: null, actorId: ownerId, requestId: "backfill-opening-stock", branchId: null, createdAt });
    const opening = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "backfill-opening-key")
      .send({ accountingStartAt: "2026-10-01", lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }] });
    expect(opening.status).toBe(201);
    const start = await request(app.getHttpServer()).post("/api/v1/accounting/activation/backfill").set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "backfill-key-001");
    expect(start.status).toBe(202);
    expect(start.body.status).toBe("RUNNING");
    const openingWhileRunning = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "opening-during-backfill")
      .send({ accountingStartAt: "2026-10-01", lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }] });
    expect(openingWhileRunning.status).toBe(409);
    expect(openingWhileRunning.body.code).toBe("ACCOUNTING_ACTIVATION_IN_PROGRESS");
    const replay = await request(app.getHttpServer()).post("/api/v1/accounting/activation/backfill").set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "backfill-key-001");
    expect(replay.body.id).toBe(start.body.id);

    const firstBatch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "sales", afterId: null } });
    expect(firstBatch.status).toBe(200);
    expect(firstBatch.body.cursor).toEqual({ family: "expenses", afterId: null });
    expect(firstBatch.body.processedCount).toBe(1);
    const oldCursorReplay = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "sales", afterId: null } });
    expect(oldCursorReplay.body.cursor).toEqual(firstBatch.body.cursor);
    const secondBatch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "expenses", afterId: null } });
    expect(secondBatch.body.cursor).toEqual({ family: "refunds", afterId: null });
    expect(secondBatch.body.status).toBe("RUNNING");
    const thirdBatch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "refunds", afterId: null } });
    expect(thirdBatch.body.status).toBe("RUNNING");
    let batch = thirdBatch;
    for (const family of ["purchase-receipts", "supplier-returns", "supplier-bills", "inventory-counts"] as const) {
      expect(batch.body.cursor).toEqual({ family, afterId: null });
      batch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family, afterId: null } });
    }
    expect(batch.body.cursor).toEqual({ family: "inventory-movements", afterId: null });
    const movementBatch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "inventory-movements", afterId: null } });
    expect(movementBatch.body.status).toBe("RUNNING");
    expect(movementBatch.body.cursor.family).toBe("remaining");
    const finalBatch = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: { family: "remaining", afterId: null } });
    expect(finalBatch.body.status).toBe("PAUSED");
    expect(finalBatch.body.cursor.family).toBe("remaining");
    expect(finalBatch.body.processedCount).toBe(7);
    expect(finalBatch.body.debitMinor).toBe(24_200);
    expect(finalBatch.body.creditMinor).toBe(24_200);
    expect(await db.findJournalEntryBySource(businessId, "Sale", sale.id, "completed")).not.toBeNull();
    expect(await db.findJournalEntryBySource(businessId, "Refund", refund.id, "approved")).not.toBeNull();
    expect(await db.findJournalEntryBySource(businessId, "PurchaseReceipt", receipt.id, "posted")).not.toBeNull();
    expect(await db.findJournalEntryBySource(businessId, "SupplierReturn", supplierReturn.id, "posted")).not.toBeNull();
    expect(await db.findJournalEntryBySource(businessId, "SupplierBill", bill.id, "posted")).not.toBeNull();
    expect(await db.findJournalEntryBySource(businessId, "SupplierPayment", supplierPayment.id, "paid")).not.toBeNull();
    expect((await db.listSupplierCredits(businessId, supplier.id)).find((credit) => credit.supplierReturnId === supplierReturn.id)?.amountMinor).toBe(300);
    expect((await request(app.getHttpServer()).get(`/api/v1/accounting/activation/backfill/${start.body.id}`).set("Cookie", cookieHeader)).body.issues).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: "InventoryCount", sourceId: expect.any(String), reason: "historical_count_cost_unavailable" }), expect.objectContaining({ sourceId: expect.any(String), reason: "historical_movement_cost_unavailable" }), expect.objectContaining({ reason: "standalone_value_adjustment_counter_account_missing" })]));
    const changedCutover = await request(app.getHttpServer()).post("/api/v1/accounting/activation/opening-balance")
      .set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "backfill-cutover-change")
      .send({ accountingStartAt: "2026-10-02", lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }] });
    expect(changedCutover.status).toBe(409);
    expect(changedCutover.body.code).toBe("ACCOUNTING_ACTIVATION_IN_PROGRESS");
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/activation").set("Cookie", cookieHeader)).body.status).toBe("BACKFILLING");
  });

  it("activates only after a confirmed opening entry and an issue-free source backfill", async () => {
    const registration = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "Clean Backfill Owner", email: `clean-backfill-${Date.now()}@example.com`, password: "correct-horse-12", businessName: "Clean Backfill Test" });
    const cookieHeader = cookie(registration.headers["set-cookie"]);
    const csrfToken = registration.body.csrfToken as string;
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookieHeader);
    const db = app.get<DbPort>("DbPort");
    const businessId = profile.body.businessId as string;
    const actorId = profile.body.userId as string;
    const openingDate = new Date("2026-10-01T00:00:00.000Z");
    const journals = new JournalPostingService(db);
    await journals.seedChart(businessId);
    const opening = await journals.postSourceEvent({
      businessId, branchId: null, sourceType: "AccountingOpening", sourceId: businessId, sourceEvent: "opening-balance", actorId, requestId: "clean-opening",
      draft: buildBalancedDraft({ currency: "PHP", effectiveAt: openingDate, description: "Owner-confirmed opening", lines: [{ accountCode: "1000", debitMinor: 100, creditMinor: 0 }, { accountCode: "3000", debitMinor: 0, creditMinor: 100 }] }),
    });
    await db.saveAccountingActivation({ businessId, status: "REVIEW", accountingStartAt: openingDate, openingEntryId: opening.entry.id, csvCutoverAt: null });
    const start = await request(app.getHttpServer()).post("/api/v1/accounting/activation/backfill").set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).set("Idempotency-Key", "clean-backfill-key");
    let cursor = start.body.cursor as { family: string; afterId: string | null };
    while (cursor.family !== "remaining") {
      const next = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: cursor });
      cursor = next.body.cursor as { family: string; afterId: string | null };
    }
    const completed = await request(app.getHttpServer()).post(`/api/v1/accounting/activation/backfill/${start.body.id}/run`).set("Cookie", cookieHeader).set("X-CSRF-Token", csrfToken).send({ expectedCursor: cursor });
    expect(completed.body.status).toBe("COMPLETE");
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/activation").set("Cookie", cookieHeader)).body.status).toBe("ACTIVE");
    const reportRange = "?dateFrom=2026-10-01&dateTo=2026-10-01";
    const trialBalance = await request(app.getHttpServer()).get(`/api/v1/accounting/trial-balance${reportRange}`).set("Cookie", cookieHeader);
    const pnl = await request(app.getHttpServer()).get(`/api/v1/accounting/profit-and-loss${reportRange}`).set("Cookie", cookieHeader);
    const csv = await request(app.getHttpServer()).get(`/api/v1/accounting/journal.csv?dateFrom=2026-10-01&dateTo=2026-10-01`).set("Cookie", cookieHeader);
    expect(pnl.body).toMatchObject({ revenueMinor: 0, expensesMinor: 0, netIncomeMinor: 0 });
    expect(csv.status).toBe(200);
    const csvRows = String(csv.text).replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map((row) => row.split(","));
    expect(csvRows.reduce((sum, row) => sum + Number(row[5]), 0)).toBe(trialBalance.body.debitMinor);
    expect(csvRows.reduce((sum, row) => sum + Number(row[6]), 0)).toBe(trialBalance.body.creditMinor);
  });
});
