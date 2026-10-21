import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { tagPosSaleAttempt, type PosCheckoutFailure } from "../../lib/pos-checkout-feedback";
import { MemorySyncStore } from "../../lib/sync-store";
import { queueOfflinePosSale } from "../../lib/pos-operations";
import {
  runPosCheckout,
  runPosOfflineCheckout,
  type PosCheckoutInput,
  type PosCheckoutEffects,
} from "./pos-checkout-flow";

const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }];

function input(overrides: Partial<PosCheckoutInput> = {}): PosCheckoutInput {
  return {
    cart, registerId: "register-1", customerId: "", walkIn: "",
    received: "50", due: 5000, orderDiscountMinor: 0, discountTotalMinor: 0,
    method: "cash", internalInstrumentId: "", offline: false,
    identityLoading: false, store: null, activeDraft: null, giftCardLoad: null,
    methodAvailable: () => true, ...overrides,
  };
}

function effects() {
  const statuses: string[] = [];
  const receipts: Array<string | null> = [];
  const confirmations: Array<{ saleId: string; receiptNo?: string; amountMinor: number } | null> = [];
  const reconciles: Array<string | null> = [];
  const reconciliationSales: Array<string | null> = [];
  const giftCards: Array<{ code: string; amountMinor: number }> = [];
  const approvals: Array<["pay" | "hold", boolean]> = [];
  const carts: unknown[] = [];
  const flags: boolean[] = [];
  const failures: Array<PosCheckoutFailure | null> = [];
  const values: PosCheckoutEffects = {
    setStatus: (status) => { statuses.push(status); },
    setCheckoutFailure: (failure) => { failures.push(failure); },
    setReceiptId: (id) => { receipts.push(id); },
    setConfirmedSale: (value) => { confirmations.push(value); },
    setReconcileId: (id) => { reconciles.push(id); },
    setReconcileSaleId: (id) => { reconciliationSales.push(id); },
    setCart: (next) => { carts.push(next); },
    setActiveDraft: () => {},
    setOrderDiscountMinor: () => {},
    setReceived: () => {},
    setShowPay: () => {},
    setGiftCardLoad: () => {},
    setGiftCardResult: (value) => { giftCards.push(value); },
    setPaying: (value) => { flags.push(value); },
    requireManagerApproval: (action, retrying) => { approvals.push([action, retrying]); },
  };
  return { values, statuses, receipts, confirmations, reconciles, reconciliationSales, giftCards, approvals, carts, flags, failures };
}

