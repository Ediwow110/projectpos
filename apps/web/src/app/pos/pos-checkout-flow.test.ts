import { describe, expect, it } from "vitest";
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
  const reconciles: Array<string | null> = [];
  const reconciliationSales: Array<string | null> = [];
  const giftCards: Array<{ code: string; amountMinor: number }> = [];
  const approvals: Array<["pay" | "hold", boolean]> = [];
  const carts: unknown[] = [];
  const flags: boolean[] = [];
  const values: PosCheckoutEffects = {
    setStatus: (status) => { statuses.push(status); },
    setReceiptId: (id) => { receipts.push(id); },
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
  return { values, statuses, receipts, reconciles, reconciliationSales, giftCards, approvals, carts, flags };
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

  it("preserves offline pay returning true even when queueing fails", async () => {
    const state = effects();
    const result = await runPosCheckout(input({
      offline: true, store: new MemorySyncStore(),
    }), state.values, {
      queue: async () => { throw new Error("storage failed"); },
    });
    expect(result).toBe(true);
    expect(state.statuses.at(-1)).toBe("Could not queue the offline sale.");
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
    expect(state.reconciliationSales).toEqual([null, "sale-2"]);
    expect(state.statuses.at(-1)).toContain("Do not retry blindly");
    expect(state.carts).toEqual([]);
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
    expect(state.statuses.at(-1)).toBe("Payment failed");
  });
});
