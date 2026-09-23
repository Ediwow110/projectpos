import { createHash } from "node:crypto";

export const COMMAND_TYPES = ["sale.complete", "payment.reconcile", "refund.request"] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export function fingerprintPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}
