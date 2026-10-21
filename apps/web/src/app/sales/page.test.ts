import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/sales/page.tsx"), "utf8");

describe("sales page export", () => {
  it("gates the CSV on the export grant the endpoint checks, not on a role list", () => {
    expect(pageSource).toContain("canExport");
    expect(pageSource).not.toContain('role === "owner" || role === "manager" || role === "inventory"');
  });

  it("downloads the filtered CSV without throwing the reviewer off the page", () => {
    expect(pageSource).toContain("salesExportUrl");
    expect(pageSource).toContain("revokeObjectURL");
    expect(pageSource).not.toContain("window.location.href");
  });

  it("surfaces a failed export instead of silently navigating", () => {
    expect(pageSource).toMatch(/catch[\s\S]{0,200}setError\(errorText/);
  });
});
