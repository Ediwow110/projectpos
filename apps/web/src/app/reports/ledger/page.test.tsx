import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock("../../../components/ReportPageFrame", () => ({
  ReportPageFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-ui="report-frame" data-title={title}>{children}</div>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    String(queryKey[0]) === "me"
      ? { data: { role: "manager", businessName: "QA Business", permissions: fixture.permissions }, isLoading: false, isError: false, error: null }
      : { data: undefined, isLoading: false, isError: false, error: null },
}));

import LedgerReportPage from "./page";

Object.assign(globalThis, { React });

describe("ledger export page", () => {
  beforeEach(() => {
    fixture.permissions = [];
  });

  it("offers the ledger download with its row bound stated next to it", () => {
    fixture.permissions = ["export.run"];
    const html = renderToStaticMarkup(<LedgerReportPage />);
    expect(html).toContain('data-ui="export-csv"');
    expect(html).toContain("/api/v1/exports/ledger.csv?format=csv");
    expect(html).toContain("5,000");
  });

  it("explains why the download is absent instead of showing a page with nothing on it", () => {
    const html = renderToStaticMarkup(<LedgerReportPage />);
    expect(html).not.toContain('data-ui="export-csv"');
    expect(html).toContain("export permission");
  });

  it("narrows the download with an explicit date range", () => {
    fixture.permissions = ["export.run"];
    const html = renderToStaticMarkup(<LedgerReportPage />);
    expect(html).toContain('data-ui="ledger-export-from"');
    expect(html).toContain('data-ui="ledger-export-to"');
  });
});
