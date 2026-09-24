// Phase 10 exit gate: SaaS commercial model end to end at the service/lib
// boundary (HTTP surface lives in apps/api/test/*.contract.test.ts and the
// pages in e2e/billing.spec.ts): grandfathering, server-side caps with the
// PLAN_LIMIT code, trial expiry plus web helpers, and exactly-once webhook
// application under a real HMAC signature.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { BillingService, canonicalWebhookBody } from "../apps/api/src/billing/nest/billing.service";
import { trialDaysLeft, usagePct } from "../apps/web/src/lib/billing";

async function setup() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Exit Books", currency: "PHP" });
  const free = (await db.findPlanByKey("free"))!;
  const pro = (await db.findPlanByKey("pro"))!;
  return { db, billing: new BillingService(db), business, free, pro };
}

function sign(secret: string, body: unknown): string {
  return createHmac("sha256", secret).update(canonicalWebhookBody(body)).digest("hex");
}

describe("phase10 exit", () => {
  it("grandfathers businesses without subscriptions", async () => {
    const { billing, business } = await setup();
    expect((await billing.resolvePlan(business.id)).key).toBe("enterprise");
    expect((await billing.resolvePlan(business.id)).allowances.users).toBeNull();
  });

  it("caps a free business server-side with fields", async () => {
    const { db, billing, business, free } = await setup();
    await db.upsertSubscription({
      businessId: business.id, planId: free.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    for (let i = 0; i < 100; i++) {
      await db.createProduct({
        businessId: business.id, categoryId: null, name: `P${i}`, sku: null, barcode: null,
        brand: null, unit: "pc", costMinor: 0, priceMinor: 100, taxRateBps: null,
        reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null,
      });
    }
    await expect(
      billing.requireCreate(business.id, "u1", "r1", "products"),
    ).rejects.toThrow("PLAN_LIMIT");
    const audits = await db.listAudit(business.id);
    expect(audits.some((a) => a.action === "plan.limit")).toBe(true);
  });

  it("expires trials and meters web helpers", async () => {
    const { db, billing, business, pro } = await setup();
    await db.upsertSubscription({
      businessId: business.id, planId: pro.id, status: "trialing",
      trialEndsAt: new Date("2020-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2020-01-15T00:00:00.000Z"),
    });
    expect((await billing.resolvePlan(business.id)).key).toBe("free");
    expect(trialDaysLeft(new Date(Date.now() + 86400000).toISOString())).toBe(1);
    expect(trialDaysLeft(new Date(Date.now() - 86400000).toISOString())).toBe(0);
    expect(trialDaysLeft(null)).toBeNull();
    expect(usagePct(150, 100)).toBe(100);
    expect(usagePct(5, null)).toBeNull();
  });

  it("applies each webhook eventId once", async () => {
    const { db, billing, business, pro } = await setup();
    await db.upsertSubscription({
      businessId: business.id, planId: pro.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    const invoice = await billing.issueInvoice(business.id, "platform", "r-issue", {
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    });
    expect(invoice.status).toBe("open");

    const secret = "exit-webhook-secret";
    process.env["BILLING_TEST_DOUBLE_SECRET"] = secret;
    try {
      const payload = { businessId: business.id, amountMinor: invoice.amountMinor };
      const signature = sign(secret, { eventId: "evt-exit-1", type: "invoice.paid", ...payload });

      const first = await billing.ingestWebhook(
        "test-double", "evt-exit-1", "invoice.paid", payload, signature, "r-wh-1",
      );
      const second = await billing.ingestWebhook(
        "test-double", "evt-exit-1", "invoice.paid", payload, signature, "r-wh-2",
      );

      expect(first).toEqual({ ok: true, handled: true, deduplicated: false });
      expect(second).toEqual({ ok: true, handled: true, deduplicated: true });
      const invoices = await db.listInvoices(business.id);
      expect(invoices.filter((i) => i.status === "paid")).toHaveLength(1);
      const audits = await db.listAudit(business.id);
      expect(audits.filter((a) => a.action === "webhook.invoice")).toHaveLength(1);

      await expect(
        billing.ingestWebhook("test-double", "evt-exit-1", "invoice.paid", payload, "bad-sig", "r-wh-3"),
      ).rejects.toThrow("FORBIDDEN");
    } finally {
      delete process.env["BILLING_TEST_DOUBLE_SECRET"];
    }
  });

  it("gates features by plan and honors flag overrides", async () => {
    const { db, billing, business, free, pro } = await setup();
    await db.upsertSubscription({
      businessId: business.id, planId: free.id, status: "active",
      trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    await expect(billing.requireFeature(business.id, "reports")).rejects.toThrow("PLAN_LIMIT");
    await billing.setFlag(business.id, "platform", "r-flag", "reports", true);
    await expect(billing.requireFeature(business.id, "reports")).resolves.toBeUndefined();

    await billing.changePlan(business.id, "platform", "r-plan", "pro");
    expect((await billing.getSubscription(business.id)).status).toBe("active");
    expect((await billing.resolvePlan(business.id)).allowances.products).toBe(20000);
    const summary = await billing.usageSummary(business.id);
    expect(summary.products.limit).toBe(20000);
    expect(summary.salesMonthly).toBe(0);
  });
});
