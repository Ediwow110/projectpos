import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { AppShell } from "./AppShell";

const fixture = vi.hoisted(() => ({ error: new Error("uninitialized") as Error }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/team",
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: true, error: fixture.error }),
  useQueryClient: () => ({}),
}));

describe("workspace access failures", () => {
  it.each([401, 403])("does not render protected children or an owner shell after an access-denied response (%s)", (status) => {
    fixture.error = new ApiError("TENANT_REQUIRED", "Sign in required", "", status);
    const html = renderToStaticMarkup(<AppShell><p>Protected team content</p></AppShell>);
    expect(html).not.toContain("Protected team content");
    expect(html).not.toContain("Workspace navigation");
    expect(html).not.toContain("All branches");
  });

  it("does not render protected children when the workspace API is unavailable", () => {
    fixture.error = new ApiError("NETWORK_TIMEOUT", "Timed out", "", 0);
    const html = renderToStaticMarkup(<AppShell><p>Protected team content</p></AppShell>);
    expect(html).not.toContain("Protected team content");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
  });
});
