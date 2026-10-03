import { describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../src/lib/api";

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
      status: 401,
      code: "TENANT_REQUIRED",
      message: "x",
      correlationId: "r1",
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

  it("normalizes an HTML service-unavailable response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => "text/html" },
        text: async () => "<html>Application loading...</html>",
      }),
    );

    const request = apiFetch("/readyz");
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    vi.unstubAllGlobals();
  });

  it.each([
    [502, "upstream unavailable"],
    [504, ""],
  ])("normalizes non-JSON HTTP %s responses without leaking the body", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => body,
      }),
    );

    await expect(apiFetch("/readyz")).rejects.toMatchObject({
      status,
      code: "SERVICE_UNAVAILABLE",
      message: "The service is temporarily unavailable.",
    });
    vi.unstubAllGlobals();
  });

  it("returns valid JSON success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      }),
    );
    await expect(apiFetch<{ ok: boolean }>("/readyz")).resolves.toEqual({ ok: true });
    vi.unstubAllGlobals();
  });

  it("normalizes malformed success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "not-json",
      }),
    );
    await expect(apiFetch("/readyz")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
    vi.unstubAllGlobals();
  });
});
