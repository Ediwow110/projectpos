import { describe, expect, it } from "vitest";
import { isSessionExpired, isSessionRevoked } from "../src/session";

describe("PLAN 7 session guards", () => {
  it("expires past date", () => {
    expect(isSessionExpired(new Date("2020-01-01T00:00:00.000Z"))).toBe(true);
  });
  it("keeps future session", () => {
    expect(isSessionExpired(new Date(Date.now() + 3600_000))).toBe(false);
  });
  it("flags revoked session", () => {
    expect(isSessionRevoked(new Date())).toBe(true);
  });
});
