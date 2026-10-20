import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * Phase 7A owner-acceptance findings. These are source contracts for the
 * smallest scoped fixes; the rendered contrast and hit areas are also checked
 * in Playwright against the real browser.
 */
describe("owner acceptance accessibility contract", () => {
  it("uses a contrast-safe muted token for drawer headings and secondary labels", () => {
    const shell = read("src/components/AppShell.tsx");
    const overview = read("src/components/AtlasOwnerOverview.tsx");

    expect(shell).not.toContain("text-[#a0948b]");
    expect(shell).toContain("text-[var(--color-atlas-muted-strong)]");
    expect(overview).not.toContain("text-[#71807a]");
    expect(overview).toContain("text-[var(--color-atlas-muted-strong)]");
  });

  it("uses the text-safe accent for the shared page eyebrow", () => {
    const premium = read("src/components/premium.tsx");
    const pageHeader = premium.slice(
      premium.indexOf("export function PageHeader"),
      premium.indexOf("export function MetricCard"),
    );

    expect(pageHeader).not.toContain("text-[#f35d3f]");
    expect(pageHeader).toContain("text-[var(--color-atlas-accent-strong)]");
  });

  it("gives standalone readiness and dashboard links a 44px hit area", () => {
    const overview = read("src/components/AtlasOwnerOverview.tsx");
    const onboarding = read("src/app/onboarding/page.tsx");

    expect(overview).toMatch(/href=\{check\.href\}[\s\S]*?min-h-11/);
    expect(onboarding).toMatch(/href="\/"[\s\S]*?min-h-11/);
  });

  it("routes a completed owner's setup brand home without changing the sign-in entry", () => {
    const brand = read("src/components/AtlasEntryBrand.tsx");
    const onboarding = read("src/app/onboarding/page.tsx");

    expect(brand).toContain("href?: string");
    expect(onboarding).toContain('href={requiredDone ? "/" : "/login"}');
  });
});
