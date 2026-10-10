import { describe, expect, it } from "vitest";
import { accountingBackfillIssueResolutionSchema } from "../src/accounting.schema";

describe("accounting backfill issue resolution", () => {
  it("accepts inventory cost and evidence-based stored-value resolutions", () => {
    expect(accountingBackfillIssueResolutionSchema.safeParse({ evidence: "Invoice INV-42", unitCostMinor: 250 }).success).toBe(true);
    expect(accountingBackfillIssueResolutionSchema.safeParse({
      evidence: "Archived ledger page 12",
      storedValueAdjustments: [{ sourceType: "LoyaltyTransaction", sourceId: "legacy-loyalty", counterAccountCode: "6000", amountMinor: 125 }],
    }).success).toBe(true);
  });

  it("rejects empty or mixed resolution modes", () => {
    expect(accountingBackfillIssueResolutionSchema.safeParse({ evidence: "Source evidence is present" }).success).toBe(false);
    expect(accountingBackfillIssueResolutionSchema.safeParse({
      evidence: "Source evidence is present",
      unitCostMinor: 250,
      storedValueAdjustments: [{ sourceType: "GiftCardTransaction", sourceId: "legacy-gift", counterAccountCode: "6000" }],
    }).success).toBe(false);
  });
});
