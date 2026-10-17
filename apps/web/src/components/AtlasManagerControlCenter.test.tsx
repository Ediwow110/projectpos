import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasManagerControlCenter } from "./AtlasManagerControlCenter";

describe("Atlas V4 manager control center", () => {
  it("renders real report metrics, scoped attention, and reachable manager controls", () => {
    const html = renderToStaticMarkup(
      <AtlasManagerControlCenter
        overview={{ orders: 12, netRevenueMinor: 45000, compareLabel: "Previous period" }}
        attention={[{ kind: "inventory", label: "Low stock to review", href: "/inventory", count: 3 }]}
        loading={false} failed={false} onRetry={() => undefined}
      />,
    );
    expect(html).toContain('data-ui="atlas-manager-control-center"');
    expect(html).toContain("Manager control center");
    expect(html).toContain("12");
    expect(html).toContain("₱450.00");
    expect(html).toContain("Low stock to review");
    expect(html).toContain("3 to review");
    expect(html).toContain('href="/inventory"');
    expect(html).toContain('href="/customer-concerns"');
    expect(html).toContain('href="/exceptions"');
    expect(html).toContain('href="/shifts"');
    expect(html).toContain('href="/orders"');
    expect(html).not.toContain("8 on duty");
    expect(html).not.toContain("SAMPLE DATA");
  });

  it("does not invent records or zero counts on a failed report request", () => {
    const html = renderToStaticMarkup(
      <AtlasManagerControlCenter overview={null} attention={[]} loading={false} failed onRetry={() => undefined} />,
    );
    expect(html).toContain("Manager overview data is unavailable");
    expect(html).toContain(">Retry</button>");
    expect(html).not.toContain("No reported attention items");
    expect(html).not.toContain("Tenant directory");
  });
});
