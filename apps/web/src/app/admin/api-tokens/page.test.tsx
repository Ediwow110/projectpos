import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../lib/api";
import type { ApiTokenRow } from "../../../lib/api-tokens";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-10-22T00:00:00.000Z");
const SECRET = "pos_ffeeddcc_0123456789abcdef";

const fixture = vi.hoisted(() => ({
  rows: [] as unknown[],
  query: "ready" as "ready" | "loading" | "empty" | "error" | "forbidden",
}));

const ROWS: Record<string, ApiTokenRow> = {
  live: {
    id: "tok_live", name: "Nightly export", prefix: "pos_aaaa1111", scopes: ["sales:read", "reports:read"],
    revokedAt: null, expiresAt: new Date(NOW + 90 * DAY_MS).toISOString(),
  },
  never: {
    id: "tok_never", name: "Warehouse bridge", prefix: "pos_bbbb2222", scopes: ["inventory:read"],
    revokedAt: null, expiresAt: null,
  },
  expiring: {
    id: "tok_expiring", name: "Expo importer", prefix: "pos_cccc3333", scopes: ["catalog:write"],
    revokedAt: null, expiresAt: new Date(NOW + 3 * DAY_MS).toISOString(),
  },
  expired: {
    id: "tok_expired", name: "Retired kiosk", prefix: "pos_dddd4444", scopes: ["catalog:read"],
    revokedAt: null, expiresAt: new Date(NOW - 2 * DAY_MS).toISOString(),
  },
  revoked: {
    id: "tok_revoked", name: "Leaked key", prefix: "pos_eeee5555", scopes: ["sales:read"],
    revokedAt: new Date(NOW - DAY_MS).toISOString(), expiresAt: null,
  },
};

vi.mock("../../../components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === "me") {
      return { data: { role: "owner", businessName: "QA Business", permissions: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    }
    if (fixture.query === "loading") return { data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() };
    if (fixture.query === "error") return { data: undefined, isLoading: false, isError: true, error: new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0), refetch: vi.fn() };
    if (fixture.query === "forbidden") return { data: undefined, isLoading: false, isError: true, error: new ApiError("FORBIDDEN", "Token management requires owner or manager role", "", 403), refetch: vi.fn() };
    if (fixture.query === "empty") return { data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
    return { data: { items: fixture.rows }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));

import ApiTokensPage, { PlanGateNotice, SecretShowOnce } from "./page";

Object.assign(globalThis, { React });

const minted = { id: "tok_new", prefix: "pos_ffeeddcc", secret: SECRET, scopes: ["sales:read"] };

beforeEach(() => {
  fixture.rows = [];
  fixture.query = "ready";
});

describe("API token ledger states", () => {
  it("presents a revoked token as revoked and never as active", () => {
    fixture.rows = [ROWS.revoked];
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("Revoked");
    expect(html).not.toContain("Active");
    expect(html).toContain("Leaked key");
  });

  it("keeps an expired token out of the active wording", () => {
    fixture.rows = [ROWS.expired];
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("Expired");
    expect(html).not.toContain("Active");
    expect(html).not.toContain("Expires soon");
  });

  it("distinguishes an expiring token from a live one", () => {
    fixture.rows = [ROWS.expiring];
    const expiring = renderToStaticMarkup(<ApiTokensPage />);
    fixture.rows = [ROWS.live];
    const live = renderToStaticMarkup(<ApiTokensPage />);

    expect(expiring).toContain("Expires soon");
    expect(expiring).not.toContain("Active");
    expect(live).toContain("Active");
    expect(live).not.toContain("Expires soon");
  });

  it("states plainly when a token never expires", () => {
    fixture.rows = [ROWS.never];
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("No expiry");
  });

  it("claims nothing when the ledger is genuinely empty", () => {
    fixture.query = "empty";
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("No API tokens yet.");
  });

  it("shows a retryable error instead of an empty ledger when the lookup failed", () => {
    fixture.query = "error";
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No API tokens yet.");
  });

  it("reads a server refusal as a refusal, not as an empty ledger", () => {
    fixture.query = "forbidden";
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("owner or manager");
    expect(html).not.toContain("No API tokens yet.");
  });

  it("never puts a secret field from the payload onto the ledger rows", () => {
    fixture.rows = [{ ...ROWS.live, secret: SECRET, tokenHash: "deadbeef" }];
    const html = renderToStaticMarkup(<ApiTokensPage />);

    expect(html).toContain("pos_aaaa1111");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("deadbeef");
  });
});

describe("show-once secret panel", () => {
  it("reveals the minted secret with an explicit cannot-retrieve-again warning", () => {
    const html = renderToStaticMarkup(
      <SecretShowOnce token={minted} copyState="idle" onCopy={() => undefined} onDismiss={() => undefined} />,
    );

    expect(html).toContain(SECRET);
    expect(html).toContain("pos_ffeeddcc");
    expect(html).toMatch(/once/i);
    expect(html).toMatch(/cannot be retrieved again/i);
    expect(html).toContain("Copy token");
  });

  it("offers an honest failure path when the clipboard refuses", () => {
    const copied = renderToStaticMarkup(
      <SecretShowOnce token={minted} copyState="copied" onCopy={() => undefined} onDismiss={() => undefined} />,
    );
    const failed = renderToStaticMarkup(
      <SecretShowOnce token={minted} copyState="failed" onCopy={() => undefined} onDismiss={() => undefined} />,
    );

    expect(copied).toMatch(/copied/i);
    expect(failed).toMatch(/couldn.?t copy/i);
    expect(failed).toMatch(/copy it manually/i);
  });

  it("keeps the minted secret out of storage, URLs, and the ledger markup", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexdb/i);
    expect(source).not.toMatch(/router\.push\([^)]*secret|window\.location[^)]*secret/i);
    fixture.rows = [ROWS.live];
    expect(renderToStaticMarkup(<ApiTokensPage />)).not.toContain(SECRET);
  });
});

