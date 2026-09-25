import { describe, expect, it } from "vitest";
import { scopesSatisfied } from "./scopes.decorator";
import { hashTokenSecret, mintTokenSecret } from "./nest/apitoken.service";
import { createRateLimiter } from "../common/rate-limit";
import { TOKEN_RATE_LIMIT, TOKEN_RATE_WINDOW_MS } from "./api-token.guard";

describe("phase10 token primitives", () => {
  it("mints prefixed secrets hashed deterministically", async () => {
    const { secret, prefix } = mintTokenSecret();
    expect(prefix).toMatch(/^pos_[0-9a-f]{8}$/);
    expect(secret.startsWith(`${prefix}_`)).toBe(true);
    expect(hashTokenSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTokenSecret(secret)).toBe(hashTokenSecret(secret));
    expect(hashTokenSecret(`${secret}x`)).not.toBe(hashTokenSecret(secret));
  });
  it("matches scopes by subset", () => {
    expect(scopesSatisfied([], ["sales:read"])).toBe(true);
    expect(scopesSatisfied(["sales:read"], ["sales:read", "reports:read"])).toBe(true);
    expect(scopesSatisfied(["reports:read"], ["sales:read"])).toBe(false);
  });
  it("caps tokens at 60 per minute sliding through the shared limiter", async () => {
    const limiter = createRateLimiter(TOKEN_RATE_LIMIT, TOKEN_RATE_WINDOW_MS);
    const now = 1_000_000;
    for (let i = 0; i < 60; i++) {
      expect(await limiter.hit(`tok`, now + i)).toBe(false);
    }
    expect(await limiter.hit("tok", now + 60)).toBe(true);
    // Sliding window: hits older than the window stop counting.
    expect(await limiter.hit("tok", now + TOKEN_RATE_WINDOW_MS + 1)).toBe(false);
  });
});
