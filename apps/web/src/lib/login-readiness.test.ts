import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { readinessDelay, waitForApiReady } from "./login-readiness";

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

  it("does not retry auth failures", async () => {
    const probe = vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", "no", "", 403));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForApiReady({ probe, sleep })).rejects.toMatchObject({ status: 403 });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
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
