import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "../src/app.module";
import type { DbPort } from "../src/common/db.port";

let app: INestApplication;
let ownerCookie = "";
let ownerCsrf = "";
let cashierCookie = "";

function cookie(headers: unknown): string {
  const values = Array.isArray(headers) ? headers : [String(headers ?? "")];
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

beforeAll(async () => {
  app = await createTestApp({ completedOnboardingFixture: true });
  const suffix = Date.now();
  const owner = await request(app.getHttpServer()).post("/api/v1/auth/register").send({ ownerName: "AP Owner", email: `ap-owner-${suffix}@example.com`, password: "correct-horse-12", businessName: "AP API Test" });
  ownerCookie = cookie(owner.headers["set-cookie"]);
  ownerCsrf = owner.body.csrfToken as string;
  const invite = await request(app.getHttpServer()).post("/api/v1/memberships").set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({ name: "Cashier", email: `ap-cashier-${suffix}@example.com`, role: "cashier" });
  const cashier = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ email: `ap-cashier-${suffix}@example.com`, password: invite.body.tempPassword });
  cashierCookie = cookie(cashier.headers["set-cookie"]);
});

afterAll(async () => { await app.close(); });

describe("Phase 23 supplier bill API", () => {
  it("bounds management report dates and enforces accounting read permission", async () => {
    const ownerReport = await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss?dateFrom=2026-10-01&dateTo=2026-10-10").set("Cookie", ownerCookie);
    expect(ownerReport.status).toBe(409);
    expect(ownerReport.body.code).toBe("ACCOUNTING_ACTIVATION_REQUIRED");
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss?dateFrom=not-a-date").set("Cookie", ownerCookie)).status).toBe(400);
    expect((await request(app.getHttpServer()).get("/api/v1/accounting/profit-and-loss").set("Cookie", cashierCookie)).status).toBe(403);
  });

  it("requires payables permissions and CSRF for writes", async () => {
    expect((await request(app.getHttpServer()).get("/api/v1/payables/bills").set("Cookie", ownerCookie)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/v1/payables/bills").set("Cookie", cashierCookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get("/api/v1/payables/bills/missing").set("Cookie", cashierCookie)).status).toBe(403);
    const missingBill = await request(app.getHttpServer()).get("/api/v1/payables/bills/missing").set("Cookie", ownerCookie);
    expect(missingBill.status).toBe(404);
    expect(missingBill.body.code).toBe("NOT_FOUND");
    expect((await request(app.getHttpServer()).post("/api/v1/payables/bills").set("Cookie", ownerCookie).send({})).status).toBe(403);
    const invalid = await request(app.getHttpServer()).post("/api/v1/payables/bills").set("Cookie", ownerCookie).set("X-CSRF-Token", ownerCsrf).send({});
    expect(invalid.status).toBe(400);
  });

  it("returns tenant-scoped bill reconciliation details", async () => {
    const profile = await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", ownerCookie);
    const db = app.get<DbPort>("DbPort");
    const businessId = profile.body.businessId as string;
    const supplier = await db.createSupplier({ businessId, name: "Detail supplier", code: `DETAIL-${Date.now()}`, contactName: null, email: null, phone: null, addressLine1: null, addressLine2: null, city: null, province: null, postalCode: null, country: "PH", paymentTerms: null, notes: null, isActive: true });
    const bill = await db.createSupplierBill({ businessId, supplierId: supplier.id, branchId: null, invoiceNumber: "DETAIL-INV", invoiceDate: new Date("2026-10-10T00:00:00Z"), dueDate: null, currency: "PHP", status: "POSTED", invoiceAmountMinor: 12_000, nonStockChargeMinor: 0, paidMinor: 2_000, version: 1, notes: null, createdBy: profile.body.userId as string, postedBy: profile.body.userId as string, postedAt: new Date("2026-10-10T00:00:00Z"), voidedBy: null, voidedAt: null, requestId: "detail-bill" });
    await db.createSupplierBillAllocation({ businessId, billId: bill.id, receiptLineId: "detail-receipt-line", quantity: 2, unitInvoiceCostMinor: 6_000, invoiceAmountMinor: 12_000, receiptCostMinorSnapshot: 10_000 });
    const detail = await request(app.getHttpServer()).get(`/api/v1/payables/bills/${bill.id}`).set("Cookie", ownerCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.bill).toMatchObject({ invoiceNumber: "DETAIL-INV", supplierName: "Detail supplier", paidMinor: 2_000, openBalanceMinor: 10_000 });
    expect(detail.body.allocations).toMatchObject([{ quantity: 2, invoiceAmountMinor: 12_000, receiptCostMinorSnapshot: 10_000 }]);
    expect(detail.body.payments).toEqual([]);
    expect(detail.body.credits).toEqual([]);
  });
});
