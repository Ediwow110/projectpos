import { describe, expect, it } from "vitest";

import { formatMoneyMinor, formatPesoMinor, minorToMajorFixed, pesosInputToMinor } from "./money";

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

  it("reads a signed pesos entry as whole centavos", () => {
    expect(pesosInputToMinor("-45.30")).toBe(-4530);
    expect(pesosInputToMinor(" 12 ")).toBe(1200);
    expect(pesosInputToMinor("0")).toBe(0);
  });

  it("refuses entries the ledger cannot hold", () => {
    expect(pesosInputToMinor("1.005")).toBeNull();
    expect(pesosInputToMinor("abc")).toBeNull();
    expect(pesosInputToMinor("")).toBeNull();
  });
});
