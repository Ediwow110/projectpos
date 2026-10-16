import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../common/memory.db";
import { OrderAccessService } from "./order-access-service";
import { GuestSupportService, PlatformConsentService } from "./guest-support.service";

async function fixture() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Guest support store", currency: "PHP" });
  const otherBusiness = await db.createBusiness({ name: "Other tenant", currency: "PHP" });
  const now = new Date();
  const makeOrder = (id: string) => db.createOrder({
    businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
    branchId: null, customerId: null, contactName: "Guest", email: "guest@example.com", phone: "+639171234567",
    deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 0,
    discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 0, saleId: null,
    status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null,
    completedAt: null, cancelledAt: null, actorId: "public", requestId: id, createdAt: now, updatedAt: now,
  });
  const first = await makeOrder("case-one");
  const second = await makeOrder("case-two");
  const access = new OrderAccessService(db);
  const token1 = (await access.mintStatusToken(business.id, first.id)).token;
  const token2 = (await access.mintStatusToken(business.id, second.id)).token;
  return { db, business, otherBusiness, first, second, token1, token2, access, cases: new GuestSupportService(db), consent: new PlatformConsentService(db) };
}

describe("Phase D guest support and owner-consented diagnostics", () => {
  it("links one case to a verified status token and hides unrelated order history", async () => {
    const f = await fixture();
    const input = { statusToken: f.token1, category: "PAYMENT" as const, description: "Payment was still pending after return" };
    const [created, replay] = await Promise.all([
      f.cases.submit(input, "same-case-key", "case-1"),
      f.cases.submit(input, "same-case-key", "case-2"),
    ]);
    expect(created.caseId).toBe(replay.caseId);
    expect([created.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(await f.cases.guestHistory(f.token2)).toEqual([]);
    expect((await f.cases.guestHistory(f.token1)).map((row) => row.caseId)).toEqual([created.caseId]);
    expect(await f.cases.listForBusiness(f.otherBusiness.id)).toHaveLength(0);
    expect(JSON.stringify(await f.cases.listForBusiness(f.business.id))).not.toContain(f.token1);
    await expect(f.cases.submit({ ...input, description: "Different payload" }, "same-case-key", "case-3"))
      .rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(f.cases.submit({ ...input, statusToken: "wrong" }, "different-key", "case-4"))
      .rejects.toThrow("FORBIDDEN");
    const closed = await f.cases.close(f.business.id, "owner", created.caseId, "close-1");
    expect(closed.status).toBe("CLOSED");
    expect((await f.cases.close(f.business.id, "owner", created.caseId, "close-2")).status).toBe("CLOSED");
    await expect(f.cases.close(f.otherBusiness.id, "owner", created.caseId, "cross")).rejects.toThrow("NOT_FOUND");
    expect((await f.db.listAudit()).filter((entry) => entry.action === "guest_support.closed")).toHaveLength(1);
  });

  it("reads guest history by verified order rather than scanning all tenant cases", async () => {
    const f = await fixture();
    const first = await f.cases.submit({
      statusToken: f.token1, category: "ORDER", description: "Missing product in my pickup order",
    }, "case-for-first-order", "r1");
    await f.cases.submit({
      statusToken: f.token2, category: "OTHER", description: "Questions about my second order",
    }, "case-for-second-order", "r2");
    f.db.listGuestSupportCases = async () => { throw new Error("UNEXPECTED_TENANT_SCAN"); };
    expect((await f.cases.guestHistory(f.token1)).map((row) => row.caseId)).toEqual([first.caseId]);
    expect(await f.db.listGuestSupportCasesForOrder(f.otherBusiness.id, f.first.id)).toEqual([]);
    await expect(f.cases.guestHistory("invalid")).rejects.toThrow("FORBIDDEN");
  });

  it("closes a case by tenant-scoped ID without scanning the entire business history", async () => {
    const f = await fixture();
    const created = await f.cases.submit({
      statusToken: f.token1, category: "ORDER", description: "I need help with this pickup order",
    }, "case-lookup", "open");
    f.db.listGuestSupportCases = async () => { throw new Error("UNEXPECTED_TENANT_SCAN"); };
    await expect(f.cases.close(f.otherBusiness.id, "owner", created.caseId, "cross"))
      .rejects.toThrow("NOT_FOUND");
    expect((await f.cases.close(f.business.id, "owner", created.caseId, "close")).status).toBe("CLOSED");
    expect((await f.cases.close(f.business.id, "owner", created.caseId, "retry")).status).toBe("CLOSED");
    expect((await f.db.listAudit()).filter((row) => row.action === "guest_support.closed")).toHaveLength(1);
  });

  it("counts tenant sales without materializing full sales records for diagnostics", async () => {
    const f = await fixture();
    const issued = await f.consent.issue(f.business.id, "owner", "Investigate sales totals", 10, "issue-count");
    f.db.listSalesByBusiness = async () => { throw new Error("UNEXPECTED_FULL_SALES_SCAN"); };
    f.db.countSalesByBusiness = async (businessId) => {
      expect(businessId).toBe(f.business.id);
      return 17;
    };
    expect(await f.consent.diagnostics(f.business.id, issued.token, "count")).toMatchObject({
      businessId: f.business.id,
      sales: 17,
    });
  });

  it("requires exact tenant consent; expiry and revocation fail closed", async () => {
    const f = await fixture();
    await expect(f.consent.issue(f.business.id, "owner", "too short", 10, "bad")).rejects.toThrow("VALIDATION");
    await expect(f.consent.issue(f.business.id, "owner", "Investigate order delivery", 61, "bad")).rejects.toThrow("VALIDATION");
    const issued = await f.consent.issue(f.business.id, "owner", "Investigate customer support", 15, "issue");
    expect(issued.token).toMatch(/^ownerconsent_[a-f0-9]{64}$/);
    expect(JSON.stringify(await f.consent.list(f.business.id))).not.toContain(issued.token);
    expect(JSON.stringify(await f.consent.list(f.business.id))).not.toContain("tokenHash");
    await expect(f.consent.diagnostics(f.otherBusiness.id, issued.token, "cross")).rejects.toThrow("FORBIDDEN");
    await expect(f.consent.diagnostics(f.business.id, "invalid", "invalid")).rejects.toThrow("FORBIDDEN");
    expect(await f.consent.diagnostics(f.business.id, issued.token, "ok")).toMatchObject({
      businessId: f.business.id, businessName: f.business.name, openSupportCases: 0,
    });
    await f.consent.revoke(f.business.id, "owner", issued.id, "revoke");
    await f.consent.revoke(f.business.id, "owner", issued.id, "retry-revoke");
    await expect(f.consent.diagnostics(f.business.id, issued.token, "revoked")).rejects.toThrow("FORBIDDEN");
    expect((await f.db.listAudit()).filter((entry) => entry.action === "platform_support.consent_revoked")).toHaveLength(1);
    const expired = await f.consent.issue(f.business.id, "owner", "Investigate failed queue", 1, "expires");
    const saved = (await f.db.listPlatformConsents(f.business.id)).find((row) => row.id === expired.id)!;
    saved.expiresAt = new Date(Date.now() - 1);
    await expect(f.consent.diagnostics(f.business.id, expired.token, "expired")).rejects.toThrow("FORBIDDEN");
    expect((await f.db.listAudit()).map((entry) => entry.action)).toContain("platform_support.diagnostics_viewed");
  });
});
