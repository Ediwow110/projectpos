import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canPresentPayAction, paymentPresentation, productInitials, saleFromCompleteResponse } from "./pos-view";

describe("POS presentation safety", () => {
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
    const source = readFileSync(resolve(process.cwd(), "src/app/pos/page.tsx"), "utf8");
    expect(source).toContain("lg:max-xl:flex");
    expect(source).toContain("Tablet cart");
  });

  it("builds compact two-character initials for product tiles", () => {
    expect(productInitials("Iced Latte")).toBe("IL");
    expect(productInitials("Fresh Milk")).toBe("FM");
    expect(productInitials("Cola")).toBe("CO");
    expect(productInitials("  ")).toBe("?");
  });
});
