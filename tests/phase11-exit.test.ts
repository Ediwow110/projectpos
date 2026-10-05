import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { resolvePaymentMethods, DEFAULT_PAYMENT_METHODS } from "../apps/api/src/sales/payment-methods";
import { renderReceiptText } from "../apps/api/src/sales/receipt-text";
import { renderMetrics, incrementMetric, resetMetricsForTests } from "../apps/api/src/common/metrics";
import { SupportGrantService } from "../apps/api/src/billing/nest/support-grant.service";
import { MembershipService } from "../apps/api/src/memberships/nest/membership.service";

const OWNER = ["user.manage", "settings.write", "sale.refund"];

describe("phase11 exit", () => {
  it("resolves configured payment methods with a defaults fallback (FR-PAY-01)", async () => {
    const db = createMemoryDb();
    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    expect(await resolvePaymentMethods(db, biz.id)).toEqual(DEFAULT_PAYMENT_METHODS);
    await db.saveSettings(biz.id, {
      ...(await db.getSettings(biz.id)),
      paymentMethods: [{ key: "cash", label: "Cash" }],
    });
    expect((await resolvePaymentMethods(db, biz.id)).map((m) => m.key)).toEqual(["cash"]);
  });

  it("renders receipt text with change (FR-RECEIPT-01)", () => {
    expect(renderReceiptText({
      receiptNo: "2026-000002", status: "COMPLETED",
      items: [{ name: "X", qty: 2, lineTotalMinor: 5000 }],
      giftCardLoads: [],
      subtotalMinor: 5000, discountMinor: 0, taxMinor: 0, totalMinor: 5000,
      paidMinor: 10000, changeMinor: 5000, tenders: [{ method: "cash", amountMinor: 10000 }],
    })).toContain("CHANGE 50.00");
  });

  it("emits the runbook metric names (§14.2)", () => {
    resetMetricsForTests();
    incrementMetric("pos_payment_unknown_total");
    incrementMetric("pos_auth_failures_total", { method: "password" });
    const text = renderMetrics();
    expect(text).toContain("pos_payment_unknown_total 1");
    expect(text).toContain('pos_auth_failures_total{method="password"} 1');
  });

  it("audits carry timestamps and snapshots (§6.7)", async () => {
    const db = createMemoryDb();
    await db.appendAudit({
      businessId: "b", actorId: "u", action: "settings.write",
      entityType: "Business", entityId: "b", requestId: "r",
      before: { a: 1 }, after: { a: 2 },
    });
    const row = (await db.listAudit()).at(-1)!;
    expect(row.at).toBeInstanceOf(Date);
    expect(row.before).toEqual({ a: 1 });
    expect(row.after).toEqual({ a: 2 });
  });

  it("mints single-use support grants and enforces the users cap (FR-PLATFORM-01, §16.2)", async () => {
    const db = createMemoryDb();
    const grants = new SupportGrantService(db);
    const grant = await grants.mint({ purpose: "audit support", ttlMinutes: 15, actorId: "ops" }, "r1");
    expect(grant.token).toMatch(/^sup_[0-9a-f]{16}_[0-9a-f]{32}$/);
    await grants.consume((await grants.resolve(grant.token))!.id);
    expect(await grants.resolve(grant.token)).toBeNull();

    const biz = await db.createBusiness({ name: "B", currency: "PHP" });
    const members = new MembershipService(db);
    const free = (await db.findPlanByKey("free"))!;
    await db.upsertSubscription({
      businessId: biz.id, planId: free.id, status: "active", trialEndsAt: null,
      currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
    });
    await db.createMembership({ businessId: biz.id, userId: "u1", role: "owner" });
    await members.create(biz.id, "u1", "r2", OWNER, { email: `a${Date.now()}@x.test`, name: "A", role: "cashier" });
    await members.create(biz.id, "u1", "r3", OWNER, { email: `b${Date.now()}@x.test`, name: "B", role: "cashier" });
    await expect(
      members.create(biz.id, "u1", "r4", OWNER, { email: `c${Date.now()}@x.test`, name: "C", role: "cashier" }),
    ).rejects.toThrow("PLAN_LIMIT");
  });
});
