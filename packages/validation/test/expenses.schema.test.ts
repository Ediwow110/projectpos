import { describe, expect, it } from "vitest";
import { expenseCreateSchema } from "../src/expenses.schema";

describe("phase6 expense schemas", () => {
  it("rejects empty category", () => {
    expect(() => expenseCreateSchema.parse({ category: "", amountMinor: 100, method: "cash" })).toThrow();
  });
  it("rejects zero amount", () => {
    expect(() => expenseCreateSchema.parse({ category: "Ice", amountMinor: 0, method: "cash" })).toThrow();
  });
  it("rejects unknown method", () => {
    expect(() => expenseCreateSchema.parse({ category: "Ice", amountMinor: 100, method: "barter" })).toThrow();
  });
  it("rejects bad attachment url", () => {
    expect(() =>
      expenseCreateSchema.parse({ category: "Ice", amountMinor: 100, method: "cash", attachmentUrl: "not-a-url" }),
    ).toThrow();
  });
  it("accepts a minimal cash expense", () => {
    expect(expenseCreateSchema.parse({ category: "Ice", amountMinor: 500, method: "cash" }).method).toBe("cash");
  });
});
