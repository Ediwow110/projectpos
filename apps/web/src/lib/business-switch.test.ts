import { describe, expect, it } from "vitest";

import { ApiError } from "./api";

function item(businessId: string, name: string, active = false) {
  return { businessId, name, role: "manager", active };
}

describe("business switching", () => {
  it("puts the current business first without losing the others", async () => {
    const { orderedBusinesses } = await import("./business-switch");
    const items = [item("b1", "Alpha"), item("b2", "Beta", true), item("b3", "Gamma")];
    expect(orderedBusinesses(items).map((row) => row.businessId)).toEqual(["b2", "b1", "b3"]);
  });

  it("explains a refusal caused by the membership disappearing", async () => {
    const { switchFailureCopy } = await import("./business-switch");
    expect(switchFailureCopy(new ApiError("TENANT_MISMATCH", "no", "", 403))).toContain("no longer");
    expect(switchFailureCopy(new ApiError("SESSION_REVOKED", "no", "", 401))).toContain("Sign in");
  });

  it("keeps any other server code visible instead of a generic failure", async () => {
    const { switchFailureCopy } = await import("./business-switch");
    expect(switchFailureCopy(new ApiError("FORBIDDEN", "No access", "", 403))).toBe("FORBIDDEN: No access");
    expect(switchFailureCopy(new ApiError("PLAN_LIMIT", "Plan limit reached", "", 402))).toContain("not included in the");
    expect(switchFailureCopy(new Error("boom"))).toBe("The workspace could not be switched.");
  });
});
