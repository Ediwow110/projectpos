import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  API_TOKEN_SCOPES,
  EXPIRING_SOON_DAYS,
  TOKEN_NAME_MAX,
  apiExpiryInstant,
  createTokenBody,
  formatTokenDay,
  projectTokenRow,
  revokeApiToken,
  revokeConfirmation,
  scopeLabel,
  submitApiToken,
  tokenRowLabel,
  tokenStateCopy,
  tokenStateOf,
  tokenSummary,
  validateApiTokenDraft,
  type ApiTokenDraft,
  type ApiTokenRow,
  type ApiTokenWriter,
} from "./api-tokens";

const NOW = Date.parse("2026-10-22T00:00:00.000Z");
const DAY_MS = 86_400_000;

type Call = { path: string; opts?: { csrfToken?: string; init?: RequestInit } };

function row(overrides: Partial<ApiTokenRow> = {}): ApiTokenRow {
  return {
    id: "tok_1",
    name: "Reports sync",
    prefix: "pos_ab12cd34",
    scopes: ["reports:read"],
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function draft(overrides: Partial<ApiTokenDraft> = {}): ApiTokenDraft {
  return { name: "Nightly export", scopes: ["sales:read"], expiresAt: "", ...overrides };
}

/** Records every call so a test can prove a rejected draft sends no request. */
function writer(responses: Record<string, unknown> = {}): { api: ApiTokenWriter; calls: Call[] } {
  const calls: Call[] = [];
  const api = async <T>(path: string, opts?: { csrfToken?: string; init?: RequestInit }): Promise<T> => {
    calls.push({ path, opts });
    if (path in responses) return responses[path] as T;
    if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf-abc" } as T;
    return {} as T;
  };
  return { api, calls };
}

describe("token state model", () => {
  it("reads a revoked token as revoked, never as usable", () => {
    const revoked = row({ revokedAt: new Date(NOW - DAY_MS).toISOString() });
    expect(tokenStateOf(revoked, NOW)).toBe("revoked");
    expect(tokenStateCopy(revoked, NOW).label).toBe("Revoked");
    expect(tokenStateCopy(revoked, NOW).tone).toBe("bad");
  });

  it("never labels a revoked token Active even when it has no expiry", () => {
    expect(tokenStateCopy(row({ revokedAt: new Date(NOW).toISOString() }), NOW).label).not.toBe("Active");
  });

  it("reads a past expiry as expired, distinct from revoked", () => {
    const expired = row({ expiresAt: new Date(NOW - DAY_MS).toISOString() });
    expect(tokenStateOf(expired, NOW)).toBe("expired");
    expect(tokenStateCopy(expired, NOW).label).toBe("Expired");
  });

  it("flags a token inside the warning window and leaves a later one live", () => {
    const soon = row({ expiresAt: new Date(NOW + 3 * DAY_MS).toISOString() });
    const calm = row({ expiresAt: new Date(NOW + (EXPIRING_SOON_DAYS + 30) * DAY_MS).toISOString() });
    expect(tokenStateOf(soon, NOW)).toBe("expiring");
    expect(tokenStateCopy(soon, NOW).label).toBe("Expires soon");
    expect(tokenStateOf(calm, NOW)).toBe("live");
    expect(tokenStateCopy(calm, NOW).label).toBe("Active");
  });

  it("keeps revocation ahead of expiry when both apply", () => {
    expect(tokenStateOf(row({
      revokedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
      expiresAt: new Date(NOW - DAY_MS).toISOString(),
    }), NOW)).toBe("revoked");
  });

  it("treats a token with no expiry as live", () => {
    expect(tokenStateOf(row(), NOW)).toBe("live");
    expect(formatTokenDay(null)).toBe("No expiry");
  });

  it("survives an unparseable expiry instead of presenting it as live", () => {
    expect(tokenStateOf(row({ expiresAt: "not-a-date" }), NOW)).toBe("expired");
  });

  it("counts the ledger so a capped surface can state real numbers", () => {
    const summary = tokenSummary([
      row({ id: "a" }),
      row({ id: "b", expiresAt: new Date(NOW + 2 * DAY_MS).toISOString() }),
      row({ id: "c", revokedAt: new Date(NOW - DAY_MS).toISOString() }),
      row({ id: "d", expiresAt: new Date(NOW - DAY_MS).toISOString() }),
    ], NOW);
    expect(summary).toEqual({ total: 4, usable: 2, expiringSoon: 1, revoked: 1, expired: 1 });
  });

  it("labels a row by name and prefix, never by anything secret", () => {
    expect(tokenRowLabel(row())).toBe("Reports sync · pos_ab12cd34");
  });

  it("renders expiry as a stable UTC day", () => {
    expect(formatTokenDay("2026-11-02T13:45:00.000Z")).toBe("2026-11-02");
  });

  it("projects a server row down to the fields the list may show", () => {
    const projected = projectTokenRow({
      id: "tok_9", name: "Kiosk", prefix: "pos_00112233", scopes: ["catalog:read"],
      revokedAt: null, expiresAt: undefined, secret: "pos_00112233_deadbeef", lastUsedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(projected).toEqual({
      id: "tok_9", name: "Kiosk", prefix: "pos_00112233", scopes: ["catalog:read"],
      revokedAt: null, expiresAt: null,
    });
    expect(JSON.stringify(projected)).not.toContain("deadbeef");
  });

  it("normalises a Date-valued instant coming back from the driver", () => {
    expect(projectTokenRow({
      id: "t", name: "n", prefix: "p", scopes: [],
      revokedAt: new Date(NOW), expiresAt: new Date(NOW + DAY_MS),
    })).toEqual({
      id: "t", name: "n", prefix: "p", scopes: [],
      revokedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + DAY_MS).toISOString(),
    });
  });
});

describe("scope vocabulary", () => {
  it("offers exactly the scopes the server schema registers", () => {
    // Mirrors TOKEN_SCOPES in packages/validation/src/billing.schema.ts.
    expect(API_TOKEN_SCOPES).toEqual([
      "sales:read", "catalog:read", "catalog:write", "reports:read", "inventory:read",
    ]);
  });

  it("names every offered scope for the form", () => {
    for (const scope of API_TOKEN_SCOPES) {
      expect(scopeLabel(scope)).not.toBe(scope);
      expect(scopeLabel(scope).length).toBeGreaterThan(0);
    }
    expect(scopeLabel("unknown:thing")).toBe("unknown:thing");
  });
});

describe("create-form validation mirrors apiTokenCreateSchema", () => {
  it("requires a name", () => {
    expect(validateApiTokenDraft(draft({ name: "" }), NOW).name).toBeTruthy();
    expect(validateApiTokenDraft(draft({ name: "   " }), NOW).name).toBeTruthy();
  });

  it("accepts a name at the server limit and rejects one past it", () => {
    expect(validateApiTokenDraft(draft({ name: "n".repeat(TOKEN_NAME_MAX) }), NOW)).toEqual({});
    expect(validateApiTokenDraft(draft({ name: "n".repeat(TOKEN_NAME_MAX + 1) }), NOW).name).toBeTruthy();
  });

  it("refuses a draft with zero scopes", () => {
    expect(validateApiTokenDraft(draft({ scopes: [] }), NOW).scopes).toBeTruthy();
  });

  it("refuses a scope the server does not know", () => {
    expect(validateApiTokenDraft(draft({ scopes: ["sales:write"] }), NOW).scopes).toBeTruthy();
  });

  it("accepts a draft built only from registered scopes", () => {
    expect(validateApiTokenDraft(draft({ scopes: ["sales:read", "inventory:read"] }), NOW)).toEqual({});
  });

  it("refuses an expiry that is not in the future", () => {
    expect(validateApiTokenDraft(draft({ expiresAt: "2020-01-01T09:00" }), NOW).expiresAt).toBeTruthy();
  });

  it("refuses garbage in the expiry field", () => {
    expect(validateApiTokenDraft(draft({ expiresAt: "next tuesday" }), NOW).expiresAt).toBeTruthy();
  });

  it("treats a blank expiry as no expiry", () => {
    expect(validateApiTokenDraft(draft({ expiresAt: "" }), NOW)).toEqual({});
  });
});

describe("expiry wire format", () => {
  it("emits the UTC designator the server datetime check demands", () => {
    // z.string().datetime() rejects "2026-11-02T14:30", rejects a +08:00
    // offset, and accepts only the Z form, so the client must convert.
    expect(apiExpiryInstant("2026-11-02T14:30")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(apiExpiryInstant("2026-11-02T14:30")!)).toBe(Date.parse("2026-11-02T14:30:00"));
  });

  it("returns null for a value that is not an instant", () => {
    expect(apiExpiryInstant("")).toBeNull();
    expect(apiExpiryInstant("next tuesday")).toBeNull();
  });

  it("omits expiresAt entirely rather than sending null", () => {
    // expiresAt is .optional() on the server, so null fails VALIDATION.
    const body = createTokenBody(draft(), NOW)!;
    expect(Object.prototype.hasOwnProperty.call(body, "expiresAt")).toBe(false);
    expect(body).toEqual({ name: "Nightly export", scopes: ["sales:read"] });
  });

  it("trims the name and dedupes scopes before sending", () => {
    expect(createTokenBody(draft({ name: "  Nightly export  ", scopes: ["sales:read", "sales:read"] }), NOW))
      .toEqual({ name: "Nightly export", scopes: ["sales:read"] });
  });

  it("sends the converted expiry when one was chosen", () => {
    expect(createTokenBody(draft({ expiresAt: "2026-11-02T14:30" }), NOW)).toEqual({
      name: "Nightly export",
      scopes: ["sales:read"],
      expiresAt: apiExpiryInstant("2026-11-02T14:30"),
    });
  });

  it("refuses to build a body the server would reject", () => {
    expect(createTokenBody(draft({ scopes: [] }), NOW)).toBeNull();
  });
});

describe("token writes", () => {
  it("sends no request when the draft has zero scopes", async () => {
    const { api, calls } = writer();
    const result = await submitApiToken(draft({ scopes: [] }), api, NOW);
    expect(result.kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  it("sends no request when the name is blank", async () => {
    const { api, calls } = writer();
    expect((await submitApiToken(draft({ name: "" }), api, NOW)).kind).toBe("invalid");
    expect(calls).toHaveLength(0);
  });

  it("fetches a CSRF token before minting and posts the schema-shaped body", async () => {
    const minted = { id: "tok_5", prefix: "pos_ffeeddcc", secret: "pos_ffeeddcc_9a9b", scopes: ["sales:read"] };
    const { api, calls } = writer({ "/api/v1/apitokens": minted });
    const result = await submitApiToken(draft({ name: "Nightly export" }), api, NOW);
    expect(calls[0]!.path).toBe("/api/v1/auth/csrf");
    expect(calls[1]!.path).toBe("/api/v1/apitokens");
    expect(calls[1]!.opts?.csrfToken).toBe("csrf-abc");
    expect(calls[1]!.opts?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.opts?.init?.body))).toEqual({ name: "Nightly export", scopes: ["sales:read"] });
    expect(result).toEqual({ kind: "created", token: minted });
  });

  it("carries the chosen expiry through to the mint body", async () => {
    const { api, calls } = writer({ "/api/v1/apitokens": { id: "t", prefix: "p", secret: "s", scopes: [] } });
    await submitApiToken(draft({ expiresAt: "2026-11-02T14:30" }), api, NOW);
    expect(JSON.parse(String(calls[1]!.opts?.init?.body))).toEqual({
      name: "Nightly export",
      scopes: ["sales:read"],
      expiresAt: apiExpiryInstant("2026-11-02T14:30"),
    });
  });

  it("propagates a PLAN_LIMIT rejection so the page can name the plan gate", async () => {
    const blocked = new ApiError("PLAN_LIMIT", "Token mint failed", "corr-1", 402, { feature: ["api"], plan: ["pro"] });
    const calls: string[] = [];
    const api: ApiTokenWriter = async <T>(path: string): Promise<T> => {
      calls.push(path);
      if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf-abc" } as T;
      throw blocked;
    };
    await expect(submitApiToken(draft(), api, NOW)).rejects.toMatchObject({ code: "PLAN_LIMIT", status: 402 });
    expect(calls).toEqual(["/api/v1/auth/csrf", "/api/v1/apitokens"]);
  });

  it("revokes through a CSRF-guarded POST on the revoke path", async () => {
    const { api, calls } = writer();
    await revokeApiToken("tok_7", api);
    expect(calls.map((call) => call.path)).toEqual(["/api/v1/auth/csrf", "/api/v1/apitokens/tok_7/revoke"]);
    expect(calls[1]!.opts?.csrfToken).toBe("csrf-abc");
    expect(calls[1]!.opts?.init?.method).toBe("POST");
  });

  it("escapes a token id used in a revoke path", async () => {
    const { api, calls } = writer();
    await revokeApiToken("tok/../../x", api);
    expect(calls[1]!.path).toBe("/api/v1/apitokens/tok%2F..%2F..%2Fx/revoke");
  });
});

describe("revoke confirmation copy", () => {
  it("names the token being killed and states the effect", () => {
    const copy = revokeConfirmation(row({ name: "Reports sync", prefix: "pos_ab12cd34" }));
    expect(copy.confirmLabel).toBe("Revoke token");
    expect(copy.description).toContain("Reports sync");
    expect(copy.description).toContain("pos_ab12cd34");
    expect(copy.details).toMatch(/immediately/i);
  });
});
