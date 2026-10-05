import { describe, expect, it } from "vitest";

import {
  formatMajorCurrency,
  majorToMinor,
  validateLoyaltySettings,
  type LoyaltySettingsForm,
} from "./loyalty-settings";

const valid: LoyaltySettingsForm = {
  enabled: true,
  earnAmount: "1.00",
  earnPoints: "1",
  redeemPoints: "10",
  redeemValue: "1.00",
  minimumRedeemPoints: "10",
};

describe("loyalty settings form helpers", () => {
  it("converts major currency input to integer minor units without floating-point drift", () => {
    expect(majorToMinor("1.00")).toBe(100);
    expect(majorToMinor("0.1")).toBe(10);
    expect(majorToMinor("12.345")).toBeNull();
  });

  it("formats minor units for ordinary currency-friendly display", () => {
    expect(formatMajorCurrency(100)).toBe("₱1.00");
    expect(formatMajorCurrency(1250)).toBe("₱12.50");
  });

  it("rejects invalid earn and redeem values while accepting optional minimum points", () => {
    expect(validateLoyaltySettings(valid)).toEqual({});
    expect(validateLoyaltySettings({ ...valid, earnAmount: "0" }).earnAmount).toBeTruthy();
    expect(validateLoyaltySettings({ ...valid, minimumRedeemPoints: "" })).toEqual({});
    expect(validateLoyaltySettings({ ...valid, minimumRedeemPoints: "-1" }).minimumRedeemPoints).toBeTruthy();
  });
});