describe("create form contract", () => {
  it("cannot be submitted with zero scopes selected", () => {
    fixture.rows = [];
    const html = renderToStaticMarkup(<ApiTokensPage />);
    const createButton = /<button[^>]*>Create token<\/button>/.exec(html);

    expect(html).toContain("Select at least one scope");
    expect(createButton, "the create button is missing from the form").not.toBeNull();
    expect(createButton?.[0]).toContain("disabled=\"\"");
  });

  it("offers exactly the server-registered scopes as checkboxes", () => {
    fixture.rows = [];
    const html = renderToStaticMarkup(<ApiTokensPage />);

    for (const scope of ["sales:read", "catalog:read", "catalog:write", "reports:read", "inventory:read"]) {
      expect(html).toContain(`value="${scope}"`);
    }
    expect(html).not.toContain("value=\"users:write\"");
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
  });

  it("gates on the server answer instead of guessing from a role-name list", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toMatch(/role\s*===\s*"owner"|role\s*===\s*"manager"|\[\s*"owner",\s*"manager"\s*\]/);
    expect(source).toContain("/api/v1/apitokens");
  });
});

describe("plan gate copy", () => {
  it("names the missing entitlement and the plan instead of a bare failure", () => {
    const error = new ApiError("PLAN_LIMIT", "Token mint failed", "corr-1", 402, { feature: ["api"], plan: ["pro"] });
    const html = renderToStaticMarkup(<PlanGateNotice error={error} />);

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Public API is not included in the Pro plan.");
    expect(html).toContain("Enterprise");
    expect(html).not.toContain("Token mint failed");
  });

  it("stays out of the way for errors that are not a plan limit", () => {
    const error = new ApiError("VALIDATION", "Invalid token payload", "corr-2", 400);

    expect(renderToStaticMarkup(<PlanGateNotice error={error} />)).toBe("");
  });
});
