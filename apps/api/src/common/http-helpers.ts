import type { Response } from "express";
import { error } from "../errors";
import { getCorrelationId } from "../correlation";
import { planLimitFields } from "./plan-limit-error";

export function fail(res: Response, status: number, code: string, message: string, req: { headers: Record<string, unknown>; correlationId?: string }, fields?: Record<string, string[]>): void {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  const correlationId = req.correlationId ?? getCorrelationId(headers);
  res.status(status).json(error(code, message, correlationId, fields));
}

export const CODE_STATUS: Record<string, number> = {
  AUTH_WEAK_PASSWORD: 400,
  AUTH_EMAIL_TAKEN: 409,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_INVALID: 400,
  AUTH_TOKEN_EXPIRED: 400,
  AUTH_TOKEN_USED: 400,
  AUTH_REAUTH_REQUIRED: 403,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  TENANT_REQUIRED: 401,
  TENANT_MISMATCH: 403,
  VALIDATION: 400,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  EMAIL_UNVERIFIED: 403,
  CSRF_REQUIRED: 403,
  CSRF_MISMATCH: 403,
  ONBOARDING_REQUIRED_STEP: 400,
  NOT_FOUND: 404,
  CATALOG_DUPLICATE_SKU: 409,
  CATALOG_DUPLICATE_BARCODE: 409,
  CATALOG_IMPORT_TOO_LARGE: 400,
  INSUFFICIENT_STOCK: 409,
  PRODUCT_NOT_TRACKED: 400,
  SALE_INVALID_TRANSITION: 409,
  PAYMENT_TOTAL_MISMATCH: 400,
  PAYMENT_PROVIDER_REQUIRED: 409,
  PAYMENT_PROVIDER_NOT_CONFIGURED: 503,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  PAYMENT_PROVIDER_REJECTED: 502,
  PAYMENT_PROVIDER_INVALID_RESPONSE: 502,
  PAYMENT_PROVIDER_MISMATCH: 409,
  PAYMENT_ALREADY_SUCCEEDED: 409,
  IDEMPOTENCY_MISMATCH: 409,
  WEBHOOK_IN_PROGRESS: 409,
  PAYMENT_UNKNOWN: 202,
  IDEMPOTENCY_REPLAY: 200,
  SHIFT_ALREADY_OPEN: 409,
  SHIFT_NO_OPEN_SHIFT: 409,
  SHIFT_ALREADY_CLOSED: 409,
  SHIFT_CLOSED_IMMUTABLE: 403,
  REFUND_EXCEEDS_LIMIT: 400,
  EXCHANGE_CASH_ONLY: 409,
  PAYLOAD_TOO_LARGE: 413,
  TRANSFER_INVALID_STATE: 409,
  PLAN_LIMIT: 402,
};

export function statusFor(code: string, fallback = 400): number {
  return CODE_STATUS[code] ?? fallback;
}

// Plan-limit breaches must reach the client with machine fields
// ({ limit, used, plan } for caps, { feature, plan } for feature gates), so
// the UI can render an upgrade path instead of a bare error code.
export function failFromError(
  res: Response,
  e: unknown,
  message: string,
  req: { headers: Record<string, unknown>; correlationId?: string },
  fallback = 400,
): void {
  const code = e instanceof Error ? e.message : "VALIDATION";
  fail(res, statusFor(code, fallback), code, message, req, planLimitFields(e));
}
