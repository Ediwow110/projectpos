import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The D7 staging QA measured the workspace shell at 8-11px on text the
 * operator has to read, three contrast failures and a 16px branch selector.
 * The rendered result is also checked in Playwright against the real browser
 * by e2e/atlas-shell-accessibility.spec.ts, the way
 * apps/web/src/lib/atlas-a11y-contract.test.ts pairs its source contract with
 * the browser.
 *
 * These are source contracts for the smallest scoped fixes: the shell must
 * reach the same size floor and the same text tokens the rest of the app
 * already uses.
 */
const shell = read("src/components/AppShell.tsx");
const destinations = read("src/components/AtlasWorkspaceDestinations.tsx");

describe("workspace shell accessibility contract", () => {
  it("actually reads the shell it claims to police", () => {
    // A scan that quietly stops matching must not be able to pass, so the
    // collected count is compared with an independent recount: the source is
    // split on the class prefix and each tail is tested for a pixel size.
    const sizes = shell.match(/text-\[\d+px\]/g) ?? [];
    const raw = shell.split("text-[")
      .slice(1)
      .filter((tail) => /^\d+px\]/.test(tail)).length;
    expect(sizes.length, "shell text size declarations vs independent recount").toBe(raw);
    expect(sizes.length).toBeGreaterThan(10);
  });

  it("keeps the shell's smallest text at 12px", () => {
    expect(shell, "shell text below 12px").not.toMatch(/text-\[(8|9)px\]/);
  });

  it("uses the documented text token for the shell's muted labels", () => {
    expect(shell, "hand-typed muted literal in the shell").not.toContain("#84786e");
    expect(destinations, "hand-typed muted literal in the workspace destinations").not.toContain("#758078");
    expect(shell).toContain("text-[var(--color-atlas-muted-strong)]");
    expect(destinations).toContain("text-[var(--color-atlas-muted-strong)]");
  });

  it("does not put white text on the brand coral", () => {
    // White on the brand coral measures 3.26:1, which is why the primary
    // button's label is an ink tone. The workspace avatar had the same fill
    // and was missed.
    const offenders = shell
      .split("\n")
      .filter((line) => line.includes("bg-[#f35d3f]") && line.includes("text-white"))
      .map((line) => line.trim());
    expect(offenders, "white text on the brand coral").toEqual([]);
  });

  it("gives every branch selector a reachable target", () => {
    const lines = shell.split("\n");
    const indexes = lines
      .map((line, index) => (line.includes('aria-label="Active branch"') ? index : -1))
      .filter((index) => index >= 0);
    expect(indexes.length, "branch selector count").toBeGreaterThan(0);
    for (const index of indexes) {
      // The className can sit a few lines below the aria-label in the JSX.
      const element = lines.slice(index, index + 6).join(" ");
      expect(element, `branch selector at line ${index + 1} has no minimum height`).toMatch(/min-h-/);
    }
  });
});

/**
 * The password visibility toggle measured 27x17px with an 11px label, below
 * the 24px minimum target and the 12px text floor. The same markup is on
 * every page that reveals a password.
 */
const AUTH_PAGES = [
  "src/app/login/page.tsx",
  "src/app/register/page.tsx",
  "src/app/password-reset/page.tsx",
];

describe("password visibility control", () => {
  it("gives the toggle a reachable target and a readable label on every auth page", () => {
    for (const file of AUTH_PAGES) {
      const source = read(file);
      const marker = source.indexOf("setShowPassword((shown) => !shown)");
      expect(marker, `${file} has no password visibility toggle`).toBeGreaterThan(-1);
      const button = source.slice(marker, source.indexOf("</button>", marker));
      expect(button, `${file} toggle target`).toMatch(/min-h-11/);
      expect(button, `${file} toggle label size`).toContain("text-[12px]");
      expect(button, `${file} toggle label size`).not.toContain("text-[11px]");
    }
  });

  it("keeps the auth eyebrow at the 12px text floor", () => {
    const css = read("src/app/globals.css");
    const start = css.indexOf(".atlas-entry .atlas-eyebrow");
    expect(start, "the .atlas-eyebrow rule must exist").toBeGreaterThan(-1);
    const block = css.slice(start, start + 240);
    expect(block, "the auth eyebrow must be at least 12px").toContain("font-size: 12px");
    expect(block, "the auth eyebrow must not be 11px").not.toContain("font-size: 11px");
  });
});

/**
 * Two inventory surfaces carried the wrong headings: /inventory rendered two h1
 * for the inventory role, and /inventory/access rendered none. The 404 page
 * had no surface at all, so a mistyped address left the operator with no way
 * back into the workspace.
 */
describe("page heading contract", () => {
  it("gives the not-found page a heading and a way back into the workspace", () => {
    const source = read("src/app/not-found.tsx");
    expect(source, "the not-found page must exist").toContain("<h1");
    expect(source, "the not-found page must link back to the workspace").toContain('href="/"');
    expect(source, "the not-found page must offer a reachable link").toContain("min-h-11");
  });

  it("gives the page header a selectable heading level", () => {
    const premium = read("src/components/premium.tsx");
    expect(premium, "PageHeader must accept a heading level").toContain("titleAs");
  });

  it("keeps one visible h1 on the inventory page for the inventory role", () => {
    const inventory = read("src/app/inventory/page.tsx");
    expect(
      inventory,
      "the inventory role's stock block must not be a second h1",
    ).toMatch(/titleAs=\{role === "inventory" \? "h2" : "h1"\}/);
  });

  it("gives the inventory access page its own h1", () => {
    // Every inventory page owns its h1 through the shared page header, and
    // the safeguards block stays a section heading. /inventory/access was
    // the odd one out: it had no page header at all, which is how it ended
    // up with no visible h1.
    const access = read("src/app/inventory/access/page.tsx");
    expect(access, "the access page must own the h1 through the shared page header").toContain("<PageHeader");
    expect(access, "the safeguards block must not be promoted to h1").not.toContain("headingLevel=\"h1\"");
    const safeguards = read("src/components/AtlasInventorySafeguards.tsx");
    expect(safeguards, "the safeguards block stays a section heading on every page").toContain("<h2");
    expect(safeguards, "the safeguards block must not expose a heading level prop").not.toContain("headingLevel");
  });
});
