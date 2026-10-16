import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import { GuestSupportService, PlatformConsentService } from "../../src/orders/guest-support.service";
import { OrderAccessService } from "../../src/orders/order-access-service";

describe("Phase D guest support and owner consent PostgreSQL persistence", () => {
  it("persists tenant-scoped case, one-use report key, read-only consent and audited revocation", async () => {
    await withPg(async (db, ctx) => {
      const business = await db.createBusiness({ name: "Phase D PG", currency: "PHP" });
      const other = await db.createBusiness({ name: "Other Phase D PG", currency: "PHP" });
      const now = new Date();
      const order = await db.createOrder({
        businessId: business.id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
        branchId: null, customerId: null, contactName: "Guest", email: "guest@example.com", phone: "+639171234567",
        deliveryAddress: null, fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 0,
        discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0, totalMinor: 0, saleId: null,
        status: "SUBMITTED", version: 1, checkoutAt: now, submittedAt: now, confirmedAt: null,
        completedAt: null, cancelledAt: null, actorId: "public", requestId: "pg-d", createdAt: now, updatedAt: now,
      });
      const token = (await new OrderAccessService(db).mintStatusToken(business.id, order.id)).token;
      const svc = new GuestSupportService(db);
      const input = { statusToken: token, category: "ORDER" as const, description: "Please check pickup availability" };
      const first = await svc.submit(input, "pg-d-case", "r1");
      expect(first.replayed).toBe(false);
      expect((await svc.submit(input, "pg-d-case", "r2")).replayed).toBe(true);
      expect(await svc.listForBusiness(other.id)).toEqual([]);
      expect((await svc.guestHistory(token)).map((row) => row.caseId)).toEqual([first.caseId]);
      expect((await db.listGuestSupportCasesForOrder(business.id, order.id)).map((row) => row.id)).toEqual([first.caseId]);
      expect(await db.listGuestSupportCasesForOrder(other.id, order.id)).toEqual([]);
      await svc.close(business.id, "owner", first.caseId, "r3");
      expect((await svc.listForBusiness(business.id))[0]?.status).toBe("CLOSED");

      const consents = new PlatformConsentService(db);
      const issued = await consents.issue(business.id, "owner", "Investigate support incident", 15, "r4");
      expect((await consents.list(business.id)).map((row) => row.id)).toContain(issued.id);
      expect(await consents.diagnostics(business.id, issued.token, "r5")).toMatchObject({
        businessId: business.id, openSupportCases: 0,
      });
      await expect(consents.diagnostics(other.id, issued.token, "cross")).rejects.toThrow("FORBIDDEN");
      await consents.revoke(business.id, "owner", issued.id, "r6");
      await expect(consents.diagnostics(business.id, issued.token, "revoked")).rejects.toThrow("FORBIDDEN");
      const c = await ctx.client();
      try {
        for (const table of ["GuestSupportCase", "PlatformOwnerConsent"]) {
          const r = await c.query('SELECT "relrowsecurity" FROM pg_class WHERE "relname"=$1', [table]);
          expect(r.rows[0]?.relrowsecurity).toBe(true);
        }
      } finally { if (ctx.owns()) c.release(); }
    });
  });
});
