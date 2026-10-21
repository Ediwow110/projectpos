import { apiFetch } from "./api";

/**
 * Client model for the public API token endpoints
 * (`apps/api/src/apitokens/nest/apitoken.controller.ts`).
 *
 * The server owns the real rules; this module only mirrors them so the form
 * cannot post a payload the API would reject, and gives the ledger one honest
 * vocabulary for live / expiring / expired / revoked.
 */

/** Mirrors TOKEN_SCOPES in packages/validation/src/billing.schema.ts exactly. */
export const API_TOKEN_SCOPES = [
  "sales:read",
  "catalog:read",
  "catalog:write",
  "reports:read",
  "inventory:read",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** apiTokenCreateSchema: name is trimmed and capped at 80, scopes at 10. */
export const TOKEN_NAME_MAX = 80;
export const TOKEN_SCOPES_MAX = 10;

/**
 * An integration that breaks when a token expires needs lead time to rotate,
 * so a token inside two weeks is called out rather than left as a surprise.
 */
export const EXPIRING_SOON_DAYS = 14;

const DAY_MS = 86_400_000;

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  "sales:read": "Read sales",
  "catalog:read": "Read catalogue",
  "catalog:write": "Write catalogue",
  "reports:read": "Read reports",
  "inventory:read": "Read inventory",
};

/** The list view shape returned by GET /api/v1/apitokens. */
export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  revokedAt: string | null;
  expiresAt: string | null;
}

/** The mint response shape. `secret` exists here and nowhere else, ever. */
export interface MintedApiToken {
  id: string;
  prefix: string;
  secret: string;
  scopes: string[];
}

export type TokenState = "revoked" | "expired" | "expiring" | "live";
export type TokenTone = "ok" | "warn" | "bad" | "info";

export interface TokenStateCopy {
  state: TokenState;
  label: string;
  tone: TokenTone;
  detail: string;
}

export interface TokenSummary {
  total: number;
  usable: number;
  expiringSoon: number;
  expired: number;
  revoked: number;
}

