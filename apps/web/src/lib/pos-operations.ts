import { apiFetch } from "./api";
import { buildCompletePayload } from "./sales";
import {
  buildDraftSaleInput,
  buildOfflineSalePayload,
  isPayMongoMethodKey,
  resolveTenderedMinor,
  type PosCartEntry,
} from "./pos-sale-model";
import { fingerprintPayload, provisionalReceipt } from "./sync-state";
import type { SyncStore } from "./sync-store";
import { saleFromCompleteResponse, type CompleteSaleResponse } from "./pos-view";

interface ApiOptions {
  csrfToken?: string;
  init?: RequestInit;
}

export type PosApiCall = <T>(path: string, options?: ApiOptions) => Promise<T>;

interface SaleIdentityInput {
  cart: PosCartEntry[];
  registerId: string;
  customerId: string;
  walkIn: string;
  orderDiscountMinor: number;
  approvalToken?: string;
  existingDraftId?: string;
}

export async function authorizePosDiscount(
  input: {
    cart: PosCartEntry[];
    orderDiscountMinor: number;
    email: string;
  } & ({ pin: string; password?: never } | { password: string; pin?: never }),
  deps: { api?: PosApiCall } = {},
): Promise<{ token: string; expiresAt: string; approver: { name: string; role: string } }> {
  const api = deps.api ?? apiFetch;
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  return api("/api/v1/sales/discount-approval", {
    csrfToken: csrf.csrfToken,
    init: {
      method: "POST",
      body: JSON.stringify({
        lines: input.cart.map((entry) => ({
          productId: entry.productId,
          qty: entry.qty,
          lineDiscountMinor: entry.lineDiscountMinor,
        })),
        orderDiscountMinor: input.orderDiscountMinor,
        email: input.email.trim().toLowerCase(),
        ...(input.pin ? { pin: input.pin } : {}),
        ...(input.password ? { password: input.password } : {}),
      }),
    },
  });
}

export async function holdPosSale(
  input: SaleIdentityInput,
  deps: { api?: PosApiCall } = {},
): Promise<{ draftId: string }> {
  const api = deps.api ?? apiFetch;
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  const draft = input.existingDraftId
    ? { id: input.existingDraftId }
    : await api<{ id: string }>("/api/v1/sales/drafts", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify(buildDraftSaleInput(
            input.cart,
            input.registerId,
            input.customerId,
            input.walkIn,
            input.orderDiscountMinor,
            input.approvalToken,
          )),
        },
      });
  await api("/api/v1/sales/" + draft.id + "/hold", {
    csrfToken: csrf.csrfToken,
    init: { method: "POST", body: JSON.stringify({}) },
  });
  return { draftId: draft.id };
}

export async function resumePosSale(
  saleId: string,
  deps: { api?: PosApiCall } = {},
): Promise<{ id: string; status: string }> {
  const api = deps.api ?? apiFetch;
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  return api<{ id: string; status: string }>(`/api/v1/sales/${saleId}/resume`, {
    csrfToken: csrf.csrfToken,
    init: { method: "POST", body: JSON.stringify({}) },
  });
}

export async function queueOfflinePosSale(
  input: SaleIdentityInput & {
    store: SyncStore;
    received: string;
    dueMinor: number;
  },
  deps: { uuid?: () => string } = {},
): Promise<{ provisionalReceipt: string }> {
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  if (input.orderDiscountMinor > 0 || input.cart.some((entry) => entry.lineDiscountMinor > 0)) {
    throw new Error("DISCOUNT_REQUIRES_CONNECTIVITY");
  }
  const tendered = resolveTenderedMinor(input.received, input.dueMinor);
  const key = uuid();
  const payload = buildOfflineSalePayload(
    input.cart,
    input.registerId,
    input.customerId,
    input.walkIn,
    tendered,
    input.orderDiscountMinor,
  );
  const fingerprint = await fingerprintPayload({ ...payload, key });
  const receipt = provisionalReceipt(key.slice(0, 8));
  await input.store.enqueue({
    localId: key,
    commandType: "sale.complete",
    key,
    fingerprint,
    payload,
    queuedAt: new Date().toISOString(),
    lastAttemptAt: null,
    provisionalReceipt: receipt,
  });
  return { provisionalReceipt: receipt };
}

export type CompletePosSaleResult =
  | { kind: "redirect"; checkoutUrl: string }
  | { kind: "unknown"; saleId: string; paymentId: string | null }
  | { kind: "completed"; saleId: string };

export async function completePosSale(
  input: SaleIdentityInput & {
    received: string;
    method: string;
    existingDraft?: { id: string; totalMinor: number };
  },
  deps: { api?: PosApiCall; uuid?: () => string } = {},
): Promise<CompletePosSaleResult> {
  const api = deps.api ?? apiFetch;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  const draft = input.existingDraft ?? await api<{ id: string; totalMinor: number }>("/api/v1/sales/drafts", {
    csrfToken: csrf.csrfToken,
    init: {
      method: "POST",
      body: JSON.stringify(buildDraftSaleInput(
        input.cart,
        input.registerId,
        input.customerId,
        input.walkIn,
        input.orderDiscountMinor,
        input.approvalToken,
      )),
    },
  });
  const key = uuid();
  if (isPayMongoMethodKey(input.method)) {
    const checkout = await api<{ checkoutUrl: string }>(`/api/v1/sales/${draft.id}/paymongo/checkout`, {
      csrfToken: csrf.csrfToken,
      init: {
        method: "POST",
        body: JSON.stringify({ method: input.method }),
        headers: { "Idempotency-Key": key },
      },
    });
    return { kind: "redirect", checkoutUrl: checkout.checkoutUrl };
  }
  const tendered = resolveTenderedMinor(input.received, draft.totalMinor);
  const payments =
    input.method === "cash" && tendered >= draft.totalMinor
      ? [{ method: input.method, amountMinor: tendered }]
      : [{ method: input.method, amountMinor: draft.totalMinor }];
  const payload = buildCompletePayload(draft.id, payments, key);
  const response = await api<CompleteSaleResponse>("/api/v1/sales/complete", {
    csrfToken: csrf.csrfToken,
    init: {
      method: "POST",
      body: JSON.stringify(input.registerId !== "" ? { ...payload, registerId: input.registerId } : payload),
      headers: { "Idempotency-Key": key },
    },
  });
  const sale = saleFromCompleteResponse(response);
  if (sale.status === "PAYMENT_UNKNOWN") {
    return { kind: "unknown", saleId: sale.id, paymentId: sale.payments[0]?.id ?? null };
  }
  return { kind: "completed", saleId: sale.id };
}
