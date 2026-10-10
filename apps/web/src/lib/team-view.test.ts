import { describe, expect, it } from "vitest";

import { canDeactivateMember, canManageApprovalPin, teamRoleLabel, type TeamMemberRow } from "./team-view";

const member = (overrides: Partial<TeamMemberRow> = {}): TeamMemberRow => ({
  id: "membership_1",
  userId: "user_2",
  name: "Jamie Cruz",
  email: "jamie@example.com",
  role: "cashier",
  deactivatedAt: null,
  approvalPinSet: false,
  ...overrides,
});

describe("team view helpers", () => {
  it("formats operational roles for display", () => {
    expect(teamRoleLabel("manager")).toBe("Manager");
    expect(teamRoleLabel("cashier")).toBe("Cashier");
    expect(teamRoleLabel("inventory")).toBe("Inventory");
    expect(teamRoleLabel("owner")).toBe("Owner");
  });

  it("does not present owner or self-deactivation as a normal action", () => {
    expect(canDeactivateMember("user_1", member({ role: "owner" }))).toBe(false);
    expect(canDeactivateMember("user_2", member())).toBe(false);
  });

  it("allows deactivation of another active staff membership", () => {
    expect(canDeactivateMember("user_1", member())).toBe(true);
    expect(canDeactivateMember("user_1", member({ deactivatedAt: "2026-09-30T00:00:00.000Z" }))).toBe(false);
  });

  it("offers approval PIN management only for active owner and manager memberships", () => {
    expect(canManageApprovalPin(member({ role: "owner" }))).toBe(true);
    expect(canManageApprovalPin(member({ role: "manager" }))).toBe(true);
    expect(canManageApprovalPin(member({ role: "cashier" }))).toBe(false);
    expect(canManageApprovalPin(member({ role: "inventory" }))).toBe(false);
    expect(canManageApprovalPin(member({ role: "manager", deactivatedAt: "2026-09-30T00:00:00.000Z" }))).toBe(false);
    expect(canManageApprovalPin(member({ assignments: [{ id: "a1", role: "manager", assignmentType: "TEMPORARY", branchId: null, startsAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", assignedBy: "owner", assignedAt: "2026-01-01T00:00:00.000Z", assignmentReason: "coverage", revokedAt: null, revokedBy: null, revocationReason: null }] }))).toBe(true);
  });
});