describe("POS checkout flow", () => {
  it("keeps offline discounted sales blocked and avoids queueing", async () => {
    const state = effects();
    let queued = false;
    await runPosOfflineCheckout(input({
      offline: true, discountTotalMinor: 100, store: new MemorySyncStore(),
    }), state.values, {
      queue: async () => { queued = true; return { provisionalReceipt: "INVALID" }; },
    });
    expect(queued).toBe(false);
    expect(state.statuses.at(-1)).toBe("Reconnect before completing a discounted sale. Discount authorization must be checked by the server.");
    expect(state.receipts).toEqual([null]);
    expect(state.confirmations).toEqual([null]);
    expect(state.reconciles).toEqual([null]);
    expect(state.reconciliationSales).toEqual([null]);
  });

  it("queues offline cash with the same provisional receipt text and clears cart", async () => {
    const state = effects();
    const store = new MemorySyncStore();
    await runPosOfflineCheckout(input({
      offline: true, store,
    }), state.values, {
      queue: (request) => queueOfflinePosSale(request, { uuid: () => "12345678-aaaa-bbbb-cccc-123456789012" }),
    });
    expect((await store.listAll())).toHaveLength(1);
    expect(state.carts).toEqual([[]]);
    expect(state.statuses.at(-1)).toContain("Sale queued offline. Provisional receipt");
    expect(state.statuses.at(-1)).toContain("pending sync, not yet final");
  });

  it("reports a failed offline queue as a failure instead of a success", async () => {
    const state = effects();
    const result = await runPosCheckout(input({
      offline: true, store: new MemorySyncStore(),
    }), state.values, {
      queue: async () => { throw new Error("storage failed"); },
    });
    // Nothing was queued, so the payment must NOT report success. Reporting
    // success would tell the cashier a sale is on its way when the server
    // never received it.
    expect(result).toBe(false);
    expect(state.statuses.at(-1)).toBe("Could not queue the offline sale.");
  });

  it("does not present a final receipt for an offline sale that is only queued", async () => {
    const state = effects();
    const result = await runPosCheckout(input({
      offline: true, store: new MemorySyncStore(),
    }), state.values, {
      queue: async () => ({ provisionalReceipt: "PROV-1" }),
    });

    expect(result).toBe(true);
    // The sale is queued, not completed: no receipt id and no confirmed sale.
    expect(state.receipts.every((value) => value === null)).toBe(true);
    expect(state.confirmations.every((value) => value === null)).toBe(true);
    expect(state.statuses.at(-1)).toMatch(/pending sync, not yet final/i);
  });

  it("redirects hosted payments without marking them as completed", async () => {
    const state = effects();
    const redirects: string[] = [];
    const result = await runPosCheckout(input({ method: "qrph" }), state.values, {
      complete: async () => ({ kind: "redirect", checkoutUrl: "https://checkout.example/123" }),
      redirect: (url) => { redirects.push(url); },
    });
    expect(result).toBe(true);
    expect(redirects).toEqual(["https://checkout.example/123"]);
    expect(state.statuses.at(-1)).toBe("Redirecting to PayMongo secure checkout…");
    expect(state.receipts).toEqual([null]);
    expect(state.confirmations).toEqual([null]);
    expect(state.carts).toEqual([]);
    expect(state.flags).toEqual([true, false]);
  });

  it("does not clear cart on unknown payment and exposes reconciliation IDs", async () => {
    const state = effects();
    const result = await runPosCheckout(input(), state.values, {
      complete: async () => ({ kind: "unknown", saleId: "sale-2", paymentId: "pay-2" }),
    });
    expect(result).toBe(true);
    expect(state.reconciles).toEqual([null, "pay-2"]);
    expect(state.confirmations).toEqual([null]);
    expect(state.reconciliationSales).toEqual([null, "sale-2"]);
    expect(state.statuses.at(-1)).toContain("Do not retry blindly");
    expect(state.carts).toEqual([]);
  });

  it("announces the confirmed sale only after an authoritative completed response", async () => {
    const state = effects();
    const result = await runPosCheckout(input(), state.values, {
      complete: async () => ({ kind: "completed", saleId: "sale-verified", receiptNo: "2026-000123" }),
    });
    expect(result).toBe(true);
    expect(state.confirmations).toEqual([null, { saleId: "sale-verified", receiptNo: "2026-000123", amountMinor: 5000 }]);
    expect(state.receipts).toEqual([null, "sale-verified"]);
  });

  it("reveals a one-time code only after completed NEW gift-card load", async () => {
    const state = effects();
    const result = await runPosCheckout(input({
      giftCardLoad: { kind: "NEW", amountMinor: 1000 },
    }), state.values, {
      complete: async () => ({ kind: "completed", saleId: "sale-3", giftCardCodes: ["SECRET"] }),
    });
    expect(result).toBe(true);
    expect(state.giftCards).toEqual([{ code: "SECRET", amountMinor: 1000 }]);
    expect(state.receipts).toEqual([null, "sale-3"]);
    expect(state.confirmations).toEqual([null, { saleId: "sale-3", amountMinor: 5000 }]);
    expect(state.carts).toEqual([[]]);
    expect(state.statuses.at(-1)).toBe("Sale completed.");
  });

  it("preserves generic payment failure handling without asserting manager approval", async () => {
    const state = effects();
    const result = await runPosCheckout(input({ discountTotalMinor: 100 }), state.values, {
      complete: async () => { throw { code: "FORBIDDEN", message: "Forbidden" }; },
    });
    expect(result).toBe(false);
    expect(state.approvals).toEqual([]);
    expect(state.statuses.at(-1)).toContain("Payment failed");
  });
});

