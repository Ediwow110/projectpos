import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { loginWithReadiness } from "./login-flow";

describe("login flow", () => {
  it("waits for readiness, then sends one login request", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true });
    const login = vi.fn().mockResolvedValue({ userId: "u1", businessId: "b1" });
    const sleep = vi.fn();

    await expect(loginWithReadiness({ probe, login, sleep })).resolves.toMatchObject({ userId: "u1" });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("retries readiness but never retries the login POST", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("SERVICE_UNAVAILABLE", "starting", "", 503))
      .mockResolvedValueOnce({ ok: true });
    const login = vi.fn().mockResolvedValue({ userId: "u1", businessId: "b1" });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await loginWithReadiness({ probe, login, sleep });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("does not send login when readiness exhausts", async () => {
    const probe = vi.fn().mockRejectedValue(new ApiError("SERVICE_UNAVAILABLE", "starting", "", 503));
    const login = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(loginWithReadiness({ probe, login, sleep })).rejects.toMatchObject({ status: 503 });
    expect(login).not.toHaveBeenCalled();
  });

  it("does not repeat an ambiguous login POST failure", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true });
    const login = vi.fn().mockRejectedValue(new ApiError("NETWORK_ERROR", "offline", "", 0));

    await expect(loginWithReadiness({ probe, login })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(login).toHaveBeenCalledTimes(1);
  });
});
