import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { posSaleAttemptContext } from "./pos-checkout-feedback";
import { MemorySyncStore } from "./sync-store";
import {
  authorizePosDiscount,
  completePosSale,
  holdPosSale,
  queueOfflinePosSale,
  resumePosSale,
  type PosApiCall,
} from "./pos-operations";

const cart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 500 }];
const undiscountedCart = [{ productId: "p1", name: "Coffee", priceMinor: 2500, qty: 2, lineDiscountMinor: 0 }];

describe("POS operations", () => {
  it("requests a one-use manager approval by PIN without sending customer or register data", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, body: options?.init?.body as string | null | undefined });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/discount-approval") {
        return {
          token: "mgr_token-12345678901234567890",
          expiresAt: "2026-09-30T13:00:00.000Z",
          approver: { name: "Store Manager", role: "manager" },
        } as T;
      }
      throw new Error("unexpected path " + path);
    };
    const out = await authorizePosDiscount({
      cart,
      orderDiscountMinor: 300,
      email: "manager@example.com",
      pin: "482615",
    }, { api });
    expect(out.token).toMatch(/^mgr_/);
    expect(calls[1]?.body).toBe(JSON.stringify({
      lines: [{ productId: "p1", qty: 2, lineDiscountMinor: 500 }],
      orderDiscountMinor: 300,
      email: "manager@example.com",
      pin: "482615",
    }));
  });

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

  it("passes a manager approval token only to the draft creation call", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, body: options?.init?.body as string | null | undefined });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-approved", totalMinor: 4200 } as T;
      if (path === "/api/v1/sales/complete") return { id: "sale-approved", status: "COMPLETED", payments: [] } as T;
      throw new Error("unexpected path " + path);
    };
    await completePosSale({
      cart,
      registerId: "reg-1",
      customerId: "",
      walkIn: "",
      received: "42",
      method: "cash",
      orderDiscountMinor: 300,
      approvalToken: "mgr_token-12345678901234567890",
    }, { api, uuid: () => "approved-complete-key" });
    expect(JSON.parse(calls.find((call) => call.path === "/api/v1/sales/drafts")!.body!)).toMatchObject({
      approvalToken: "mgr_token-12345678901234567890",
    });
    expect(calls.find((call) => call.path === "/api/v1/sales/complete")!.body).not.toContain("approvalToken");
  });

  it("forwards a new gift-card load into draft creation and returns one-time codes", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, body: options?.init?.body as string | null | undefined });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-load", totalMinor: 3500 } as T;
      if (path === "/api/v1/sales/complete") return { id: "sale-load", status: "COMPLETED", payments: [], giftCardCodes: ["NXP-GC-ONE-TIME"] } as T;
      throw new Error("unexpected path " + path);
    };
    const result = await completePosSale({
      cart: undiscountedCart,
      registerId: "reg-1",
      customerId: "",
      walkIn: "",
      received: "35",
      method: "cash",
      orderDiscountMinor: 0,
      giftCardLoad: { kind: "NEW", amountMinor: 1000 },
    }, { api, uuid: () => "load-complete-key" });
    expect(result).toEqual({ kind: "completed", saleId: "sale-load", giftCardCodes: ["NXP-GC-ONE-TIME"] });
    expect(JSON.parse(calls.find((call) => call.path === "/api/v1/sales/drafts")!.body!)).toMatchObject({
      giftCardLoad: { kind: "NEW", amountMinor: 1000 },
    });
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

  it("preserves reload gift-card load data when holding a sale", async () => {
    const calls: Array<{ path: string; body?: string | null }> = [];
    const api: PosApiCall = async <T>(path: string, options?: { init?: RequestInit }) => {
      calls.push({ path, body: options?.init?.body as string | null | undefined });
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-held-load" } as T;
      return {} as T;
    };
    await holdPosSale({
      cart: undiscountedCart,
      registerId: "reg-1",
      customerId: "",
      walkIn: "",
      orderDiscountMinor: 0,
      giftCardLoad: { kind: "RELOAD", amountMinor: 1000, giftCardId: "card-1", maskedCode: "NXP-GC-••••1234", previousBalanceMinor: 0, status: "ACTIVE" },
    }, { api });
    expect(JSON.parse(calls.find((call) => call.path === "/api/v1/sales/drafts")!.body!)).toMatchObject({ giftCardLoad: { kind: "RELOAD", amountMinor: 1000, giftCardId: "card-1" } });
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

  it("does not promote a pending server response into a completed receipt", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-pending", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/complete") {
        return { id: "sale-pending", status: "PENDING_PAYMENT", receiptNo: "2026-000040", payments: [] } as T;
      }
      throw new Error("unexpected path " + path);
    };
    const result = await completePosSale({
      cart, registerId: "", customerId: "", walkIn: "", received: "50", method: "cash", orderDiscountMinor: 0,
    }, { api, uuid: () => "pending-complete" });
    expect(result).toEqual({ kind: "unknown", saleId: "sale-pending", paymentId: null });
  });

  it("returns an authoritative receipt number only when the sale is completed", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-ok", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/complete") {
        return { sale: { id: "sale-ok", status: "COMPLETED", receiptNo: "2026-000041", payments: [] } } as T;
      }
      throw new Error("unexpected path " + path);
    };
    const result = await completePosSale({
      cart, registerId: "", customerId: "", walkIn: "", received: "50", method: "cash", orderDiscountMinor: 0,
    }, { api, uuid: () => "completed" });
    expect(result).toEqual({ kind: "completed", saleId: "sale-ok", receiptNo: "2026-000041" });
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

  it("tags a completion failure with the existing draft so the payment UI can block blind retry", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-ctx", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/complete") {
        throw new ApiError("HTTP_ERROR", "Request failed.", "", 500);
      }
      throw new Error("unexpected path " + path);
    };

    let caught: unknown;
    try {
      await completePosSale({
        cart, registerId: "", customerId: "", walkIn: "", received: "50", method: "cash", orderDiscountMinor: 0,
      }, { api, uuid: () => "ctx-complete" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(posSaleAttemptContext(caught)).toEqual({ phase: "complete", saleId: "sale-ctx" });
  });

  it("tags a draft-creation failure as an attempt that may already be recorded", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") {
        throw new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0);
      }
      throw new Error("unexpected path " + path);
    };

    let caught: unknown;
    try {
      await completePosSale({
        cart, registerId: "", customerId: "", walkIn: "", received: "50", method: "cash", orderDiscountMinor: 0,
      }, { api, uuid: () => "ctx-draft" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    // The write may have landed before the connection dropped, so the failure
    // carries the DRAFT phase: no payment was sent, but the attempt may
    // already exist. Treating it as "nothing happened" is what allowed a
    // retry to create a second draft.
    expect(posSaleAttemptContext(caught)).toEqual({ phase: "draft", saleId: null });
  });

  it("tags a hosted-checkout creation failure with its draft", async () => {
    const api: PosApiCall = async <T>(path: string) => {
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
      if (path === "/api/v1/sales/drafts") return { id: "sale-hosted", totalMinor: 5000 } as T;
      if (path === "/api/v1/sales/sale-hosted/paymongo/checkout") {
        throw new ApiError("NETWORK_TIMEOUT", "The request timed out.", "", 0);
      }
      throw new Error("unexpected path " + path);
    };

    let caught: unknown;
    try {
      await completePosSale({
        cart, registerId: "", customerId: "", walkIn: "", received: "", method: "qrph", orderDiscountMinor: 0,
      }, { api, uuid: () => "ctx-hosted" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect(posSaleAttemptContext(caught)).toEqual({ phase: "checkout", saleId: "sale-hosted" });
  });
});
