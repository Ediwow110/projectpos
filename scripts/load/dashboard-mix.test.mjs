import { describe, expect, it } from "vitest";
import { numberOption, operationVerdict } from "./dashboard-mix.mjs";

describe("dashboard load gate", () => {
  it("keeps a valueless flag from collapsing the run to zero workers", () => {
    // `--concurrency` with no value parses to "", and Number("") is 0: every
    // percentile then came back 0, each budget printed PASS, and the gate
    // exited 0 having measured nothing. Same guard shape as phase21-mix.mjs.
    for (const raw of ["", undefined, null, "abc", "0", "-4", "NaN", "Infinity"]) {
      expect(numberOption(raw, 5)).toBe(5);
    }
    expect(numberOption("50", 5)).toBe(50);
    expect(numberOption("2.5", 5)).toBe(2.5);
  });

  it("never reports PASS for an operation it did not sample", () => {
    expect(operationVerdict(0, 0, 200)).toBe("NO_SAMPLE");
    expect(operationVerdict(12, 180, 200)).toBe("PASS");
    expect(operationVerdict(12, 201, 200)).toBe("BREACH");
  });
});
