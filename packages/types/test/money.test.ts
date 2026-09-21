import { describe, expect, it } from "vitest";
import { addMoney, subtractMoney } from "../src/money";

describe("money minor units PLAN 6.2", () => {
  it("adds integer centavos", () => {
    expect(addMoney(10050 as any, 250 as any)).toBe(10300);
  });
  it("rejects float input", () => {
    expect(() => addMoney(10.5 as any, 5 as any)).toThrow();
  });
  it("subtracts centavos", () => {
    expect(subtractMoney(1000 as any, 400 as any)).toBe(600);
  });
});
