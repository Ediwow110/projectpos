import { describe, expect, it } from "vitest";
import { createResetToken, consumeResetToken } from "../src/auth/reset-tokens";

describe("single-use reset tokens", () => {
  it("creates a 1-hour token", () => {
    const rec = createResetToken({ userId: "u1", requestId: "r1", ip: null });
    expect(rec.expiresAt.getTime() - rec.createdAt.getTime()).toBe(3600_000);
    expect(rec.usedAt).toBeNull();
  });
  it("consumes a fresh token once", () => {
    const rec = createResetToken({ userId: "u1", requestId: "r1", ip: null });
    expect(() => consumeResetToken(rec, new Date())).not.toThrow();
    expect(() => consumeResetToken({ ...rec, usedAt: new Date() }, new Date())).toThrow(
      "AUTH_TOKEN_USED",
    );
  });
  it("rejects expired token", () => {
    const rec = createResetToken({ userId: "u1", requestId: "r1", ip: null });
    const past = new Date(rec.expiresAt.getTime() + 1000);
    expect(() => consumeResetToken(rec, past)).toThrow("AUTH_TOKEN_EXPIRED");
  });
});
