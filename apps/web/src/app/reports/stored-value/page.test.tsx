import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  permissions: [] as string[],
  state: "ready" as "ready" | "error" | "zero",
}));

vi.mock("../../../components/ReportPageFrame", () => ({
  ReportPageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-ui="report-frame" data-title={title}>{children}</div>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === "me") {
      return { data: { role: "manager", businessName: "QA Business", permissions: fixture.permissions }, isLoading: false, isError: false, error: null };
    }
    if (key === "report-stored-value") {
      if (fixture.state === "error") {
        return { data: undefined, isLoading: false, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
      }
      if (fixture.state === "zero") {
        return {
          data: { giftCards: { count: 0, liabilityMinor: 0 }, storeCredit: { liabilityMinor: 0 }, loyalty: { outstandingPoints: 0 } },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { giftCards: { count: 3, liabilityMinor: 123456 }, storeCredit: { liabilityMinor: 4500 }, loyalty: { outstandingPoints: 880 } },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    }
    return { data: undefined, isLoading: false, isError: false, error: null };
  },
}));

import StoredValueReportPage from "./page";

Object.assign(globalThis, { React });

describe("stored value liability report", () => {
  beforeEach(() => {
    fixture.permissions = ["stored_value.adjust"];
    fixture.state = "ready";
  });

  it("states each liability the server reports, in pesos", () => {
    const html = renderToStaticMarkup(<StoredValueReportPage />);
    expect(html).toContain("1,234.56");
    expect(html).toContain("45.00");
    expect(html).toContain("880");
    expect(html).toContain("3");
  });

  it("does not dress a failed query up as a zero liability", () => {
    fixture.state = "error";
    const html = renderToStaticMarkup(<StoredValueReportPage />);
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No stored value on record");
    expect(html).toContain("Retry");
  });

  it("withholds the figures from a session that cannot review stored value", () => {
    fixture.permissions = [];
    const html = renderToStaticMarkup(<StoredValueReportPage />);
    expect(html).not.toContain("1,234.56");
    expect(html).toContain("stored-value review");
  });

  it("calls an all-zero book an all-zero book", () => {
    fixture.state = "zero";
    const html = renderToStaticMarkup(<StoredValueReportPage />);
    expect(html).toContain("No stored value on record");
  });
});
