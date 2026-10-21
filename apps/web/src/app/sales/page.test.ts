import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/sales/page.tsx"), "utf8");

describe("sales page export gate", () => {
  it("gates the CSV on the export grant the endpoint checks, not on a role list", () => {
    expect(pageSource).toContain("canExport");
    expect(pageSource).not.toContain('role === "owner" || role === "manager" || role === "inventory"');
  });
});
