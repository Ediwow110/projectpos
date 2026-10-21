import { describe, expect, it } from "vitest";

describe("shift correction entry", () => {
  it("requires the shift.close.override grant and a closed shift", async () => {
    const { canRecordCorrection } = await import("./shift-corrections");
    expect(canRecordCorrection(["shift.close.override"], "CLOSED")).toBe(true);
    expect(canRecordCorrection([], "CLOSED")).toBe(false);
    expect(canRecordCorrection(["shift.close.override"], "OPEN")).toBe(false);
  });

  it("rejects a zero correction because it cannot change variance", async () => {
    const { parseCorrection } = await import("./shift-corrections");
    expect(parseCorrection("0", "Till audit found float short")).toEqual({ fieldError: "Enter a non-zero amount." });
  });

  it("rejects sub-cent amounts that the ledger cannot hold", async () => {
    const { parseCorrection } = await import("./shift-corrections");
    expect(parseCorrection("1.005", "Till audit variance")).toEqual({ fieldError: "Amounts are in whole centavos." });
  });

  it("keeps the signed direction of a correction", async () => {
    const { parseCorrection } = await import("./shift-corrections");
    expect(parseCorrection("-45.30", "Till audit variance")).toEqual({
      ok: { amountMinor: -4530, reason: "Till audit variance" },
    });
  });

  it("requires an auditable reason of at least three characters", async () => {
    const { parseCorrection } = await import("./shift-corrections");
    expect(parseCorrection("12", "ab")).toEqual({ fieldError: "Reason must be 3 to 200 characters." });
    expect(parseCorrection("12", "x".repeat(201))).toEqual({ fieldError: "Reason must be 3 to 200 characters." });
  });

  it("refuses a reason that is only whitespace", async () => {
    const { parseCorrection } = await import("./shift-corrections");
    expect(parseCorrection("12", "   ")).toEqual({ fieldError: "Reason must be 3 to 200 characters." });
  });
});
