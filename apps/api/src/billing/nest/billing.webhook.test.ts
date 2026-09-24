import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BillingService, canonicalWebhookBody } from "./billing.service";

const SECRET = "webhook-test-secret";

async function setup() {
  const db = createMemoryDb();
  const business = await db.createBusiness({ name: "Hook Store", currency: "PHP" });
  const pro = (await db.findPlanByKey("pro"))!;
  const basic = (await db.findPlanByKey("basic"))!;
  await db.upsertSubscription({
    businessId: business.id, planId: pro.id, status: "active",
    trialEndsAt: null, currentPeriodEnd: new Date("2030-01-01T00:00:00.000Z"),
  });
  process.env["BILLING_TEST_DOUBLE_SECRET"] = SECRET;
  return { db, business, basic, billing: new BillingService(db) };
}

function sign(body: unknown): string {
  return createHmac("sha256", SECRET).update(canonicalWebhookBody(body)).digest("hex");
}

async function send(
  billing: BillingService,
  eventId: string,
  type: string,
  payload: Record<string, unknown>,
  requestId: string,
): Promise<{ ok: true; handled: boolean; deduplicated: boolean }> {
  const body = { eventId, type, ...payload };
  return billing.ingestWebhook("test-double", eventId, type, payload, sign(body), requestId);
}

describe("phase10 webhook event coverage", () => {
  it("applies concurrent deliveries of one event exactly once", async () => {
    const { db, business, billing } = await setup();
    const invoice = await billing.issueInvoice(business.id, "platform", "r-issue", {
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    });
    const payload = { businessId: business.id, invoiceId: invoice.id, amountMinor: invoice.amountMinor };

    const results = await Promise.all([
      send(billing, "evt-race", "invoice.paid", payload, "r1"),
      send(billing, "evt-race", "invoice.paid", payload, "r2"),
      send(billing, "evt-race", "invoice.paid", payload, "r3"),
    ]);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
    const paid = (await db.listInvoices(business.id)).filter((i) => i.status === "paid");
    expect(paid).toHaveLength(1);
    expect(paid[0].id).toBe(invoice.id);
    expect((await db.listAudit()).filter((a) => a.action === "webhook.invoice")).toHaveLength(1);
  });

  it("pays the invoice named by the event, not the oldest open one", async () => {
    const { db, business, billing } = await setup();
    const first = await billing.issueInvoice(business.id, "platform", "r1", {
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
    });
    const second = await billing.issueInvoice(business.id, "platform", "r2", {
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    });
    await send(billing, "evt-second", "invoice.paid", {
      businessId: business.id, invoiceId: second.id, amountMinor: second.amountMinor,
    }, "r3");

    const invoices = await db.listInvoices(business.id);
    expect(invoices.find((i) => i.id === first.id)!.status).toBe("open");
    expect(invoices.find((i) => i.id === second.id)!.status).toBe("paid");
  });

  it("rejects a paid event whose amount does not match the invoice", async () => {
    const { business, billing } = await setup();
    const invoice = await billing.issueInvoice(business.id, "platform", "r1", {
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    });
    await expect(
      send(billing, "evt-wrong-amount", "invoice.paid", {
        businessId: business.id, invoiceId: invoice.id, amountMinor: invoice.amountMinor + 1,
      }, "r2"),
    ).rejects.toThrow("VALIDATION");
  });

  it("voids an invoice on invoice.void without deleting it", async () => {
    const { db, business, billing } = await setup();
    const invoice = await billing.issueInvoice(business.id, "platform", "r1", {
      periodStart: new Date("2026-09-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-01T00:00:00.000Z"),
    });
    const out = await send(billing, "evt-void", "invoice.void", {
      businessId: business.id, invoiceId: invoice.id, reason: "duplicate billing",
    }, "r2");
    expect(out.handled).toBe(true);
    const rows = await db.listInvoices(business.id);
    expect(rows.find((i) => i.id === invoice.id)!.status).toBe("void");
    expect((await db.listAudit()).some((a) => a.action === "invoice.void")).toBe(true);
  });

  it("records subscription.created and status transitions from subscription.updated", async () => {
    const { db, business, basic, billing } = await setup();
    const created = await send(billing, "evt-sub-created", "subscription.created", {
      businessId: business.id, planKey: "basic", status: "trialing",
    }, "r1");
    expect(created.handled).toBe(true);
    const sub = await db.getSubscription(business.id);
    expect(sub!.planId).toBe(basic.id);
    expect(sub!.status).toBe("trialing");

    await send(billing, "evt-sub-past-due", "subscription.updated", {
      businessId: business.id, planKey: "basic", status: "past_due",
    }, "r2");
    expect((await db.getSubscription(business.id))!.status).toBe("past_due");

    await send(billing, "evt-sub-cancelled", "subscription.updated", {
      businessId: business.id, planKey: "basic", status: "cancelled",
    }, "r3");
    // Provider spellings are normalized: the store keeps "canceled", and a
    // canceled subscription no longer grants the paid plan.
    expect((await db.getSubscription(business.id))!.status).toBe("canceled");
    expect((await billing.resolvePlan(business.id)).key).toBe("free");
    const audits = await db.listAudit();
    expect(audits.some((a) => a.action === "subscription.created")).toBe(true);
    expect(audits.some((a) => a.action === "subscription.updated")).toBe(true);
  });

  it("acknowledges unknown event types without touching billing state", async () => {
    const { business, billing } = await setup();
    const out = await send(billing, "evt-unknown", "customer.created", { businessId: business.id }, "r1");
    expect(out).toEqual({ ok: true, handled: false, deduplicated: false });
  });
});
