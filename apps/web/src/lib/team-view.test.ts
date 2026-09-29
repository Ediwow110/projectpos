import { describe, expect, it } from "vitest";

import { canDeactivateMember, teamRoleLabel, type TeamMemberRow } from "./team-view";

const member = (overrides: Partial<TeamMemberRow> = {}): TeamMemberRow => ({
  id: "membership_1",
  userId: "user_2",
  name: "Jamie Cruz",
  email: "jamie@example.com",
  role: "cashier",
  deactivatedAt: null,
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
});
