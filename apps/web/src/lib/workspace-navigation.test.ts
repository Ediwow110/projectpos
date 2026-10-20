import { describe, expect, it } from "vitest";

import { flattenedWorkspaceNavigation, workspaceNavigationForRole } from "./workspace-navigation";

describe("workspace navigation", () => {
  it("makes existing owner operations discoverable", () => {
    const hrefs = workspaceNavigationForRole("owner")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toEqual(expect.arrayContaining([
      "/orders",
      "/categories",
      "/registers",
      "/expenses",
      "/transfers",
      "/team",
      "/admin/owner-controls",
      "/devices",
      "/printers",
      "/admin",
      "/sync",
      "/suppliers",
      "/purchase-orders",
      "/supplier-returns",
      "/admin/loyalty",
      "/admin/online-ordering",
    ]));
  });

  it("keeps owner-only team management out of cashier navigation", () => {
    const hrefs = workspaceNavigationForRole("cashier")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/pos");
    expect(hrefs).toContain("/receipts/lookup");
    expect(hrefs).toContain("/orders");
    expect(hrefs).toContain("/shifts");
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/admin/owner-controls");
    expect(hrefs).not.toContain("/printers");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/expenses");
    expect(hrefs).not.toContain("/transfers");
    expect(hrefs).not.toContain("/suppliers");
    expect(hrefs).not.toContain("/purchase-orders");
    expect(hrefs).not.toContain("/supplier-returns");
    expect(hrefs).not.toContain("/admin/loyalty");
    expect(hrefs).not.toContain("/admin/online-ordering");
    expect(hrefs).not.toContain("/admin/owner-controls");
  });

  it.each(["manager", "inventory"])("shows Orders but keeps online-ordering settings out of %s navigation", (role) => {
    const hrefs = flattenedWorkspaceNavigation(role).map((item) => item.href);
    expect(hrefs).toContain("/orders");
    expect(hrefs).not.toContain("/admin/online-ordering");
  });

  it.each(["owner", "manager", "cashier", "inventory"])("does not duplicate routes for %s", (role) => {
    const hrefs = flattenedWorkspaceNavigation(role).map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("keeps the business setup review surface owner-only in the shared workspace navigation", () => {
    const ownerItems = workspaceNavigationForRole("owner").flatMap((group) => group.items);
    const ownerSetup = ownerItems.filter((item) => item.href === "/onboarding");

    expect(ownerSetup).toHaveLength(1);
    expect(ownerSetup[0].label).toBe("Business setup");

    for (const role of ["manager", "cashier", "inventory"]) {
      const hrefs = flattenedWorkspaceNavigation(role).map((item) => item.href);
      expect(hrefs, `${role} must not be offered the business setup surface`).not.toContain("/onboarding");
    }
  });
});
