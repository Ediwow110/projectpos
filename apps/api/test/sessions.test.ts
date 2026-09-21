import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashToken,
  buildSessionRecord,
  isReAuthFresh,
} from "../src/auth/sessions";

describe("session tokens", () => {
  it("creates unique opaque tokens", () => {
    expect(createSessionToken()).not.toBe(createSessionToken());
  });
  it("hashes deterministically with sha256 hex", () => {
    const t = createSessionToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("builds a 30-day session record", () => {
    const rec = buildSessionRecord({ userId: "u1", businessId: "b1", ip: null, userAgent: null });
    expect(rec.expiresAt.getTime() - rec.createdAt.getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(rec.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("flags stale re-auth", () => {
    expect(isReAuthFresh(new Date(Date.now() - 16 * 60_000))).toBe(false);
    expect(isReAuthFresh(new Date())).toBe(true);
  });
});
