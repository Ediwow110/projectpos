import { describe, expect, it } from "vitest";

import { inventoryStatus, optionalMoney } from "./inventory-view";

describe("inventory presentation", () => {
  it("classifies stock without hiding out-of-stock behind low-stock", () => {
    expect(inventoryStatus(0, 8)).toBe("out");
    expect(inventoryStatus(4, 8)).toBe("low");
    expect(inventoryStatus(8, 8)).toBe("low");
    expect(inventoryStatus(9, 8)).toBe("healthy");
  });

  it("keeps missing cost unavailable instead of inventing zero", () => {
    expect(optionalMoney(undefined)).toBeNull();
    expect(optionalMoney(null)).toBeNull();
    expect(optionalMoney(0)).toBe("₱0.00");
  });
});
