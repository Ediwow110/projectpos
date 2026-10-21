import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/shifts/[id]/page.tsx"), "utf8");

describe("shift detail page corrections wiring", () => {
  it("reads the corrections the shift report already returns instead of dropping them", () => {
    expect(pageSource).toContain("corrections");
    expect(pageSource).toContain("correctedExpectedCash");
    expect(pageSource).toContain("ShiftCorrectionsPanel");
  });

  it("gates the correction form on the effective permission rather than a role guess", () => {
    expect(pageSource).toContain("permissions");
    expect(pageSource).not.toMatch(/role === "owner"\s*\|\|\s*role === "manager"[^\n]*correction/i);
  });

  it("refreshes the authoritative report after a correction is recorded", () => {
    expect(pageSource).toMatch(/refetch/);
  });
});
