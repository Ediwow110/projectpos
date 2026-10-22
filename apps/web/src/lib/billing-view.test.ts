import { describe, expect, it } from "vitest";

import {
  billingOverview,
  invoiceLedger,
  type InvoiceWire,
  type SubscriptionWire,
  type UsageSliceWire,
} from "./billing-view";

// Every read is anchored to a fixed clock so the trial countdown and the
// date formatting never depend on the machine running the suite.
const NOW = Date.parse("2026-10-01T00:00:00.000Z");

function slice(used: number, limit: number | null): UsageSliceWire {
  return { used, limit };
}

/** The Free-plan payload the API actually returns: caps 3/100/1 and branches 0. */
function freeUsage() {
  return {
    users: slice(2, 3),
    products: slice(40, 100),
    registers: slice(1, 1),
    branches: slice(0, 0),
    salesMonthly: 12,
  };
}

function payload(overrides: Partial<SubscriptionWire> = {}): SubscriptionWire {
  return {
    planKey: "free",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    usage: freeUsage(),
    ...overrides,
  };
}

function meter(view: ReturnType<typeof billingOverview>, key: string) {
  const found = view.meters.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no meter row for ${key}`);
  return found;
}

function invoice(overrides: Partial<InvoiceWire> = {}): InvoiceWire {
  return {
    id: "0f4d1a2b-9c3c-4b7a-8a2d-1c9e0b6f5a11",
    businessId: "biz-1",
    subscriptionId: "sub-1",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-09-30T00:00:00.000Z",
    amountMinor: 49000,
    currency: "PHP",
    status: "open",
    issuedAt: "2026-09-30T00:00:00.000Z",
    paidAt: null,
    ...overrides,
  };
}

describe("billing usage meters", () => {
  it("renders an unmetered limit as words and never as a limit number", () => {
    const view = billingOverview(
      "ready",
      payload({
        planKey: "enterprise",
        usage: {
          users: slice(9, null),
          products: slice(1200, null),
          registers: slice(4, null),
          branches: slice(3, null),
          salesMonthly: 80,
        },
      }),
      NOW,
    );

    const users = meter(view, "users");
    expect(users.kind).toBe("unmetered");
    expect(users.limit).toBeNull();
    expect(users.pct).toBeNull();
    expect(users.valueText).toBe("9 in use");
    expect(users.stateText).toBe("Unmetered");
    // No `used/limit` pair may leak into any row of an unmetered plan.
    for (const row of view.meters) {
      expect(row.valueText).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
      expect(row.valueText).not.toContain("of");
    }
  });

  it("keeps a zero limit distinct from an unmetered one", () => {
    const view = billingOverview("ready", payload(), NOW);
    const branches = meter(view, "branches");
    const users = meter(view, "users");

    expect(branches.kind).toBe("not-included");
    expect(branches.limit).toBe(0);
    expect(branches.stateText).toBe("Not included");
    expect(branches.breached).toBe(false);
    expect(users.kind).toBe("metered");
    expect(users.stateText).not.toBe(branches.stateText);
  });

  it("reads a limit of zero that is actually in use as a breach, not as headroom", () => {
    const usage = freeUsage();
    const view = billingOverview(
      "ready",
      payload({ usage: { ...usage, branches: slice(2, 0) } }),
      NOW,
    );
    const branches = meter(view, "branches");

    expect(branches.kind).toBe("not-included");
    expect(branches.breached).toBe(true);
    expect(branches.stateText).toBe("Over limit");
    expect(branches.tone).toBe("bad");
  });

  it("separates a breached limit from a limit that is merely full", () => {
    const usage = freeUsage();
    const full = billingOverview("ready", payload(), NOW);
    const breached = billingOverview(
      "ready",
      payload({ usage: { ...usage, registers: slice(4, 1) } }),
      NOW,
    );

    const fullRow = meter(full, "registers");
    const breachRow = meter(breached, "registers");

    expect(fullRow.full).toBe(true);
    expect(fullRow.breached).toBe(false);
    expect(fullRow.stateText).toBe("At limit");
    expect(fullRow.tone).toBe("warn");

    expect(breachRow.full).toBe(false);
    expect(breachRow.breached).toBe(true);
    expect(breachRow.stateText).toBe("Over limit");
    expect(breachRow.tone).toBe("bad");

    // usagePct() saturates at 100, so the percentage alone cannot tell these
    // two apart; the flags are what makes a breach distinguishable.
    expect(breachRow.pct).toBe(100);
    expect(fullRow.pct).toBe(100);
    expect(breachRow.stateText).not.toBe(fullRow.stateText);
  });

  it("reports every meter as unavailable instead of zero when the read failed or is pending", () => {
    for (const state of ["loading", "error"] as const) {
      const view = billingOverview(state, null, NOW);

      expect(view.meters).toHaveLength(4);
      for (const row of view.meters) {
        expect(row.kind).toBe("unknown");
        expect(row.used).toBeNull();
        expect(row.pct).toBeNull();
        expect(row.breached).toBe(false);
        expect(row.full).toBe(false);
        expect(row.stateText).toBe("Data unavailable");
        expect(row.valueText).not.toMatch(/\b0\b/);
      }
      expect(view.planName).toBe("Unavailable");
      expect(view.salesMonthly).toBeNull();
      expect(view.salesMonthlyText).toBe("Unavailable");
      expect(view.trial).toBeNull();
    }

    // A 2xx with no body is the same defect class, so it must not be 0 either.
    const hollow = billingOverview("ready", null, NOW);
    expect(hollow.meters.every((row) => row.kind === "unknown")).toBe(true);
    expect(hollow.planName).toBe("Unavailable");
  });

  it("treats a slice the payload omitted as unknown rather than as zero usage", () => {
    const usage = freeUsage();
    const partial: SubscriptionWire = {
      ...payload(),
      usage: { ...usage, products: undefined },
    };
    const view = billingOverview("ready", partial, NOW);

    expect(meter(view, "products").kind).toBe("unknown");
    expect(meter(view, "products").valueText).not.toBe("0 of 100");
    expect(meter(view, "users").kind).toBe("metered");
  });

  it("does not read a non-finite used count as zero", () => {
    const usage = freeUsage();
    const view = billingOverview(
      "ready",
      payload({ usage: { ...usage, users: slice(Number.NaN, 3) } }),
      NOW,
    );

    expect(meter(view, "users").kind).toBe("unknown");
    expect(meter(view, "users").used).toBeNull();
  });

  it("keeps the four metered slices the API exposes, in order", () => {
    const view = billingOverview("ready", payload(), NOW);
    expect(view.meters.map((row) => row.key)).toEqual([
      "users",
      "products",
      "registers",
      "branches",
    ]);
    expect(view.meters.map((row) => row.label)).toEqual([
      "User",
      "Product",
      "Register",
      "Branch",
    ]);
  });
});

describe("billing plan, trial and period rows", () => {
  it("names the plan and mirrors the server status", () => {
    const view = billingOverview("ready", payload(), NOW);

    expect(view.planKey).toBe("free");
    expect(view.planName).toBe("Free");
    expect(view.statusLabel).toBe("Active");
    expect(view.statusTone).toBe("ok");

    const pastDue = billingOverview("ready", payload({ status: "past_due" }), NOW);
    expect(pastDue.statusLabel).toBe("Past due");
    expect(pastDue.statusTone).toBe("warn");
  });

  it("shows a trial countdown only when the payload carries a trial date", () => {
    const withTrial = billingOverview(
      "ready",
      payload({
        status: "trialing",
        trialEndsAt: new Date(NOW + 14 * 86400000).toISOString(),
      }),
      NOW,
    );
    expect(withTrial.trial?.daysLeft).toBe(14);
    expect(withTrial.trial?.text).toBe("14 days left in trial");
    expect(withTrial.trial?.ended).toBe(false);

    // `trialing` without a date is not a countdown, so nothing renders.
    const noDate = billingOverview("ready", payload({ status: "trialing", trialEndsAt: null }), NOW);
    expect(noDate.trial).toBeNull();
  });

  it("counts a single remaining day in the singular", () => {
    const view = billingOverview(
      "ready",
      payload({ status: "trialing", trialEndsAt: new Date(NOW + 86400000).toISOString() }),
      NOW,
    );
    expect(view.trial?.text).toBe("1 day left in trial");
  });

  it("marks a past trial end as ended instead of a countdown", () => {
    const view = billingOverview(
      "ready",
      payload({ status: "trialing", trialEndsAt: new Date(NOW - 86400000).toISOString() }),
      NOW,
    );

    expect(view.trial?.daysLeft).toBe(0);
    expect(view.trial?.ended).toBe(true);
    expect(view.trial?.text).toBe("Trial has ended");
  });

  it("never renders a malformed trial date as a number", () => {
    const view = billingOverview(
      "ready",
      payload({ status: "trialing", trialEndsAt: "sometime next month" }),
      NOW,
    );

    expect(view.trial?.daysLeft).toBeNull();
    expect(view.trial?.text).toBe("Trial end date unavailable");
    expect(view.trial?.text ?? "").not.toContain("NaN");
  });

  it("formats the current period end and degrades to a labelled fallback", () => {
    expect(billingOverview("ready", payload(), NOW).periodEndText).toBe("Nov 01, 2026");
    expect(
      billingOverview("ready", payload({ currentPeriodEnd: null }), NOW).periodEndText,
    ).toBe("No current period on file");
    expect(
      billingOverview("error", null, NOW).periodEndText,
    ).toBe("Unavailable");
  });

  it("keeps monthly sales as its own read, distinct from a zero", () => {
    expect(billingOverview("ready", payload(), NOW).salesMonthlyText).toBe("12");

    const usage = freeUsage();
    expect(
      billingOverview("ready", payload({ usage: { ...usage, salesMonthly: 0 } }), NOW)
        .salesMonthlyText,
    ).toBe("0");
    expect(
      billingOverview("ready", payload({ usage: { ...usage, salesMonthly: null } }), NOW)
        .salesMonthlyText,
    ).toBe("Unavailable");
    expect(billingOverview("loading", undefined, NOW).salesMonthlyText).toBe("Unavailable");
  });
});

describe("billing invoice ledger", () => {
  it("distinguishes a failed invoice read from a genuinely empty ledger", () => {
    const failed = invoiceLedger("error", null);
    const empty = invoiceLedger("ready", []);
    const loading = invoiceLedger("loading", undefined);

    expect(failed.rows).toHaveLength(0);
    expect(empty.rows).toHaveLength(0);

    expect(failed.statusText).toBe("Invoices could not be loaded.");
    expect(empty.statusText).toBe("No invoices have been issued for this business.");
    expect(loading.statusText).toBe("Loading invoices…");
    expect(failed.statusText).not.toBe(empty.statusText);
    expect(failed.rows).not.toContain(undefined);
  });

  it("treats a 2xx with no items array as empty, not as a failure", () => {
    const ledger = invoiceLedger("ready", undefined);
    expect(ledger.state).toBe("ready");
    expect(ledger.rows).toHaveLength(0);
    expect(ledger.statusText).toBe("No invoices have been issued for this business.");
  });

  it("renders exactly the invoice fields the ledger returns, with no invented columns", () => {
    const [row] = invoiceLedger("ready", [invoice()]).rows;

    expect(row).toEqual({
      id: "0f4d1a2b-9c3c-4b7a-8a2d-1c9e0b6f5a11",
      idLabel: "Invoice 0f4d1a2b",
      periodText: "Sep 01, 2026 – Sep 30, 2026",
      issuedText: "Sep 30, 2026",
      amountText: "₱490.00",
      currency: "PHP",
      statusLabel: "Open",
      paidText: "Not paid",
      tone: "warn",
    });
  });

  it("carries a paid invoice's status and paid date", () => {
    const [row] = invoiceLedger("ready", [
      invoice({ status: "paid", paidAt: "2026-10-02T00:00:00.000Z", amountMinor: 149000 }),
    ]).rows;

    expect(row.statusLabel).toBe("Paid");
    expect(row.tone).toBe("ok");
    expect(row.paidText).toBe("Oct 02, 2026");
    expect(row.amountText).toBe("₱1,490.00");
  });

  it("labels a void invoice and a currency other than PHP", () => {
    const [voided] = invoiceLedger("ready", [invoice({ status: "void" })]).rows;
    expect(voided.statusLabel).toBe("Void");
    expect(voided.tone).toBe("info");

    const [foreign] = invoiceLedger("ready", [invoice({ currency: "USD" })]).rows;
    expect(foreign.amountText).toBe("USD 490.00");
    expect(foreign.currency).toBe("USD");
  });

  it("keeps an unreadable amount or period from rendering as zero", () => {
    const [row] = invoiceLedger("ready", [
      invoice({ amountMinor: Number.NaN, periodStart: "nope", issuedAt: "" }),
    ]).rows;

    expect(row.amountText).toBe("Unavailable");
    expect(row.periodText).toBe("Unavailable");
    expect(row.issuedText).toBe("Unavailable");
    expect(row.statusLabel).toBe("Open");
  });

  it("keeps an unknown status factual instead of inventing a label", () => {
    const [row] = invoiceLedger("ready", [invoice({ status: "pending_verification" })]).rows;
    expect(row.statusLabel).toBe("Pending verification");
    expect(row.tone).toBe("info");
  });

  it("drops malformed invoice rows instead of rendering them as blank zeroes", () => {
    const ledger = invoiceLedger("ready", [
      invoice(),
      { ...invoice({ id: "" }) } as unknown as InvoiceWire,
    ]);

    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0]?.idLabel).toBe("Invoice 0f4d1a2b");
  });
});
