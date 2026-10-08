import { describe, expect, it } from "vitest";

import {
  completeSaleExchange,
  continuePayMongoCheckout,
  reconcileSalePayment,
  submitSaleRefund,
  voidSaleRecord,
  type SaleDetailApiCall,
} from "./sale-detail-api";

interface CapturedCall {
  path: string;
  csrfToken?: string;
  method?: string;
  body?: string | null;
  headers?: HeadersInit;
}

function captureApi(): { api: SaleDetailApiCall; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const api: SaleDetailApiCall = async <T>(
    path: string,
    options?: { csrfToken?: string; init?: RequestInit },
  ): Promise<T> => {
    calls.push({
      path,
      csrfToken: options?.csrfToken,
      method: options?.init?.method,
      body: options?.init?.body as string | null | undefined,
      headers: options?.init?.headers,
    });
    if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf-token" } as T;
    if (path.endsWith("/paymongo/checkout")) return { checkoutUrl: "https://checkout.paymongo.test/session" } as T;
    if (path.endsWith("/exchange")) {
      return {
        exchange: { netMinor: 500, direction: "COLLECT" },
        replacementSale: { id: "replacement-1", receiptNo: "2026-000123" },
      } as T;
    }
    return {} as T;
  };
  return { api, calls };
}

describe("sale detail API", () => {
  it("resumes PayMongo checkout with CSRF and one idempotency key", async () => {
    const { api, calls } = captureApi();

    const result = await continuePayMongoCheckout(
      { saleId: "sale-1", method: "qrph" },
      { api, uuid: () => "checkout-key" },
    );

    expect(result).toEqual({ checkoutUrl: "https://checkout.paymongo.test/session" });
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", csrfToken: undefined, method: undefined, body: undefined, headers: undefined },
      {
        path: "/api/v1/sales/sale-1/paymongo/checkout",
        csrfToken: "csrf-token",
        method: "POST",
        body: JSON.stringify({ method: "qrph" }),
        headers: { "Idempotency-Key": "checkout-key" },
      },
    ]);
  });

  it("reconciles an unknown payment with CSRF and idempotency", async () => {
    const { api, calls } = captureApi();

    await reconcileSalePayment(
      { paymentId: "pay-1", outcome: "SUCCEEDED" },
      { api, uuid: () => "reconcile-key" },
    );

    expect(calls[1]).toEqual({
      path: "/api/v1/payments/pay-1/reconcile",
      csrfToken: "csrf-token",
      method: "POST",
      body: JSON.stringify({ outcome: "SUCCEEDED" }),
      headers: { "Idempotency-Key": "reconcile-key" },
    });
  });

  it("preserves refund paths, approval token placement, and reject idempotency behavior", async () => {
    const { api, calls } = captureApi();

    await submitSaleRefund(
      {
        saleId: "sale-1",
        mode: "approve",
        items: [{ saleItemId: "line-1", qty: 2 }],
        loadRefunds: [{ loadId: "load-1", amountMinor: 1250 }],
        reason: "Customer request",
        approvalToken: "grant-1",
      },
      { api, uuid: () => "refund-key" },
    );
    await submitSaleRefund(
      { saleId: "sale-1", mode: "reject", reason: "Outside policy" },
      { api, uuid: () => "unused-key" },
    );

    expect(calls[1]).toEqual({
      path: "/api/v1/sales/sale-1/refund-approve",
      csrfToken: "csrf-token",
      method: "POST",
      body: JSON.stringify({
        saleId: "sale-1",
        items: [{ saleItemId: "line-1", qty: 2 }],
        loadRefunds: [{ loadId: "load-1", amountMinor: 1250 }],
        reason: "Customer request",
        approvalToken: "grant-1",
      }),
      headers: { "Idempotency-Key": "refund-key" },
    });
    expect(calls[3]).toEqual({
      path: "/api/v1/sales/sale-1/refund-reject",
      csrfToken: "csrf-token",
      method: "POST",
      body: JSON.stringify({ reason: "Outside policy" }),
      headers: undefined,
    });
  });

  it("voids with CSRF while preserving the existing no-idempotency request", async () => {
    const { api, calls } = captureApi();

    await voidSaleRecord(
      { saleId: "sale-1", reason: "Duplicate sale", approvalToken: "grant-2" },
      { api },
    );

    expect(calls[1]).toEqual({
      path: "/api/v1/sales/sale-1/void",
      csrfToken: "csrf-token",
      method: "POST",
      body: JSON.stringify({ reason: "Duplicate sale", approvalToken: "grant-2" }),
      headers: undefined,
    });
  });

  it("completes an exchange with CSRF and one idempotency key", async () => {
    const { api, calls } = captureApi();
    const input = {
      returns: [{ saleItemId: "line-1", qty: 1 }],
      replacements: [{ productId: "product-2", qty: 1 }],
      reason: "Wrong size",
    };

    const result = await completeSaleExchange(
      { saleId: "sale-1", input },
      { api, uuid: () => "exchange-key" },
    );

    expect(result.replacementSale.receiptNo).toBe("2026-000123");
    expect(calls[1]).toEqual({
      path: "/api/v1/sales/sale-1/exchange",
      csrfToken: "csrf-token",
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": "exchange-key" },
    });
  });
});
