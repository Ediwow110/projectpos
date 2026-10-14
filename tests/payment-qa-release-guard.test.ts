import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptsDir = join(__dirname, "../scripts");

describe("payment QA release guard", () => {
  it("excludes the unsafe arbitrary-checkout payment helper", () => {
    expect(readdirSync(scriptsDir)).not.toContain("qa22-prepaid-pay.mjs");
  });

  it("does not import Playwright from a developer-specific filesystem path", () => {
    for (const file of readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs"))) {
      const source = readFileSync(join(scriptsDir, file), "utf8");
      expect(/file:\/\/\/[A-Za-z]:\/Users\//i.test(source), file).toBe(false);
    }
  });
});
