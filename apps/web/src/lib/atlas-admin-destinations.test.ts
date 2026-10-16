import { describe, expect, it } from "vitest";
import { atlasAdminDestinationsForRole } from "./atlas-admin-destinations";

describe("Atlas V4 role-specific administration", () => {
  it("reserves owner-only account and staff controls for owners", () => {
    const owner = atlasAdminDestinationsForRole("owner").map((item) => item.href);
    expect(owner).toContain("/admin/owner-controls");
    expect(owner).toContain("/team");
    expect(owner).toContain("/admin/support");
    expect(owner).toContain("/admin/online-ordering");
  });
  it("never advertises owner-only routes to managers", () => {
    const manager = atlasAdminDestinationsForRole("manager").map((item) => item.href);
    expect(manager).toContain("/customer-concerns");
    expect(manager).toContain("/shifts");
    expect(manager).toContain("/inventory");
    expect(manager).not.toContain("/team");
    expect(manager).not.toContain("/admin/owner-controls");
    expect(manager).not.toContain("/admin/support");
    expect(manager).not.toContain("/admin/online-ordering");
  });
  it("shows no privileged administration destinations to cashiers or inventory users", () => {
    expect(atlasAdminDestinationsForRole("cashier")).toEqual([]);
    expect(atlasAdminDestinationsForRole("inventory")).toEqual([]);
  });
});
