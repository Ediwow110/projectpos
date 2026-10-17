import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasOwnerOverview } from "./AtlasOwnerOverview";

describe("Atlas V4 owner landing overview", () => {
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
});
