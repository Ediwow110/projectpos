import { describe, expect, it } from "vitest";

import { MemorySyncStore } from "./sync-store";
import {
  completePosSale,
  holdPosSale,
  queueOfflinePosSale,
  resumePosSale,
  type PosApiCall,
} from "./pos-operations";

const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }];
const undiscountedCart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }];

describe("POS operations", () => {
  it("holds a draft through csrf + draft + hold without leaking UI state", async () => {
    const calls: Array<{ path: string; method?: string; body?: string | null }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, method: options?.init?.method, body: options?.init?.body as string | null | undefined });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-1" } as T;
      return {} as T;
    };

    const result = await holdPosSale(
      { cart, registerId: "reg-1", customerId: "", walkIn: "Walk In", orderDiscountMinor: 300 },
      { api },
    );

    expect(result).toEqual({ draftId: "sale-1" });
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", method: undefined, body: undefined },
      { path: "/api/v1/sales/drafts", method: "POST", body: JSON.stringify({
        lines: [{ productId: "p1", qty: 2, lineDiscountMinor: 500 }],
        orderDiscountMinor: 300,
        registerId: "reg-1",
        customerName: "Walk In",
      }) },
      { path: "/api/v1/sales/sale-1/hold", method: "POST", body: "{}" },
    ]);
  });

  it("re-holds an existing resumed draft without creating a duplicate draft", async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, method: options?.init?.method });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      return {} as T;
    };

    const result = await holdPosSale(
      { cart, registerId: "reg-1", customerId: "", walkIn: "", orderDiscountMinor: 300, existingDraftId: "sale-held" },
      { api },
    );

    expect(result).toEqual({ draftId: "sale-held" });
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", method: undefined },
      { path: "/api/v1/sales/sale-held/hold", method: "POST" },
    ]);
  });

  it("resumes a held draft through csrf + resume", async () => {
    const calls: Array<{ path: string; method?: string }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, method: options?.init?.method });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/sale-1/resume") return { id: "sale-1", status: "DRAFT" } as T;
      throw new Error("unexpected path " + path);
    };

    const result = await resumePosSale("sale-1", { api });

    expect(result).toEqual({ id: "sale-1", status: "DRAFT" });
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", method: undefined },
      { path: "/api/v1/sales/sale-1/resume", method: "POST" },
    ]);
  });

  it("queues an offline cash sale with a provisional receipt", async () => {
    const store = new MemorySyncStore();
    const result = await queueOfflinePosSale(
      {
        store,
        cart: undiscountedCart,
        registerId: "reg-1",
        customerId: "",
        walkIn: "Walk In",
        received: "60",
        dueMinor: 5000,
        orderDiscountMinor: 0,
      },
      { uuid: () => "12345678-aaaa-bbbb-cccc-123456789012" },
    );

    expect(result.provisionalReceipt).toContain("12345678");
    const queued = await store.listAll();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.commandType).toBe("sale.complete");
    expect(queued[0]?.payload).toMatchObject({
      registerId: "reg-1",
      customerName: "Walk In",
      payments: [{ method: "cash", amountMinor: 6000 }],
    });
  });

  it("refuses to queue approval-sensitive discounted sales while offline", async () => {
    const store = new MemorySyncStore();
    await expect(queueOfflinePosSale({
      store,
      cart,
      registerId: "reg-1",
      customerId: "",
      walkIn: "",
      received: "50",
      dueMinor: 4200,
      orderDiscountMinor: 300,
    })).rejects.toThrow("DISCOUNT_REQUIRES_CONNECTIVITY");
    expect(await store.listAll()).toEqual([]);
  });

  it("returns a hosted-checkout redirect for PayMongo methods", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-1", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/sale-1/paymongo/checkout") {
        return { checkoutUrl: "https://checkout.paymongo.test/session" } as T;
      }
      throw new Error("unexpected path " + path);
    };

    const result = await completePosSale(
      {
        cart,
        registerId: "reg-1",
        customerId: "",
        walkIn: "",
        received: "",
        method: "qrph",
        orderDiscountMinor: 300,
      },
      { api, uuid: () => "checkout-key" },
    );

    expect(result).toEqual({
      kind: "redirect",
      checkoutUrl: "https://checkout.paymongo.test/session",
    });
  });

  it("preserves PAYMENT_UNKNOWN instead of presenting completion", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-2", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/complete") {
        return {
          sale: { id: "sale-2", status: "PAYMENT_UNKNOWN", payments: [{ id: "pay-2" }] },
        } as T;
      }
      throw new Error("unexpected path " + path);
    };

    const result = await completePosSale(
      {
        cart,
        registerId: "",
        customerId: "",
        walkIn: "",
        received: "50",
        method: "cash",
        orderDiscountMinor: 300,
      },
      { api, uuid: () => "complete-key" },
    );

    expect(result).toEqual({
      kind: "unknown",
      saleId: "sale-2",
      paymentId: "pay-2",
    });
  });

  it("completes an existing resumed draft without creating a replacement", async () => {
    const calls: string[] = [];
    const api: PosApiCall = async <T>(path: string) => {
      calls.push(path);
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/complete") {
        return { id: "sale-held", status: "COMPLETED", payments: [] } as T;
      }
      throw new Error("unexpected path " + path);
    };

    const result = await completePosSale(
      {
        cart,
        registerId: "reg-1",
        customerId: "",
        walkIn: "",
        received: "",
        method: "cash",
        orderDiscountMinor: 300,
        existingDraft: { id: "sale-held", totalMinor: 5000 },
      },
      { api, uuid: () => "complete-held" },
    );

    expect(result).toEqual({ kind: "completed", saleId: "sale-held" });
    expect(calls).toEqual(["/api/v1/auth/csrf", "/api/v1/sales/complete"]);
  });
});
