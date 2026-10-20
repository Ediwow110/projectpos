import { describe, expect, it } from "vitest";
import { businessAdminDestinationsForRole } from "./admin-destinations";

describe("Business administration role destinations", () => {
  it("keeps owner-only controls visible for the business owner", () => {
    const paths = businessAdminDestinationsForRole("owner").map((item) => item.href);
    expect(paths).toContain("/admin/owner-controls");
    expect(paths).toContain("/team");
  });

  it("does not advertise owner-only destinations to managers", () => {
    const paths = businessAdminDestinationsForRole("manager").map((item) => item.href);
    expect(paths).not.toContain("/admin/owner-controls");
    expect(paths).not.toContain("/team");
    expect(paths).toContain("/devices");
    expect(paths).toContain("/registers");
  });

  it("does not offer privileged admin links to cashier or inventory roles", () => {
    expect(businessAdminDestinationsForRole("cashier")).toEqual([]);
    expect(businessAdminDestinationsForRole("inventory")).toEqual([]);
  });
});
