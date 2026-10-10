import type { Request } from "express";
import { getCorrelationId } from "../../correlation";
import { createRateLimiter } from "../../common/rate-limit";

export function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  return getCorrelationId(headers);
}

export function idemKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.trim() === "") return null;
  return key;
}

export const SELL_ROLES = new Set(["owner", "manager", "cashier"]);
export const moneyLimiter = createRateLimiter(1000, 60_000);
export const approvalLimiter = createRateLimiter(5, 60_000);