describe("POS checkout failure feedback", () => {
  it("surfaces a stock failure for the open payment dialog and keeps raw codes out of the copy", async () => {
    const state = effects();
    const result = await runPosCheckout(input(), state.values, {
      complete: async () => { throw new ApiError("INSUFFICIENT_STOCK", "Not enough stock.", "corr-9", 409); },
    });

    expect(result).toBe(false);
    const failure = state.failures.at(-1);
    expect(failure?.kind).toBe("stock");
    expect(failure?.retryable).toBe(true);
    expect(failure?.action.kind).toBe("adjust_cart");
    expect(state.statuses.at(-1)).toContain("Not enough stock");
    expect(state.statuses.at(-1)).not.toContain("INSUFFICIENT_STOCK");
    expect(state.flags).toEqual([true, false]);
  });

  it("blocks blind retry and points at the sale when a drop follows the completion request", async () => {
    const state = effects();
    const result = await runPosCheckout(input(), state.values, {
      complete: async () => {
        throw tagPosSaleAttempt(
          new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0),
          { phase: "complete", saleId: "sale-9" },
        );
      },
    });

    expect(result).toBe(false);
    const failure = state.failures.at(-1);
    expect(failure?.kind).toBe("unknown_outcome");
    expect(failure?.retryable).toBe(false);
    expect(failure?.action).toEqual({ kind: "check_sale", label: "Check sale status", href: "/sales/sale-9" });
    expect(state.reconciliationSales.at(-1)).toBe("sale-9");
    expect(state.statuses.at(-1)).toContain("Do not retry payment");
  });

  it("keeps a pre-sale connection failure retryable without pinning a reconciliation sale", async () => {
    const state = effects();
    await runPosCheckout(input(), state.values, {
      complete: async () => { throw new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0); },
    });

    const failure = state.failures.at(-1);
    expect(failure?.kind).toBe("connectivity");
    expect(failure?.retryable).toBe(true);
    expect(state.reconciliationSales.at(-1)).toBeNull();
  });

  it("asks for manager approval on a discounted FORBIDDEN without showing a payment failure", async () => {
    const state = effects();
    const result = await runPosCheckout(input({ discountTotalMinor: 100 }), state.values, {
      complete: async () => { throw new ApiError("FORBIDDEN", "Forbidden", "", 403); },
    });

    expect(result).toBe(false);
    expect(state.approvals).toEqual([["pay", false]]);
    expect(state.failures.every((failure) => failure === null)).toBe(true);
  });

  it("clears the previous failure when a later attempt succeeds", async () => {
    const state = effects();
    await runPosCheckout(input(), state.values, {
      complete: async () => { throw new ApiError("FORBIDDEN", "Forbidden", "", 403); },
    });
    expect(state.failures.at(-1)?.kind).toBe("permission");

    const result = await runPosCheckout(input(), state.values, {
      complete: async () => ({ kind: "completed", saleId: "sale-ok" }),
    });

    expect(result).toBe(true);
    expect(state.failures.at(-1)).toBeNull();
    expect(state.statuses.at(-1)).toBe("Sale completed.");
  });

  it("surfaces the pre-sale PayMongo configuration gap through the same contract", async () => {
    const state = effects();
    await runPosCheckout(input({ method: "qrph", methodAvailable: () => false }), state.values, {});

    expect(state.failures.at(-1)?.kind).toBe("config");
    expect(state.failures.at(-1)?.retryable).toBe(false);
    expect(state.statuses.at(-1)).toBe("PayMongo is not configured for this payment method yet.");
  });

  it("surfaces an offline queue failure through the same contract", async () => {
    const state = effects();
    await runPosCheckout(input({ offline: true, store: new MemorySyncStore() }), state.values, {
      queue: async () => { throw new Error("storage failed"); },
    });

    expect(state.failures.at(-1)?.kind).toBe("connectivity");
    expect(state.failures.at(-1)?.retryable).toBe(true);
    expect(state.statuses.at(-1)).toBe("Could not queue the offline sale.");
  });
});
