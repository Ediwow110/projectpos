import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasOwnerOverview } from "./AtlasOwnerOverview";
import type { SaleReadiness } from "../lib/sale-readiness";

describe("Atlas V4 owner landing overview", () => {
  it("prompts legacy owners to review missing saved business settings without inventing metrics", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      legacySetupReviewSteps={["businessDetails", "taxCurrency", "receiptSetup"]}
    />);
    expect(html).toContain('aria-label="Review business setup"');
    expect(html).toContain("3 required configuration");
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("Existing workspace access is preserved");
  });
  it("shows authoritative scoped results and keeps links to reports and operational controls", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={{ orders: 18, netRevenueMinor: 4862000 }}
      attention={[{ kind: "stock", label: "Low stock to review", href: "/inventory", count: 7 }]}
      loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Today", days: 0 }, { label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
    />);
    expect(html).toContain('data-ui="atlas-v4-owner-overview"');
    expect(html).toContain("Owner overview");
    expect(html).toContain("₱48,620.00");
    expect(html).toContain('aria-label="Owner report period"');
    expect(html).toContain('value="30" selected=""');
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Sales in selected period");
    expect(html).toContain("Reported attention items");
    expect(html).toContain("Low stock to review");
    expect(html).toContain('href="/reports/sales"');
    expect(html).toContain('href="/sales"');
    expect(html).toContain('href="/inventory"');
    expect(html).toContain('href="/orders"');
    expect(html).toContain('href="/shifts"');
  });

  it("does not show invented zeros when the authorized report fails", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
    />);
    expect(html).toContain("Owner overview unavailable");
    expect(html).toContain(">Retry</button>");
    expect(html).not.toContain("₱0.00");
    expect(html).not.toContain("No reported attention items");
  });

  it("shows the server sale-readiness checklist and links to the real setup flows", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: [], hasSellableProduct: false,
        hasActiveRegister: false, hasOpenShift: false, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: false,
        missing: ["sellable_product_or_stock", "active_register", "open_shift"],
      }}
    />);
    expect(html).toContain('aria-label="First sale readiness"');
    expect(html).toContain("Not ready for first sale");
    expect(html).toContain("Business setup is complete");
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="/registers"');
    expect(html).toContain('href="/shifts"');
    expect(html).toContain("No sellable product yet");
    expect(html).toContain("No active register yet");
    expect(html).toContain("No open shift yet");
    expect(html).toContain("Review business setup");
    expect(html).not.toContain("₱0.00");
  });

  it("confirms first-sale readiness when the server reports every check is satisfied", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={{ orders: 18, netRevenueMinor: 4862000 }} attention={[]} loading={false} failed={false}
      onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: [], hasSellableProduct: true,
        hasActiveRegister: true, hasOpenShift: true, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: true, missing: [],
      }}
    />);
    expect(html).toContain("Ready for first sale");
    expect(html).not.toContain("Not ready for first sale");
    expect(html).toContain("Review business setup");
  });

  it("does not present a completed business setup as first-sale readiness", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: false, legacySetupReviewSteps: ["businessDetails"], hasSellableProduct: false,
        hasActiveRegister: false, hasOpenShift: false, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: false,
        missing: ["business_setup", "business_setup_review", "active_register"],
      }}
    />);
    expect(html).toContain("Not ready for first sale");
    expect(html).not.toContain("Business setup is complete");
    expect(html).toContain("Business setup needs to be reviewed and saved.");
  });

  it("does not present a branch as a prerequisite for a register", () => {    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: [], hasSellableProduct: true,
        hasActiveRegister: false, hasOpenShift: false, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: false, missing: ["active_register"],
      }}
    />);
    expect(html).not.toContain('href="/branches"');
  });

  it("does not claim setup is complete while required settings are still missing", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: ["businessDetails"], hasSellableProduct: true,
        hasActiveRegister: true, hasOpenShift: true, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: false, missing: ["business_setup_review"],
      }}
    />);
    expect(html).not.toContain("Business setup is complete");
    expect(html).toContain("Business setup needs to be reviewed and saved.");
  });

  it("does not crash when the readiness payload omits the legacy review steps", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: undefined, hasSellableProduct: true,
        hasActiveRegister: true, hasOpenShift: true, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: true, missing: [],
      } as unknown as SaleReadiness}
    />);
    expect(html).toContain('aria-label="First sale readiness"');
    expect(html).not.toContain("Business setup is complete");
  });

  it("never renders a raw machine identifier for an unknown server gap", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: [], hasSellableProduct: true,
        hasActiveRegister: true, hasOpenShift: true, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: false, missing: ["some_new_server_check"],
      }}
    />);
    expect(html).not.toContain("some_new_server_check");
    expect(html).toContain("First sale readiness");
  });

  it("states the readiness load and failure states without inventing a ready verdict", () => {
    const loading = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
    />);
    expect(loading).toContain('aria-label="First sale readiness"');
    expect(loading).toContain("Checking sale readiness…");
    expect(loading).not.toContain("Ready for first sale");
    expect(loading).not.toContain("Not ready for first sale");

    const failed = renderToStaticMarkup(<AtlasOwnerOverview
      overview={null} attention={[]} loading={false} failed={false} onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readinessFailed
    />);
    expect(failed).toContain("Could not load sale readiness");
    expect(failed).not.toContain("Ready for first sale");
    expect(failed).not.toContain("Not ready for first sale");
  });

  it("does not keep a cached ready verdict when a readiness refresh fails", () => {
    const html = renderToStaticMarkup(<AtlasOwnerOverview
      overview={{ orders: 18, netRevenueMinor: 4862000 }} attention={[]} loading={false} failed={false}
      onRetry={() => undefined}
      period={30} periods={[{ label: "Last 30 days", days: 30 }]} onPeriodChange={() => undefined}
      readiness={{
        businessConfigured: true, legacySetupReviewSteps: [], hasSellableProduct: true,
        hasActiveRegister: true, hasOpenShift: true, hasStaff: false,
        canCustomizeReceipt: false, readyForFirstSale: true, missing: [],
      }}
      readinessFailed
    />);

    expect(html).toContain("Readiness unavailable");
    expect(html).toContain("Could not refresh sale readiness");
    expect(html).not.toContain("Ready for first sale");
    expect(html).not.toContain("Not ready for first sale");
  });
});
