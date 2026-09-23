export const SYNC_STATUSES = ["QUEUED", "SENDING", "SYNCED", "CONFLICT", "FAILED", "RESOLVED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

const BACKOFF_MS = [5000, 30000, 300000];

export function backoffDelayMs(attempts: number): number | null {
  if (!Number.isInteger(attempts) || attempts < 0) throw new Error("VALIDATION");
  if (attempts >= BACKOFF_MS.length) return null; // manual retry only
  return BACKOFF_MS[attempts]!;
}

export type ReplayOutcome =
  | { kind: "applied" }
  | { kind: "replayable"; code: string }
  | { kind: "conflict"; code: string };

const CONFLICT_CODES = new Set([
  "INSUFFICIENT_STOCK",
  "IDEMPOTENCY_MISMATCH",
  "FORBIDDEN",
  "SHIFT_NO_OPEN_SHIFT",
  "VALIDATION",
]);

export function classifyReplay(status: number, code: string | null): ReplayOutcome {
  if (status >= 200 && status < 300) return { kind: "applied" };
  if (code !== null && CONFLICT_CODES.has(code)) return { kind: "conflict", code };
  return { kind: "replayable", code: code ?? `HTTP_${status}` };
}

export function nextSyncState(outcome: ReplayOutcome): SyncStatus {
  if (outcome.kind === "applied") return "SYNCED";
  if (outcome.kind === "replayable") return "FAILED";
  return "CONFLICT";
}

export function provisionalReceipt(randomHex8: string): string {
  if (!/^[0-9a-f]{8}$/.test(randomHex8)) throw new Error("VALIDATION");
  return `OFFLINE-${randomHex8}`;
}

export function skewWarning(serverTimeIso: string, nowMs: number, maxSkewMs = 300000): boolean {
  const t = new Date(serverTimeIso).getTime();
  if (Number.isNaN(t)) throw new Error("VALIDATION");
  return Math.abs(nowMs - t) > maxSkewMs;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export async function fingerprintPayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(payload));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
