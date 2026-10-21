import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  families: "ready" as "ready" | "empty" | "error",
}));

vi.mock("../../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    if (queryKey[0] !== "product-families") return { data: undefined, isError: false, error: null, refetch: vi.fn() };
    if (fixture.families === "error") {
      return { data: undefined, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
    }
    return { data: { items: fixture.families === "empty" ? [] : [{ id: "f1", name: "Burgers" }] }, isError: false, error: null, refetch: vi.fn() };
  },
}));

import ProductFamiliesPage from "./page";

Object.assign(globalThis, { React });

describe("product families list", () => {
  beforeEach(() => {
    fixture.families = "ready";
  });

  it("announces the genuine empty catalog when the query answered empty", () => {
    fixture.families = "empty";

    const html = renderToStaticMarkup(<ProductFamiliesPage />);

    expect(html).toContain("No families yet.");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("shows a retryable error instead of a blank families panel when the query failed", () => {
    fixture.families = "error";

    const html = renderToStaticMarkup(<ProductFamiliesPage />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Retry");
  });

  it("does not announce that no families exist while the failure is on screen", () => {
    fixture.families = "error";

    const html = renderToStaticMarkup(<ProductFamiliesPage />);

    expect(html).not.toContain("No families yet.");
  });
});
