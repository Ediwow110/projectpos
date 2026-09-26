import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("pre-auth privacy presentation", () => {
  it("keeps the login landing page free of business metrics and identities", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");

    expect(source).toContain("Run the business.");
    expect(source).toContain("Keep the business private.");
    expect(source).toContain("Your operational data stays behind secure sign-in.");
    expect(source).not.toMatch(/₱\s*\d/);
    expect(source).not.toContain("Mabuhay Market");
    expect(source).not.toContain("owner@mabuhaymarket.ph");
    expect(source).not.toContain("cash variance");
  });
});
