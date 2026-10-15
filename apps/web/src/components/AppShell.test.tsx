import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "../lib/api";
import { AppShell } from "./AppShell";

vi.stubGlobal("React", React);

const fixture = vi.hoisted(() => ({ error: new Error("uninitialized") as Error, data: undefined as undefined | { role: string; onboardingRequired: boolean } }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/team",
  useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: fixture.data, isLoading: false, isError: true, error: fixture.error }),
  useQueryClient: () => ({}),
}));

describe("workspace access failures", () => {
  beforeEach(() => { fixture.data = undefined; });
  it.each([401, 403])("does not render protected children or an owner shell after an access-denied response (%s)", (status) => {
    fixture.error = new ApiError("TENANT_REQUIRED", "Sign in required", "", status);
    const html = renderToStaticMarkup(<AppShell><p>Protected team content</p></AppShell>);
    expect(html).not.toContain("Protected team content");
    expect(html).not.toContain("Workspace navigation");
    expect(html).not.toContain("All branches");
  });

  it.each([401, 403])("denies access even with a cached owner identity (%s)", (status) => {
    fixture.data = { role: "owner", onboardingRequired: false };
    fixture.error = new ApiError("TENANT_REQUIRED", "Sign in required", "", status);
    const html = renderToStaticMarkup(<AppShell><p>Protected team content</p></AppShell>);
    expect(html).not.toContain("Protected team content");
    expect(html).not.toContain("Workspace navigation");
  });

  it("preserves cached workspace content on transport failure", () => {
    fixture.data = { role: "cashier", onboardingRequired: false };
    fixture.error = new ApiError("NETWORK_TIMEOUT", "Timed out", "", 0);
    const html = renderToStaticMarkup(<AppShell><p>Cached workspace content</p></AppShell>);
    expect(html).toContain("Cached workspace content");
  });

  it("shows a bounded reconnect card instead of children when identity is unavailable", () => {
    fixture.data = undefined;
    fixture.error = new ApiError("NETWORK_TIMEOUT", "Timed out", "", 0);
    const html = renderToStaticMarkup(<AppShell><p>Protected content</p></AppShell>);
    expect(html).toContain("Connecting to your workspace");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Protected content");
    expect(html).not.toContain("Workspace navigation");
    expect(html).not.toContain("All branches");
  });

  it("treats a 503 identity response as transient, not a sign-out", () => {
    fixture.data = undefined;
    fixture.error = new ApiError("UNAVAILABLE", "Server woke slowly", "", 503);
    const html = renderToStaticMarkup(<AppShell><p>Protected content</p></AppShell>);
    expect(html).toContain("Connecting to your workspace");
    expect(html).not.toContain("Protected content");
  });

  it("preserves the existing cold offline POS rendering path", () => {
    fixture.error = new ApiError("NETWORK_ERROR", "Offline", "", 0);
    const html = renderToStaticMarkup(<AppShell posMode offline><p>Cached POS content</p></AppShell>);
    expect(html).toContain("Cached POS content");
  });

  it("keeps the workspace header compact on mobile while showing the full logo on desktop", () => {
    fixture.data = { role: "cashier", onboardingRequired: false };
    fixture.error = new ApiError("NETWORK_TIMEOUT", "Timed out", "", 0);
    const html = renderToStaticMarkup(<AppShell><p>Cached workspace content</p></AppShell>);
    expect(html).toContain('class="hidden sm:block"');
    expect(html).toContain('class="sm:hidden"');
    expect(html).toContain('src="/brand/nexpos-logo.svg"');
    expect(html).toContain('src="/brand/nexpos-mark.svg"');
  });

  it("uses a compact V4 mobile role header with an accessible navigation disclosure", () => {
    fixture.data = { role: "owner", onboardingRequired: false };
    fixture.error = new ApiError("NETWORK_TIMEOUT", "Timed out", "", 0);
    const html = renderToStaticMarkup(<AppShell atlasOwner role="owner"><p>Owner workspace</p></AppShell>);
    expect(html).toContain('data-ui="atlas-mobile-header"');
    expect(html).toContain('aria-label="Open workspace menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="atlas-mobile-navigation"');
    expect(html).toContain('id="atlas-mobile-navigation"');
    expect(html).toContain('class="hidden xl:hidden');
    expect(html).toMatch(/uppercase[^"]*">owner<\/span>/);
  });

  it("uses one redirect when signing out", () => {
    const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
    expect(source).toContain('router.replace("/login");');
    expect(source).not.toContain('router.refresh();');
  });
});
