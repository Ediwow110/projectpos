import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  printers: "ready" as "ready" | "empty" | "error",
  jobs: "ready" as "ready" | "empty" | "error",
}));

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === "me") return { data: { role: "owner", businessName: "QA Business" }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    if (key === "branches") return { data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    const mode = key === "printers" ? fixture.printers : key === "print-jobs" ? fixture.jobs : "ready";
    if (mode === "error") return { data: undefined, isLoading: false, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
    return { data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));

import PrintersPage from "./page";

Object.assign(globalThis, { React });

describe("printer and print-queue panels", () => {
  beforeEach(() => {
    fixture.printers = "ready";
    fixture.jobs = "ready";
  });

  it("announces the genuine empty state when both queries answered empty", () => {
    const html = renderToStaticMarkup(<PrintersPage />);

    expect(html).toContain("No printers enrolled yet.");
    expect(html).toContain("No print jobs yet.");
  });

  it("shows a retryable error instead of claiming no printers are enrolled", () => {
    fixture.printers = "error";

    const html = renderToStaticMarkup(<PrintersPage />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No printers enrolled yet.");
  });

  it("does not claim an empty print queue while that lookup is failing", () => {
    fixture.jobs = "error";

    const html = renderToStaticMarkup(<PrintersPage />);

    expect(html).not.toContain("No print jobs yet.");
    expect(html).toContain("role=\"alert\"");
  });
});
