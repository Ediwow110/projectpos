import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  state: "two" as "two" | "one" | "error",
}));

vi.mock("../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === "me") {
      return { data: { role: "manager", businessName: "Beta" }, isLoading: false, isError: false, error: null };
    }
    if (key === "businesses") {
      if (fixture.state === "error") {
        return { data: undefined, isLoading: false, isError: true, error: new Error("NETWORK_ERROR"), refetch: vi.fn() };
      }
      const items = fixture.state === "one"
        ? [{ businessId: "b2", name: "Beta", role: "manager", active: true }]
        : [
            { businessId: "b1", name: "Alpha", role: "cashier", active: false },
            { businessId: "b2", name: "Beta", role: "manager", active: true },
          ];
      return { data: { items }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, error: null };
  },
}));

import BusinessesPage from "./page";

Object.assign(globalThis, { React });

describe("business workspaces page", () => {
  beforeEach(() => {
    fixture.state = "two";
  });

  it("marks the workspace in use and offers no switch for it", () => {
    const html = renderToStaticMarkup(<BusinessesPage />);
    expect(html).toContain("Current workspace");
    expect(html).not.toContain('data-ui="switch-b2"');
  });

  it("offers a switch for every other workspace with its own role", () => {
    const html = renderToStaticMarkup(<BusinessesPage />);
    expect(html).toContain('data-ui="switch-b1"');
    expect(html).toContain("cashier");
  });

  it("says plainly when there is nothing to switch between", () => {
    fixture.state = "one";
    const html = renderToStaticMarkup(<BusinessesPage />);
    expect(html).toContain("only business");
    expect(html).not.toContain("data-ui=\"switch-");
  });

  it("does not present a failed list as an account with no businesses", () => {
    fixture.state = "error";
    const html = renderToStaticMarkup(<BusinessesPage />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Retry");
    expect(html).not.toContain("only business");
  });
});
