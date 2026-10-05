import { describe, expect, it } from "vitest";
import { voidAuditLabel } from "./sales";

describe("sale void presentation", () => {
  it("shows the retained reason and timestamp only for voided sales", () => {
    expect(voidAuditLabel({
      status: "VOIDED",
      voidReason: "Duplicate draft",
      voidedAt: "2026-10-06T10:00:00.000Z",
    })).toContain("Duplicate draft");
    expect(voidAuditLabel({ status: "COMPLETED", voidReason: null, voidedAt: null })).toBeNull();
  });
});
