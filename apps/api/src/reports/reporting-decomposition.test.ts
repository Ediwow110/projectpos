import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("src/reports/nest/reporting.service.ts", "utf8");

describe("reporting service decomposition", () => {
  it("delegates dimension-heavy reports to a focused breakdown service", () => {
    expect(source).toContain("ReportingBreakdownService");
    expect(source).toContain("this.breakdowns = new ReportingBreakdownService");
    expect(source).toContain("return this.breakdowns.getProductsReport");
    expect(source).toContain("return this.breakdowns.getInventoryReport");
    expect(source).toContain("return this.breakdowns.getBranchesReport");
    expect(source).toContain("return this.breakdowns.getCustomersReport");
    expect(source).toContain("return this.breakdowns.getCashiersReport");
  });
});
