import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync("src/billing/nest/billing.service.ts", "utf8");

describe("billing service decomposition", () => {
  it("delegates entitlement and usage concerns to a focused service", () => {
    expect(source).toContain("BillingEntitlementService");
    expect(source).toContain("this.entitlements = new BillingEntitlementService");
    expect(source).toContain("return this.entitlements.requireCreate");
    expect(source).toContain("return this.entitlements.withCap");
    expect(source).toContain("return this.entitlements.checkFeature");
    expect(source).toContain("return this.entitlements.withCapBatch");
    expect(source).toContain("return this.entitlements.requireFeature");
    expect(source).toContain("return this.entitlements.recordUsage");
    expect(source).toContain("return this.entitlements.rebuildCounters");
    expect(source).toContain("return this.entitlements.usageSummary");
  });

  it("delegates invoice lifecycle to a focused service", () => {
    expect(source).toContain("BillingInvoiceService");
    expect(source).toContain("this.invoices = new BillingInvoiceService");
    expect(source).toContain("return this.invoices.listInvoices");
    expect(source).toContain("return this.invoices.rolloverIfDue");
    expect(source).toContain("return this.invoices.issueInvoice");
  });
});
