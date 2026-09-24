import { describe, expect, it } from "vitest";
import { bucketAllowed } from "./api-token.guard";
import { scopesSatisfied } from "./scopes.decorator";
import { hashTokenSecret, mintTokenSecret } from "./nest/apitoken.service";

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
  it("caps buckets at 60 per minute sliding", () => {
    const now = 1_000_000;
    expect(bucketAllowed([], now)).toBe(true);
    expect(bucketAllowed(Array(60).fill(now), now)).toBe(false);
    expect(bucketAllowed(Array(59).fill(now), now)).toBe(true);
    expect(bucketAllowed(Array(60).fill(now - 60_001), now)).toBe(true);
  });
});
