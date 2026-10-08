import { apiFetch } from "./api";

export type SaleDetailApiCall = <T>(
  path: string,
  options?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

type ReconcileOutcome = "SUCCEEDED" | "FAILED";
type RefundMode = "request" | "approve" | "reject";

interface SaleDetailApiDeps {
  api?: SaleDetailApiCall;
  uuid?: () => string;
}

interface CsrfResponse {
  csrfToken: string;
}

interface ExchangeInput {
  returns: Array<{ saleItemId: string; qty: number }>;
  replacements: Array<{ productId: string; qty: number }>;
  reason: string;
}

export interface SaleExchangeResponse {
  exchange: {
    id?: string;
    originalSaleId?: string;
    refundId?: string;
    replacementSaleId?: string;
    returnMinor?: number;
    replacementMinor?: number;
    netMinor: number;
    direction: "COLLECT" | "REFUND" | "EVEN";
    reason?: string;
    actorId?: string;
    requestId?: string;
    createdAt?: string;
  };
  replacementSale: { id: string; receiptNo: string };
}

function deps(overrides: SaleDetailApiDeps): {
  api: SaleDetailApiCall;
  uuid: () => string;
} {
  return {
    api: overrides.api ?? apiFetch,
    uuid: overrides.uuid ?? (() => crypto.randomUUID()),
  };
}

async function csrfToken(api: SaleDetailApiCall): Promise<string> {
  const csrf = await api<CsrfResponse>("/api/v1/auth/csrf");
  return csrf.csrfToken;
}

export async function continuePayMongoCheckout(
  input: { saleId: string; method: string },
  overrides: SaleDetailApiDeps = {},
): Promise<{ checkoutUrl: string }> {
  const { api, uuid } = deps(overrides);
  const csrf = await csrfToken(api);
  return api<{ checkoutUrl: string }>(`/api/v1/sales/${input.saleId}/paymongo/checkout`, {
    csrfToken: csrf,
    init: {
      method: "POST",
      body: JSON.stringify({ method: input.method }),
      headers: { "Idempotency-Key": uuid() },
    },
  });
}

export async function reconcileSalePayment(
  input: { paymentId: string; outcome: ReconcileOutcome },
  overrides: SaleDetailApiDeps = {},
): Promise<void> {
  const { api, uuid } = deps(overrides);
  const csrf = await csrfToken(api);
  await api(`/api/v1/payments/${input.paymentId}/reconcile`, {
    csrfToken: csrf,
    init: {
      method: "POST",
      body: JSON.stringify({ outcome: input.outcome }),
      headers: { "Idempotency-Key": uuid() },
    },
  });
}

export async function submitSaleRefund(
  input: {
    saleId: string;
    mode: RefundMode;
    items?: Array<{ saleItemId: string; qty: number }>;
    loadRefunds?: Array<{ loadId: string; amountMinor: number }>;
    reason: string;
    approvalToken?: string;
  },
  overrides: SaleDetailApiDeps = {},
): Promise<void> {
  const { api, uuid } = deps(overrides);
  const csrf = await csrfToken(api);
  const path = input.mode === "request"
    ? `/api/v1/sales/${input.saleId}/refund-request`
    : input.mode === "approve"
      ? `/api/v1/sales/${input.saleId}/refund-approve`
      : `/api/v1/sales/${input.saleId}/refund-reject`;
  const body = input.mode === "approve"
    ? {
        saleId: input.saleId,
        items: input.items ?? [],
        ...(input.loadRefunds && input.loadRefunds.length > 0 ? { loadRefunds: input.loadRefunds } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.approvalToken ? { approvalToken: input.approvalToken } : {}),
      }
    : { reason: input.reason };

  await api(path, {
    csrfToken: csrf,
    init: {
      method: "POST",
      body: JSON.stringify(body),
      ...(input.mode !== "reject" ? { headers: { "Idempotency-Key": uuid() } } : {}),
    },
  });
}

export async function voidSaleRecord(
  input: { saleId: string; reason: string; approvalToken?: string },
  overrides: SaleDetailApiDeps = {},
): Promise<void> {
  const { api } = deps(overrides);
  const csrf = await csrfToken(api);
  await api(`/api/v1/sales/${input.saleId}/void`, {
    csrfToken: csrf,
    init: {
      method: "POST",
      body: JSON.stringify({
        reason: input.reason,
        ...(input.approvalToken ? { approvalToken: input.approvalToken } : {}),
      }),
    },
  });
}

export async function completeSaleExchange(
  input: { saleId: string; input: ExchangeInput },
  overrides: SaleDetailApiDeps = {},
): Promise<SaleExchangeResponse> {
  const { api, uuid } = deps(overrides);
  const csrf = await csrfToken(api);
  return api<SaleExchangeResponse>(`/api/v1/sales/${input.saleId}/exchange`, {
    csrfToken: csrf,
    init: {
      method: "POST",
      headers: { "Idempotency-Key": uuid() },
      body: JSON.stringify(input.input),
    },
  });
}
