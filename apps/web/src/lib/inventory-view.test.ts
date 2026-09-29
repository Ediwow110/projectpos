import { describe, expect, it } from "vitest";

import { inventoryStatus, optionalMoney } from "./inventory-view";
import { buildBalancesSearch } from "./inventory";

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

  it("includes the active branch in balance queries", () => {
    expect(buildBalancesSearch({ view: "all", page: 1, pageSize: 20, branchId: "branch-1" }))
      .toContain("branchId=branch-1");
  });
});
