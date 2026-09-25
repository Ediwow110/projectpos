import { describe, expect, it } from "vitest";
import { PgContext } from "../../src/common/pg/context";
import { tenantsFamily } from "../../src/common/pg/pg-tenants";
import { billingFamily } from "../../src/common/pg/pg-billing";
import { devicesFamily } from "../../src/common/pg/pg-devices";
import { PLAN_SEEDS } from "../../src/common/pg/pg-plans-seed";
import type { DbSubscription } from "../../src/common/db.port";
import { withDbill } from "./dbill.helpers";

// Billing-family tests (plans, subscriptions, invoices, usage counters, feature
// flags, billing webhook events) plus the device round-trip the coordinator's
// wiring depends on, mirroring the memory store: tenant scoping with null/[]
// for misses, in-place upserts, and the exactly-once webhook claim. Runs on the
// isolated dbill database (see dbill.helpers.ts).
const uniq = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function seedUser(ctx: PgContext) {
  const tenants = tenantsFamily(ctx);
  return tenants.createUser({ name: "u", email: uniq("u") + "@x.test", passwordHash: "h" });
}

function subInput(businessId: string, planId: string): Omit<DbSubscription, "id" | "providerRef"> & { providerRef?: string | null } {
  return {
    businessId,
    planId,
    status: "trialing",
    trialEndsAt: new Date("2026-10-25T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    providerRef: undefined,
  };
}

function invoiceInput(businessId: string, subscriptionId: string, month: string) {
  const [periodStart, periodEnd] =
    month === "sep"
      ? [new Date("2026-09-01T00:00:00.000Z"), new Date("2026-09-30T00:00:00.000Z")]
      : [new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-31T00:00:00.000Z")];
  return { businessId, subscriptionId, periodStart, periodEnd, amountMinor: 49000, currency: "PHP", status: "open", paidAt: null as Date | null };
}

function webhookInput(eventId: string) {
  return { businessId: null, provider: "xendit", eventId, type: "invoice.paid", payload: { n: 1 } as unknown, status: "applied" };
}

describe("phase12 pg billing: plans", () => {
  it("lists the four seeded plans ordered by key with parsed JSON shapes", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      const plans = await billing.listPlans();
      expect(plans.map((p) => p.key)).toEqual(["basic", "enterprise", "free", "pro"]);
      const seed = PLAN_SEEDS.find((s) => s.key === "pro")!;
      expect(plans.find((p) => p.key === "pro")).toEqual({
        id: seed.id, key: seed.key, name: seed.name,
        allowances: seed.allowances, pricesMinor: seed.pricesMinor, isActive: true,
      });
    });
  });

  it("finds a plan by key; unknown key -> null", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      expect((await billing.findPlanByKey("pro"))?.id).toBe("plan_pro");
      expect(await billing.findPlanByKey("nope")).toBeNull();
    });
  });
});

describe("phase12 pg billing: subscriptions", () => {
  it("upsertSubscription creates, then updates the same row in place (create -> upsert -> get)", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const created = await billing.upsertSubscription(subInput(b.id, "plan_free"));
      expect(created.id).toBeTruthy();
      expect(await billing.getSubscription(b.id)).toEqual(created);
      expect(await billing.getSubscription("biz_none")).toBeNull();

      const second = await billing.upsertSubscription({
        businessId: b.id, planId: "plan_pro", status: "active",
        trialEndsAt: null, currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
        providerRef: "cus_9",
      });
      expect(second.id).toBe(created.id); // unique businessId: same row, not a second one
      expect(second.planId).toBe("plan_pro");
      expect(second.status).toBe("active");
      expect(second.trialEndsAt).toBeNull();
      expect(second.providerRef).toBe("cus_9");

      // Omitted AND explicit-null providerRef keep the stored value (memory's
      // `s.providerRef ?? existing.providerRef`).
      const third = await billing.upsertSubscription({ ...subInput(b.id, "plan_pro"), providerRef: undefined });
      expect(third.providerRef).toBe("cus_9");
      const fourth = await billing.upsertSubscription({ ...subInput(b.id, "plan_pro"), providerRef: null });
      expect(fourth.providerRef).toBe("cus_9");
      expect(await billing.getSubscription(b.id)).toEqual(fourth);
    });
  });

  it("updateSubscription patches provided keys, preserves absent ones; missing/cross-tenant -> null", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const sub = await billing.upsertSubscription(subInput(b1.id, "plan_free"));
      const patched = await billing.updateSubscription(sub.id, b1.id, { status: "active", providerRef: "cus_1" });
      expect(patched).toEqual({ ...sub, status: "active", providerRef: "cus_1" });
      expect(await billing.getSubscription(b1.id)).toEqual(patched);
      const repatched = await billing.updateSubscription(sub.id, b1.id, { planId: "plan_basic" });
      expect(repatched).toEqual({ ...patched, planId: "plan_basic" }); // status/providerRef survive
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      expect(await billing.updateSubscription(sub.id, b2.id, { status: "canceled" })).toBeNull();
      expect(await billing.updateSubscription("sub_none", b1.id, { status: "canceled" })).toBeNull();
    });
  });
});

