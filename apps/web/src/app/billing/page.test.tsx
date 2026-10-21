import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";

const fixture = vi.hoisted(() => ({
  subscription: "free" as "free" | "enterprise" | "trial" | "loading" | "error" | "hollow",
  invoices: "some" as "some" | "empty" | "error" | "loading",
}));

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const SUBSCRIPTIONS: Record<string, unknown> = {
  free: {
    planKey: "free",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    usage: {
      users: { used: 2, limit: 3 },
      products: { used: 40, limit: 100 },
      registers: { used: 1, limit: 1 },
      branches: { used: 0, limit: 0 },
      salesMonthly: 12,
    },
  },
  enterprise: {
    planKey: "enterprise",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    usage: {
      users: { used: 9, limit: null },
      products: { used: 1200, limit: null },
      registers: { used: 4, limit: null },
      branches: { used: 3, limit: null },
      salesMonthly: 80,
    },
  },
  trial: {
    planKey: "pro",
    status: "trialing",
    trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    currentPeriodEnd: "2026-11-01T00:00:00.000Z",
    usage: {
      users: { used: 3, limit: 50 },
      products: { used: 20000, limit: 20000 },
      registers: { used: 11, limit: 10 },
      branches: { used: 0, limit: 0 },
      salesMonthly: 45,
    },
  },
};

const INVOICES = {
  items: [
    {
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
    },
  ],
};

function subscriptionQuery(): Record<string, unknown> {
  switch (fixture.subscription) {
    case "loading":
      return { data: undefined, isPending: true, isLoading: true, isError: false, error: null };
    case "error":
      return {
        data: undefined,
        isPending: false,
        isLoading: false,
        isError: true,
        error: new ApiError("NETWORK_ERROR", "Could not reach the API.", "c-1", 0),
      };
    case "hollow":
      return { data: undefined, isPending: false, isLoading: false, isError: false, error: null };
    default:
      return { data: SUBSCRIPTIONS[fixture.subscription], isPending: false, isLoading: false, isError: false, error: null };
  }
}

function invoicesQuery(): Record<string, unknown> {
  switch (fixture.invoices) {
    case "loading":
      return { data: undefined, isPending: true, isLoading: true, isError: false, error: null };
    case "error":
      return {
        data: undefined,
        isPending: false,
        isLoading: false,
        isError: true,
        error: new ApiError("UNAUTHORIZED", "Session expired.", "c-2", 401),
      };
    case "empty":
      return { data: { items: [] }, isPending: false, isLoading: false, isError: false, error: null };
    default:
      return { data: INVOICES, isPending: false, isLoading: false, isError: false, error: null };
  }
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    const refetch = vi.fn();
    if (key === "me") {
      return {
        data: { role: "owner", businessName: "QA Business", permissions: [] },
        isPending: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch,
      };
    }
    if (key === "billing-subscription") return { ...subscriptionQuery(), refetch };
    if (key === "billing-invoices") return { ...invoicesQuery(), refetch };
    return { data: undefined, isPending: false, isLoading: false, isError: false, error: null, refetch };
  },
}));

import BillingPage from "./page";

Object.assign(globalThis, { React });

function render(): string {
  return renderToStaticMarkup(<BillingPage />);
}

// Attribute values (`shadow-[..._15/0.10]`, `px-2.5`) are not owner-visible
// text, so numeric claims are checked against the stripped markup only.
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

