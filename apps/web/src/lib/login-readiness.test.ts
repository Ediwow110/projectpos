import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { isTransientReadinessError, readinessDelay, waitForApiReady } from "./login-readiness";

describe("login readiness", () => {
  it("returns immediately when the API is ready", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true });
    const sleep = vi.fn();

    await expect(waitForApiReady({ probe, sleep })).resolves.toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries transient readiness failures before allowing login", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("SERVICE_UNAVAILABLE", "starting", "", 503))
      .mockResolvedValueOnce({ ok: true });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForApiReady({ probe, sleep })).resolves.toEqual({ ok: true });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [422, "AUTH_INVALID_CREDENTIALS"],
    [400, "SERVICE_UNAVAILABLE"],
  ])("does not retry non-transient readiness failure %s", async (status, code) => {
    const probe = vi.fn().mockRejectedValue(new ApiError(code, "no", "", status));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForApiReady({ probe, sleep })).rejects.toMatchObject({ status, code });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not classify an invalid response as transient only because status is zero", () => {
    expect(isTransientReadinessError(new ApiError("INVALID_RESPONSE", "invalid", "", 0))).toBe(false);
  });

  it("does not retry an auth error hidden behind a transient HTTP status", () => {
    expect(isTransientReadinessError(new ApiError("AUTH_INVALID_CREDENTIALS", "invalid", "", 503))).toBe(false);
  });

  it("uses an explicit GET readiness probe by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(waitForApiReady()).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/readyz$/),
      expect.objectContaining({ method: "GET" }),
    );
    vi.unstubAllGlobals();
  });

  it("keeps a caller-supplied retry budget finite and capped", async () => {
    const probe = vi.fn().mockRejectedValue(new ApiError("SERVICE_UNAVAILABLE", "starting", "", 503));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForApiReady({ probe, sleep, maxRetries: Number.POSITIVE_INFINITY })).rejects.toMatchObject({ status: 503 });
    expect(probe).toHaveBeenCalledTimes(7);
    expect(sleep).toHaveBeenCalledTimes(6);
  });

  it("exhausts transient retries without an unbounded loop", async () => {
    const probe = vi.fn().mockRejectedValue(new ApiError("SERVICE_UNAVAILABLE", "starting", "", 503));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForApiReady({ probe, sleep })).rejects.toMatchObject({ status: 503 });
    expect(probe).toHaveBeenCalledTimes(7);
    expect(sleep).toHaveBeenCalledTimes(6);
  });

  it("caps readiness backoff", () => {
    expect(readinessDelay(0)).toBe(1000);
    expect(readinessDelay(3)).toBe(8000);
    expect(readinessDelay(10)).toBe(15000);
  });
});
