import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "../src/lib/api";

describe("web api wrapper", () => {
  it("sends credentials and csrf header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/v1/me", { csrfToken: "csrf_1" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf_1");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    vi.unstubAllGlobals();
  });
  it("throws ApiError with code on error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: "TENANT_REQUIRED", message: "x", correlationId: "r1" }),
      }),
    );
    await expect(apiFetch("/api/v1/me", {})).rejects.toMatchObject({
      code: "TENANT_REQUIRED",
    });
    vi.unstubAllGlobals();
  });
  it("normalizes transport failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiFetch("/api/v1/me")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
    });
    vi.unstubAllGlobals();
  });
  it("normalizes request timeouts", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    await expect(apiFetch("/api/v1/me", { timeoutMs: 5 })).rejects.toMatchObject({
      code: "NETWORK_TIMEOUT",
      status: 0,
    });
    vi.unstubAllGlobals();
  });
});
