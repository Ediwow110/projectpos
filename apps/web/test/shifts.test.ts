import { describe, expect, it } from "vitest";

describe("phase5 shift web helpers", () => {
  it("formats minor units as pesos", async () => {
    const { money } = await import("../src/lib/shifts");
    expect(money(13800)).toBe("138.00");
  });
  it("gates register management by role", async () => {
    const { canManageRegisters } = await import("../src/lib/shifts");
    expect(canManageRegisters("manager")).toBe(true);
    expect(canManageRegisters("cashier")).toBe(false);
  });
  it("labels variance explicitly", async () => {
    const { varianceLabel } = await import("../src/lib/shifts");
    expect(varianceLabel(200)).toBe("OVER 2.00");
    expect(varianceLabel(-100)).toBe("SHORT 1.00");
    expect(varianceLabel(0)).toBe("BALANCED");
  });
});
