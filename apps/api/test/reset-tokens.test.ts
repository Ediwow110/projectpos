import { describe, expect, it } from "vitest";
import { createResetToken, consumeResetToken } from "../src/auth/reset-tokens";
import { AuthService } from "../src/auth/nest/auth.service";
import { createMemoryDb } from "../src/common/memory.db";

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

  it("allows only one concurrent confirmation of the same token", async () => {
    const db = createMemoryDb();
    const auth = new AuthService(db);
    const email = `reset-race-${Date.now()}@example.com`;
    await auth.register(
      { ownerName: "Reset Race", email, password: "correct-horse-12", businessName: "Reset Race Store" },
      { requestId: "register-race", ip: null, userAgent: null },
    );
    const reset = await auth.requestReset(email, { requestId: "reset-race", ip: null });
    expect(reset.tokenForTest).toBeTruthy();

    const outcomes = await Promise.allSettled([
      auth.confirmReset(reset.tokenForTest!, "new-password-a-123", "confirm-a"),
      auth.confirmReset(reset.tokenForTest!, "new-password-b-123", "confirm-b"),
    ]);

    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toEqual(new Error("AUTH_TOKEN_USED"));
  });
});
