import { describe, expect, it } from "vitest";
import { registerCreateSchema, cashInputSchema, closeShiftSchema } from "../src/shifts.schema";

describe("phase5 shift schemas", () => {
  it("rejects empty register name", () => {
    expect(() => registerCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects negative opening float", () => {
    expect(() => registerCreateSchema.parse({ name: "R1" })).not.toThrow();
    expect(() => closeShiftSchema.parse({ countedCashMinor: -5 })).toThrow();
  });
  it("rejects zero cash amount", () => {
    expect(() =>
      cashInputSchema.parse({ kind: "cash_deposit", amountMinor: 0, reason: "bank run" }),
    ).toThrow();
  });
  it("rejects unknown cash kind", () => {
    expect(() =>
      cashInputSchema.parse({ kind: "lottery", amountMinor: 100, reason: "xxx" }),
    ).toThrow();
  });
  it("accepts a paid_out with reason", () => {
    const out = cashInputSchema.parse({ kind: "paid_out", amountMinor: 500, reason: "ice delivery" });
    expect(out.kind).toBe("paid_out");
  });
});
