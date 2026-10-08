import { describe, expect, it } from "vitest";

import { formatMoneyMinor, formatPesoMinor, minorToMajorFixed } from "./money";

describe("money helpers", () => {
  it("formats minor units with the existing en-PH two-decimal presentation", () => {
    expect(formatMoneyMinor(123456)).toBe("1,234.56");
    expect(formatMoneyMinor(-123456)).toBe("-1,234.56");
    expect(formatMoneyMinor(0)).toBe("0.00");
  });

  it("adds the peso symbol without changing the numeric presentation", () => {
    expect(formatPesoMinor(123456)).toBe("₱1,234.56");
  });

  it("produces the existing fixed two-decimal major-unit string for inputs and compact labels", () => {
    expect(minorToMajorFixed(1050)).toBe("10.50");
    expect(minorToMajorFixed(-125)).toBe("-1.25");
  });
});
