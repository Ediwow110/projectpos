import { describe, expect, it } from "vitest";
import { mutateProcurementRequest } from "./procurement-mutation";

describe("procurement detail mutations", () => {
  it("rejects offline before CSRF/network requests and preserves caller error text", async () => {
    let called = false;
    await expect(mutateProcurementRequest({
      online: false, path: "/api/v1/suppliers/x", init: { method: "PATCH" },
      offlineMessage: "Purchase orders require an internet connection.",
      api: async () => { called = true; throw new Error("unreachable"); },
    })).rejects.toMatchObject({ code: "NETWORK_ERROR", message: "Purchase orders require an internet connection." });
    expect(called).toBe(false);
  });
  it("preserves CSRF fetch and mutation request ordering, body and headers", async () => {
    const calls: Array<{ path: string; options?: unknown }> = [];
    await mutateProcurementRequest({
      online: true, path: "/api/v1/purchase-orders/po-1/order",
      init: { method: "POST", headers: { "Idempotency-Key": "once" }, body: '{"expectedVersion":2}' },
      offlineMessage: "Offline.",
      api: async <T>(path: string, options?: unknown) => {
        calls.push({ path, options });
        return (path === "/api/v1/auth/csrf" ? { csrfToken: "csrf-123" } : {}) as T;
      },
    });
    expect(calls).toEqual([
      { path: "/api/v1/auth/csrf", options: undefined },
      { path: "/api/v1/purchase-orders/po-1/order", options: {
        csrfToken: "csrf-123", init: { method: "POST", headers: { "Idempotency-Key": "once" }, body: '{"expectedVersion":2}' },
      } },
    ]);
  });
});