describe("phase12 pg billing: invoices", () => {
  it("createInvoice stamps issuedAt and lists the business's invoices in issue order; scoped + empty []", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const sub1 = await billing.upsertSubscription(subInput(b1.id, "plan_free"));
      const inv1 = await billing.createInvoice(invoiceInput(b1.id, sub1.id, "sep"));
      expect(inv1.id).toBeTruthy();
      expect(inv1.issuedAt).toBeInstanceOf(Date);
      const inv2 = await billing.createInvoice({ ...invoiceInput(b1.id, sub1.id, "oct"), amountMinor: 0 });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const sub2 = await billing.upsertSubscription(subInput(b2.id, "plan_free"));
      await billing.createInvoice(invoiceInput(b2.id, sub2.id, "sep"));
      expect((await billing.listInvoices(b1.id)).map((i) => i.id)).toEqual([inv1.id, inv2.id]);
      expect(await billing.listInvoices("biz_empty")).toEqual([]);
    });
  });

  it("updateInvoice patches status/paidAt; missing/cross-tenant -> null", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const sub = await billing.upsertSubscription(subInput(b1.id, "plan_free"));
      const inv = await billing.createInvoice(invoiceInput(b1.id, sub.id, "sep"));
      const paidAt = new Date("2026-09-25T12:00:00.000Z");
      const patched = await billing.updateInvoice(inv.id, b1.id, { status: "paid", paidAt });
      expect(patched).toEqual({ ...inv, status: "paid", paidAt });
      expect((await billing.listInvoices(b1.id))[0]).toEqual(patched);
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      expect(await billing.updateInvoice(inv.id, b2.id, { status: "void" })).toBeNull();
      expect(await billing.updateInvoice("inv_none", b1.id, { status: "void" })).toBeNull();
    });
  });
});

describe("phase12 pg billing: counters and flags", () => {
  it("setCounter upserts (second set overwrites count, no duplicate row) and lists are business-scoped", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const c1 = await billing.setCounter(b1.id, "cap.products", "all-time", 100);
      expect(c1).toEqual({
        id: `${b1.id}:cap.products:all-time`, businessId: b1.id,
        key: "cap.products", period: "all-time", count: 100,
      });
      const again = await billing.setCounter(b1.id, "cap.products", "all-time", 120);
      expect(again.id).toBe(c1.id);
      expect(again.count).toBe(120);
      await billing.setCounter(b1.id, "sales.monthly", "2026-09", 7);
      await billing.setCounter(b2.id, "cap.products", "all-time", 1);
      const rows = await billing.listCounters(b1.id);
      expect([...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => r.count)).toEqual([120, 7]);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      expect(byKey.get("cap.products")).toMatchObject({ period: "all-time", count: 120 });
      expect(byKey.get("sales.monthly")).toMatchObject({ period: "2026-09", count: 7 });
      expect((await billing.listCounters(b2.id)).map((r) => r.count)).toEqual([1]);
    });
  });

  it("setFlag creates then updates the per-business flag in place (same id)", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const f1 = await billing.setFlag({ businessId: b.id, key: "reports", enabled: true });
      expect(f1).toEqual({ id: f1.id, businessId: b.id, key: "reports", enabled: true });
      const f2 = await billing.setFlag({ businessId: b.id, key: "reports", enabled: false });
      expect(f2.id).toBe(f1.id);
      expect(f2.enabled).toBe(false);
      expect(await billing.getFlag(b.id, "reports")).toEqual(f2);
    });
  });

  it("global (NULL) flags and per-business overrides coexist for the same key; reads are scope-exact", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const billing = billingFamily(ctx);
      const b = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const global = await billing.setFlag({ businessId: null, key: "integrations", enabled: true });
      expect(global.businessId).toBeNull();
      expect(await billing.getFlag(null, "integrations")).toEqual(global);
      const override = await billing.setFlag({ businessId: b.id, key: "integrations", enabled: false });
      expect(await billing.getFlag(b.id, "integrations")).toEqual(override); // business sees its own row
      expect(await billing.getFlag(null, "integrations")).toEqual(global); // global row untouched
      const global2 = await billing.setFlag({ businessId: null, key: "integrations", enabled: false });
      expect(global2.id).toBe(global.id); // updated in place
      expect(global2.enabled).toBe(false);
      expect(await billing.getFlag(b.id, "integrations")).toEqual(override); // override survives
      expect(await billing.getFlag(b.id, "nope")).toBeNull();
      expect(await billing.getFlag(null, "nope")).toBeNull();
    });
  });
});

