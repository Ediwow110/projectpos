import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  history: "ready" as "ready" | "empty" | "error",
  open: "ready" as "ready" | "empty" | "error",
}));

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === "me") return { data: { role: "owner", businessName: "QA Business" }, isError: false, error: null, refetch: vi.fn() };
    if (key === "registers" || key === "branches") return { data: { items: [] }, isError: false, error: null, refetch: vi.fn() };
    if (key === "shifts-open") {
      if (fixture.open === "error") return { data: undefined, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
      return { data: { items: [] }, isError: false, error: null, refetch: vi.fn() };
    }
    if (key === "shifts-history") {
      if (fixture.history === "error") return { data: undefined, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
      return { data: { items: [] }, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, isError: false, error: null, refetch: vi.fn() };
  },
}));

import ShiftsPage from "./page";

Object.assign(globalThis, { React });

describe("shift history and open-shift panels", () => {
  beforeEach(() => {
    fixture.history = "ready";
    fixture.open = "ready";
  });

  it("announces the genuine empty history when the query answered empty", () => {
    const html = renderToStaticMarkup(<ShiftsPage />);

    expect(html).toContain("No shift history yet.");
    expect(html).toContain("No open shifts");
  });

  it("shows a retryable error for the shift history instead of a blank table", () => {
    fixture.history = "error";

    const html = renderToStaticMarkup(<ShiftsPage />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No shift history yet.");
  });

  it("does not announce that no open shifts exist while that lookup is failing", () => {
    fixture.open = "error";

    const html = renderToStaticMarkup(<ShiftsPage />);

    expect(html).not.toContain("No open shifts");
    expect(html).toContain("role=\"alert\"");
  });
});