describe("/billing plan and usage surface", () => {
  beforeEach(() => {
    fixture.subscription = "free";
    fixture.invoices = "some";
  });

  it("renders the current plan and one meter per usage slice when the read answered", () => {
    const html = render();

    expect(html).toContain("Free");
    expect(html).toContain("Active");
    expect(html).toContain("User");
    expect(html).toContain("Product");
    expect(html).toContain("Register");
    expect(html).toContain("Branch");
    expect(html).toContain("2 of 3");
    expect(html).toContain("Nov 01, 2026");
    expect(html).toContain("At limit");
  });

  it("renders an unmetered limit as words with no fabricated limit number", () => {
    fixture.subscription = "enterprise";

    const html = render();

    expect(html).toContain("Enterprise");
    expect(html).toContain("Unmetered");
    expect(visibleText(html)).toContain("9 in use");
    // A `used of limit` pair, or a printed `null`/`NaN` limit, is the failure.
    expect(visibleText(html)).not.toContain(" of ");
    expect(visibleText(html)).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
    expect(visibleText(html)).not.toMatch(/of\s+(null|NaN|undefined)/);
  });

  it("keeps a breached limit visibly distinct from a limit that is merely full", () => {
    fixture.subscription = "trial";

    const html = render();

    expect(html).toContain("Over limit");
    expect(html).toContain("20000 of 20000");
    expect(html).not.toContain("20000 of 20000 At limit");
    // The registers slice is past its cap while products only reach it.
    expect(html.match(/Over limit/g)).toHaveLength(1);
  });

  it("never shows zero usage while the subscription read is failing", () => {
    fixture.subscription = "error";
    fixture.invoices = "error";

    const html = render();

    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry");
    expect(html).toContain("NETWORK_ERROR");
    expect(html).toContain("Data unavailable");
    expect(visibleText(html)).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
    expect(html).not.toContain("Unmetered");
    expect(html).not.toContain("2 of 3");
  });

  it("does not read a missing subscription body as a zeroed plan", () => {
    fixture.subscription = "hollow";

    const html = render();

    expect(html).toContain("Unavailable");
    expect(html).toContain("Data unavailable");
    expect(visibleText(html)).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
    expect(html).not.toContain("No current period on file");
  });

  it("labels the loading state as loading instead of as unavailable data", () => {
    fixture.subscription = "loading";
    fixture.invoices = "loading";

    const html = render();

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading");
    expect(html).not.toContain("Data unavailable");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("No invoices have been issued for this business.");
    expect(html).not.toContain("₱490.00");
  });

  it("distinguishes a failed invoice read from a genuinely empty ledger", () => {
    fixture.invoices = "error";
    const failed = render();
    expect(failed).toContain("Invoices could not be loaded.");
    expect(failed).not.toContain("No invoices have been issued for this business.");

    fixture.invoices = "empty";
    const empty = render();
    expect(empty).toContain("No invoices have been issued for this business.");
    expect(empty).not.toContain("Invoices could not be loaded.");
    expect(empty).not.toContain("UNAUTHORIZED");
  });

  it("lists only real invoice columns when the ledger has rows", () => {
    const html = render();

    expect(html).toContain("Invoice 0f4d1a2b");
    expect(html).toContain("₱490.00");
    expect(html).toContain("Sep 01, 2026 – Sep 30, 2026");
    expect(html).toContain("Not paid");
    expect(html).toContain("<table");
  });

  it("shows the trial countdown only when the server gives a trial date", () => {
    fixture.subscription = "trial";
    const withTrial = render();
    expect(withTrial).toContain("days left in trial");
    expect(withTrial).toContain("14 days left in trial");

    fixture.subscription = "free";
    const withoutTrial = render();
    expect(withoutTrial).not.toContain("days left");
    expect(withoutTrial).not.toContain("Trial has ended");
  });

  it("offers no control that could change a plan", () => {
    for (const state of ["free", "enterprise", "trial", "error", "loading"] as const) {
      fixture.subscription = state;
      const html = render();

      expect(html).not.toMatch(/upgrade|downgrade|change plan|cancel subscription|checkout|subscribe|start trial/i);
      expect(html).not.toContain("<form");
      expect(html).not.toMatch(/<a[^>]+href="\/platform/i);
    }
  });

  it("wires both retry controls to their own query refetch", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/billing/page.tsx"), "utf8");

    expect(source).toContain("subscription.refetch()");
    expect(source).toContain("invoices.refetch()");
    expect(source).toContain('queryKey: ["billing-subscription"]');
    expect(source).toContain('queryKey: ["billing-invoices"]');
    expect(source).toContain("retry: false");
  });
});
