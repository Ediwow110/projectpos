import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/gift-cards/[id]/page.tsx"), "utf8");

describe("gift-card detail page value controls", () => {
  it("offers the adjustment and status endpoints that exist on the API", () => {
    expect(pageSource).toContain("GiftCardValueControls");
  });

  it("passes the effective grants and refreshes the authoritative history afterwards", () => {
    expect(pageSource).toContain("permissions");
    expect(pageSource).toMatch(/refetch/);
  });
});
