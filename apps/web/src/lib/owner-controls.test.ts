import { describe, expect, it } from "vitest";

import { canRevokeAccountSession, ownerControlSummary, revokeAccountSession } from "./owner-controls";

describe("owner control center", () => {
  it("summarizes real membership and active branch counts", () => {
    expect(ownerControlSummary(
      [{ role: "owner" }, { role: "cashier" }, { role: "manager" }, { role: "inventory" }],
      [{ isActive: true }, { isActive: false }, { isActive: true }],
    )).toEqual({ totalMembers: 4, staffMembers: 3, ownerSeats: 1, activeBranches: 2 });
  });

  it("protects the current account session from accidental revocation", () => {
    const session = { id: "s1", businessId: "b1", expiresAt: "2026-12-01T00:00:00Z", current: true };
    expect(canRevokeAccountSession(session)).toBe(false);
    expect(canRevokeAccountSession({ ...session, current: false })).toBe(true);
  });

  it("fetches a CSRF token before revoking a session", async () => {
    const calls: Array<{ path: string; token?: string; method?: string }> = [];
    const api = async <T>(path: string, options?: { csrfToken?: string; init?: RequestInit }): Promise<T> => {
      calls.push({ path, token: options?.csrfToken, method: options?.init?.method });
      return (path.endsWith("/csrf") ? { csrfToken: "token" } : { ok: true }) as T;
    };
    await revokeAccountSession("my session/1", api);
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", token: undefined, method: undefined },
      { path: "/api/v1/auth/sessions/my%20session%2F1", token: "token", method: "DELETE" },
    ]);
  });
});
