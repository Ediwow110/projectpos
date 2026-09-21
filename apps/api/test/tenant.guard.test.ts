import { describe, expect, it } from "vitest";
import { authorize } from "../src/tenant.guard";

describe("PLAN FR-TENANT-01 manipulated tenant rejected", () => {
  it("rejects client tenantId differing from membership tenant", () => {
    expect(() => authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_2" })).toThrow();
  });
  it("rejects expired session", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });
  it("rejects revoked session", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        revokedAt: new Date(),
      }),
    ).toThrow();
  });
  it("accepts valid membership-derived tenant", () => {
    expect(authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_1" })).toBe("biz_1");
  });
});