/** `expiresAt` is optional on the server, so the wire body omits it wholly. */
export interface ApiTokenCreateBody {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

export type ApiTokenWriter = <T>(
  path: string,
  opts?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

export type SubmitApiTokenResult =
  | { kind: "invalid"; errors: ApiTokenDraftErrors }
  | { kind: "created"; token: MintedApiToken };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Normalises an instant the way the JSON boundary actually delivers it: the
 * driver hands back Date objects over the wire in some deployments and ISO
 * strings in others. A value that is present but unreadable is kept verbatim
 * so the state helpers can fail closed instead of claiming health.
 */
function instantField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

function isUnreadableInstant(value: string): boolean {
  return Number.isNaN(Date.parse(value));
}

export function projectTokenRow(raw: unknown): ApiTokenRow {
  const source = isRecord(raw) ? raw : {};
  return {
    id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
    name: typeof source.name === "string" && source.name.trim() ? source.name : "Unnamed token",
    prefix: typeof source.prefix === "string" ? source.prefix : "",
    scopes: Array.isArray(source.scopes) ? source.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    revokedAt: instantField(source.revokedAt),
    expiresAt: instantField(source.expiresAt),
  };
}

/**
 * A mint response is the only place a secret exists. Projecting it keeps the
 * secret in exactly the fields the show-once panel needs and drops anything
 * else the server may add later (a hash, a full record).
 */
export function projectMintedToken(raw: unknown): MintedApiToken {
  const source = isRecord(raw) ? raw : {};
  return {
    id: typeof source.id === "string" ? source.id : "",
    prefix: typeof source.prefix === "string" ? source.prefix : "",
    secret: typeof source.secret === "string" ? source.secret : "",
    scopes: Array.isArray(source.scopes) ? source.scopes.filter((scope): scope is string => typeof scope === "string") : [],
  };
}

export function tokenStateOf(row: ApiTokenRow, nowMs: number = Date.now()): TokenState {
  // Any non-null revocation marker wins; an unreadable one still means the
  // server said this token is no longer valid.
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt === null) return "live";
  if (isUnreadableInstant(row.expiresAt)) return "expired";
  const ms = Date.parse(row.expiresAt);
  if (ms <= nowMs) return "expired";
  if (ms - nowMs <= EXPIRING_SOON_DAYS * DAY_MS) return "expiring";
  return "live";
}

export function expiryDaysLeft(row: ApiTokenRow, nowMs: number = Date.now()): number | null {
  if (row.expiresAt === null || isUnreadableInstant(row.expiresAt)) return null;
  return Math.ceil((Date.parse(row.expiresAt) - nowMs) / DAY_MS);
}

export function formatTokenDay(value: string | null): string {
  if (value === null) return "No expiry";
  if (isUnreadableInstant(value)) return "Unknown date";
  return new Date(value).toISOString().slice(0, 10);
}

export function tokenStateCopy(row: ApiTokenRow, nowMs: number = Date.now()): TokenStateCopy {
  const state = tokenStateOf(row, nowMs);
  if (state === "revoked") {
    return { state, label: "Revoked", tone: "bad", detail: `Revoked ${formatTokenDay(row.revokedAt)}` };
  }
  if (state === "expired") {
    return { state, label: "Expired", tone: "bad", detail: `Expired ${formatTokenDay(row.expiresAt)}` };
  }
  if (state === "expiring") {
    const days = expiryDaysLeft(row, nowMs);
    return {
      state,
      label: "Expires soon",
      tone: "warn",
      detail: `Expires ${formatTokenDay(row.expiresAt)}${days === null ? "" : ` (${days} day${days === 1 ? "" : "s"})`}`,
    };
  }
  return {
    state,
    label: "Active",
    tone: "ok",
    detail: row.expiresAt === null ? "No expiry" : `Expires ${formatTokenDay(row.expiresAt)}`,
  };
}

export function tokenSummary(rows: ApiTokenRow[], nowMs: number = Date.now()): TokenSummary {
  const states = rows.map((row) => tokenStateOf(row, nowMs));
  const revoked = states.filter((state) => state === "revoked").length;
  const expired = states.filter((state) => state === "expired").length;
  const expiringSoon = states.filter((state) => state === "expiring").length;
  return {
    total: rows.length,
    usable: rows.length - revoked - expired,
    expiringSoon,
    expired,
    revoked,
  };
}

/** A row is always named by its label and prefix; the secret is never part of it. */
export function tokenRowLabel(row: ApiTokenRow): string {
  return `${row.name} · ${row.prefix}`;
}

export function scopeLabel(scope: string): string {
  const known = SCOPE_LABELS[scope as ApiTokenScope];
  return known ?? scope;
}

export function scopesCopy(scopes: string[]): string {
  return scopes.map(scopeLabel).join(", ");
}

export interface ApiTokenDraft {
  name: string;
  scopes: string[];
  /** Raw `datetime-local` value; empty string means "never expires". */
  expiresAt: string;
}

export type ApiTokenDraftErrors = Partial<Record<"name" | "scopes" | "expiresAt", string>>;

/**
 * Converts a `datetime-local` value into the one shape the server accepts:
 * `z.string().datetime()` rejects a zone-less local value and rejects a
 * `+08:00` offset, so the client must send the UTC `Z` form.
 */
export function apiExpiryInstant(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function validateApiTokenDraft(draft: ApiTokenDraft, nowMs: number = Date.now()): ApiTokenDraftErrors {
  const errors: ApiTokenDraftErrors = {};

  const name = draft.name.trim();
  if (!name) errors.name = "Name the token so you can recognise which integration it belongs to.";
  else if (name.length > TOKEN_NAME_MAX) errors.name = `Keep the name to ${TOKEN_NAME_MAX} characters or fewer.`;

  const scopes = [...new Set(draft.scopes)];
  if (scopes.length === 0) errors.scopes = "Select at least one scope.";
  else if (scopes.length > TOKEN_SCOPES_MAX) errors.scopes = `Select at most ${TOKEN_SCOPES_MAX} scopes.`;
  else {
    const unknown = scopes.filter((scope) => !(API_TOKEN_SCOPES as readonly string[]).includes(scope));
    if (unknown.length > 0) errors.scopes = `Unsupported scope: ${unknown.join(", ")}.`;
  }

  if (draft.expiresAt.trim()) {
    const iso = apiExpiryInstant(draft.expiresAt);
    if (iso === null) errors.expiresAt = "Choose a valid expiry date and time.";
    else if (Date.parse(iso) <= nowMs) errors.expiresAt = "The expiry must be in the future.";
  }

  return errors;
}

/** Returns the request body, or null when the draft cannot be accepted. */
export function createTokenBody(draft: ApiTokenDraft, nowMs: number = Date.now()): ApiTokenCreateBody | null {
  if (Object.keys(validateApiTokenDraft(draft, nowMs)).length > 0) return null;
  const body: ApiTokenCreateBody = {
    name: draft.name.trim(),
    scopes: [...new Set(draft.scopes)],
  };
  const expiresAt = apiExpiryInstant(draft.expiresAt);
  if (expiresAt !== null) body.expiresAt = expiresAt;
  return body;
}

async function csrfToken(write: ApiTokenWriter): Promise<string> {
  const response = await write<{ csrfToken: string }>("/api/v1/auth/csrf");
  return response.csrfToken;
}

/**
 * Mints a token. A draft the server would reject never leaves the browser:
 * the call returns the field errors and sends no request at all.
 */
export async function submitApiToken(
  draft: ApiTokenDraft,
  write: ApiTokenWriter = apiFetch,
  nowMs: number = Date.now(),
): Promise<SubmitApiTokenResult> {
  const body = createTokenBody(draft, nowMs);
  if (body === null) return { kind: "invalid", errors: validateApiTokenDraft(draft, nowMs) };
  const csrf = await csrfToken(write);
  const minted = await write<unknown>("/api/v1/apitokens", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return { kind: "created", token: projectMintedToken(minted) };
}

export async function revokeApiToken(id: string, write: ApiTokenWriter = apiFetch): Promise<void> {
  const csrf = await csrfToken(write);
  await write<unknown>(`/api/v1/apitokens/${encodeURIComponent(id)}/revoke`, {
    csrfToken: csrf,
    init: { method: "POST" },
  });
}

export function revokeConfirmation(row: ApiTokenRow): {
  title: string;
  description: string;
  confirmLabel: string;
  details: string;
} {
  return {
    title: "Revoke this API token?",
    description: `${row.name} (${row.prefix}) is signed by a live token. The integration using it must be reconfigured with a new token afterwards.`,
    confirmLabel: "Revoke token",
    details: `This takes effect immediately and cannot be undone. Scopes in play: ${scopesCopy(row.scopes) || "none"}.`,
  };
}
