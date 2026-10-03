import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../common/rate-limit";
import { RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS } from "./auth.controller";

describe("password reset resend policy", () => {
  it("allows one request per IP per 60-second cooldown window", async () => {
    const limiter = createRateLimiter(RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS);
    expect(await limiter.hit("reset-ip", 1_000)).toBe(false);
    expect(await limiter.hit("reset-ip", 2_000)).toBe(true);
    expect(await limiter.hit("reset-ip", 63_001)).toBe(false);
  });
});
