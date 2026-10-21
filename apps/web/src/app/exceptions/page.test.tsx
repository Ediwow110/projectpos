import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  failing: [] as string[],
}));

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const name = String(queryKey[queryKey.length - 1]);
    if (name === "me") {
      return {
        data: {
          userId: "u-1", businessId: "b-1", role: "owner", activeBranchId: "br-1",
          businessName: "QA Business", activeBranchName: "Main branch",
        },
        isPending: false, isError: false, error: null,
      };
    }
    if (fixture.failing.includes(name)) {
      return { data: undefined, isPending: false, isError: true, error: new Error("FORBIDDEN") };
    }
    return { data: { items: [] }, isPending: false, isError: false, error: null };
  },
}));

import OperationalExceptionsPage from "./page";

Object.assign(globalThis, { React });

describe("OperationalExceptionsPage header count", () => {
  beforeEach(() => {
    fixture.failing = [];
  });

  it("reports a clean zero when every category answered empty", () => {
    const html = renderToStaticMarkup(<OperationalExceptionsPage />);

    expect(html).toContain("0 open exceptions");
    expect(html).toContain("No operational exceptions need review");
  });

  it("refuses to report a clean zero when every category query failed", () => {
    fixture.failing = ["unknown-payments", "submitted-counts", "held-sales", "web-orders"];

    const html = renderToStaticMarkup(<OperationalExceptionsPage />);

    expect(html).not.toContain("0 open exceptions");
    expect(html).not.toContain("No operational exceptions need review");
    expect(html).toContain("could not be checked");
  });

  it("names the category whose payment-status lookup failed", () => {
    fixture.failing = ["unknown-payments"];

    const html = renderToStaticMarkup(<OperationalExceptionsPage />);

    expect(html).toContain("payment status unknown");
    expect(html).toContain("could not be checked");
    expect(html).not.toContain("0 open exceptions");
  });

  it("keeps the visible count but marks it incomplete when one of four categories failed", () => {
    fixture.failing = ["web-orders"];

    const html = renderToStaticMarkup(<OperationalExceptionsPage />);

    expect(html).toContain("1 category could not be checked");
    expect(html).toContain("Incomplete");
  });
});
