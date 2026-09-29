import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canPresentPayAction, paymentPresentation, productInitials, productTileClass, saleFromCompleteResponse } from "./pos-view";
import { registersForBranch } from "./workspace-branch";

describe("POS presentation safety", () => {
  it("limits register choices to the active branch while All branches shows every register", () => {
    const registers = [
      { id: "r1", name: "North till", isActive: true, branchId: "north" },
      { id: "r2", name: "South till", isActive: true, branchId: "south" },
      { id: "r3", name: "Unassigned", isActive: true, branchId: null },
    ];
    expect(registersForBranch(registers, "north").map((item) => item.id)).toEqual(["r1"]);
    expect(registersForBranch(registers, null).map((item) => item.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("never presents PAYMENT_UNKNOWN as success", () => {
    expect(paymentPresentation("Payment status unknown. Do not retry blindly.")).toEqual({
      tone: "warn",
      state: "unknown",
    });
  });

  it("keeps queued offline sales visibly provisional", () => {
    expect(paymentPresentation("Sale queued offline. Provisional receipt POS-123 — pending sync, not yet final.")).toEqual({
      tone: "info",
      state: "pending",
    });
  });

  it("uses success only for a completed sale", () => {
    expect(paymentPresentation("Sale completed.")).toEqual({ tone: "ok", state: "completed" });
  });

  it("disables the pay action for an empty cart or an unauthorized role", () => {
    expect(canPresentPayAction(0, true)).toBe(false);
    expect(canPresentPayAction(2, false)).toBe(false);
    expect(canPresentPayAction(2, true)).toBe(true);
  });

  it("unwraps PAYMENT_UNKNOWN completion envelopes without losing the real sale status", () => {
    expect(
      saleFromCompleteResponse({
        code: "PAYMENT_UNKNOWN",
        message: "Payment status unknown",
        sale: {
          id: "sale-1",
          status: "PAYMENT_UNKNOWN",
          payments: [{ id: "pay-1" }],
        },
      }),
    ).toEqual({
      id: "sale-1",
      status: "PAYMENT_UNKNOWN",
      payments: [{ id: "pay-1" }],
    });
  });

  it("keeps a compact persistent cart action surface for 1024px tablet POS", () => {
    const productSource = readFileSync(resolve(process.cwd(), "src/components/PosProductCatalog.tsx"), "utf8");
    const responsiveCartSource = readFileSync(resolve(process.cwd(), "src/components/PosResponsiveCart.tsx"), "utf8");
    expect(productSource).toContain("lg:max-xl:flex");
    expect(responsiveCartSource).toContain("Tablet cart");
  });

  it("builds compact two-character initials for product tiles", () => {
    expect(productInitials("Iced Latte")).toBe("IL");
    expect(productInitials("Fresh Milk")).toBe("FM");
    expect(productInitials("Cola")).toBe("CO");
    expect(productInitials("  ")).toBe("?");
  });

  it("keeps product tile colors deterministic", () => {
    expect(productTileClass("Coffee")).toBe(productTileClass("Coffee"));
    expect(productTileClass("Coffee")).toMatch(/^bg-\[#/);
  });
});