describe("phase12 pg billing: webhook events", () => {
  it("createWebhookEvent stamps receivedAt; findWebhookEvent matches provider+eventId exactly", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      const created = await billing.createWebhookEvent(webhookInput("evt_1"));
      expect(created.id).toBeTruthy();
      expect(created.receivedAt).toBeInstanceOf(Date);
      expect(created.payload).toEqual({ n: 1 });
      expect(await billing.findWebhookEvent("xendit", "evt_1")).toEqual(created);
      expect(await billing.findWebhookEvent("xendit", "evt_none")).toBeNull();
      expect(await billing.findWebhookEvent("paymongo", "evt_1")).toBeNull();
    });
  });

  it("claimWebhookEvent: first claim wins, immediate re-claim returns null, other providers unaffected", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      const won = await billing.claimWebhookEvent(webhookInput("evt_a"));
      expect(won).not.toBeNull();
      expect(won!.receivedAt).toBeInstanceOf(Date);
      const lost = await billing.claimWebhookEvent(webhookInput("evt_a"));
      expect(lost).toBeNull();
      const otherProvider = await billing.claimWebhookEvent({ ...webhookInput("evt_a"), provider: "paymongo", businessId: "biz_x" });
      expect(otherProvider).not.toBeNull();
      expect((await billing.findWebhookEvent("xendit", "evt_a"))!.id).toBe(won!.id);
    });
  });

  it("updateWebhookEventStatus and updateWebhookEventReceivedAt patch the claimed row", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      const won = (await billing.claimWebhookEvent({ ...webhookInput("evt_s"), status: "processing" }))!;
      await billing.updateWebhookEventStatus(won.id, "applied");
      let row = await billing.findWebhookEvent("xendit", "evt_s");
      expect(row!.status).toBe("applied");
      const later = new Date("2026-09-25T15:00:00.000Z");
      await billing.updateWebhookEventReceivedAt(won.id, later);
      row = await billing.findWebhookEvent("xendit", "evt_s");
      expect(row!.receivedAt).toEqual(later);
    });
  });

  it("deleteWebhookEvent removes the row (find -> null) and is idempotent", async () => {
    await withDbill(async (ctx) => {
      const billing = billingFamily(ctx);
      const won = (await billing.claimWebhookEvent(webhookInput("evt_d")))!;
      await billing.deleteWebhookEvent(won.id);
      expect(await billing.findWebhookEvent("xendit", "evt_d")).toBeNull();
      await expect(billing.deleteWebhookEvent("whev_none")).resolves.toBeUndefined();
    });
  });
});

describe("phase12 pg billing: devices round-trip", () => {
  it("create, list, find, revoke, and revoke the sessions bound via deviceId", async () => {
    await withDbill(async (ctx) => {
      const tenants = tenantsFamily(ctx);
      const devices = devicesFamily(ctx);
      const user = await seedUser(ctx);
      const b1 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const b2 = await tenants.createBusiness({ name: uniq("Biz"), currency: "PHP" });
      const dev = await devices.createDevice({ businessId: b1.id, userId: user.id, label: uniq("POS-"), revokedAt: null });
      await devices.createDevice({ businessId: b2.id, userId: user.id, label: uniq("POS-"), revokedAt: null });
      expect((await devices.listDevicesByBusiness(b1.id)).map((d) => d.id)).toEqual([dev.id]);
      expect(await devices.findDeviceById(dev.id, b1.id)).toEqual(dev);
      const session = await tenants.createSession({
        userId: user.id, businessId: b1.id, activeBusinessId: null, tokenHash: uniq("tok"),
        expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null,
        authenticatedAt: new Date(), ip: "127.0.0.1", userAgent: "vitest", deviceId: dev.id,
      });
      const at = new Date("2026-09-25T10:00:00.000Z");
      expect(await devices.revokeDevice(dev.id, b1.id, at)).toEqual({ ...dev, revokedAt: at });
      await devices.revokeSessionsByDevice(b1.id, dev.id);
      expect((await tenants.findSessionByTokenHash(session.tokenHash))!.revokedAt).not.toBeNull();
    });
  });
});
