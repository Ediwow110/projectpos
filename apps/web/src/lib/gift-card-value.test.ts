import { describe, expect, it } from "vitest";

describe("gift-card value controls", () => {
  it("refuses a zero adjustment", async () => {
    const { parseGiftCardAdjust } = await import("./gift-card-value");
    expect(parseGiftCardAdjust("0", "Customer service correction")).toEqual({ fieldError: "Enter a non-zero amount." });
  });

  it("turns a pesos entry into the minor units the ledger stores", async () => {
    const { parseGiftCardAdjust } = await import("./gift-card-value");
    expect(parseGiftCardAdjust("-25.50", "Refunded to card after dispute")).toEqual({
      ok: { amountMinor: -2550, reason: "Refunded to card after dispute" },
    });
  });

  it("rejects amounts finer than a centavo", async () => {
    const { parseGiftCardAdjust } = await import("./gift-card-value");
    expect(parseGiftCardAdjust("1.005", "Customer service correction")).toEqual({ fieldError: "Amounts are in whole centavos." });
  });

  it("requires a reason the audit can read", async () => {
    const { parseGiftCardAdjust } = await import("./gift-card-value");
    expect(parseGiftCardAdjust("10", "no")).toEqual({ fieldError: "Reason must be 3 to 500 characters." });
    expect(parseGiftCardAdjust("10", "x".repeat(501))).toEqual({ fieldError: "Reason must be 3 to 500 characters." });
  });

  it("knows who may apply a value change without a manager", async () => {
    const { canApplyValueAdjustment } = await import("./gift-card-value");
    expect(canApplyValueAdjustment(["stored_value.adjust"])).toBe(true);
    expect(canApplyValueAdjustment(["gift_card.manage"])).toBe(false);
  });

  it("toggles the card status to the one the reviewer did not pick", async () => {
    const { nextCardStatus } = await import("./gift-card-value");
    expect(nextCardStatus("ACTIVE")).toBe("SUSPENDED");
    expect(nextCardStatus("SUSPENDED")).toBe("ACTIVE");
  });
});
