import { describe, expect, it } from "vitest";
import { authorize } from "../apps/api/src/tenant.guard";
import { me } from "../apps/api/src/routes/me";
import { health } from "../apps/api/src/routes/health";
import { hasPermission } from "../packages/auth/src/permissions";

describe("PLAN Phase 0 exit", () => {
  it("authenticated scoped read passes", () => {
    const tenant = authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_1" });
    const res = me({ businessId: tenant, userId: "user_1" }, "req_1");
    expect(res.businessId).toBe("biz_1");
  });
  it("protected health requires tenant", () => {
    expect(() => health({ businessId: "" }, "req_1")).toThrow();
  });
  it("cross-tenant read blocked", () => {
    expect(() => authorize({ membershipBusinessId: "biz_1", claimedBusinessId: "biz_2" })).toThrow();
  });
  it("cross-tenant write blocked by scope check", () => {
    expect(hasPermission(["sale.refund"], "sale.refund", "biz_1", "biz_2")).toBe(false);
  });
  it("expired session mutation rejected", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toThrow();
  });
  it("revoked session mutation rejected", () => {
    expect(() =>
      authorize({
        membershipBusinessId: "biz_1",
        claimedBusinessId: "biz_1",
        revokedAt: new Date(),
      }),
    ).toThrow();
  });
  it("manipulated tenant id rejected", () => {
    expect(() => authorize({ membershipBusinessId: null, claimedBusinessId: "biz_9" })).toThrow();
  });
});
