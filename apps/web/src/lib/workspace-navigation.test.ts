import { describe, expect, it } from "vitest";

import { flattenedWorkspaceNavigation, workspaceNavigationForRole } from "./workspace-navigation";

describe("workspace navigation", () => {
  it("makes existing owner operations discoverable", () => {
    const hrefs = workspaceNavigationForRole("owner")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toEqual(expect.arrayContaining([
      "/categories",
      "/registers",
      "/expenses",
      "/transfers",
      "/team",
      "/devices",
      "/printers",
      "/admin",
      "/sync",
      "/suppliers",
      "/purchase-orders",
      "/supplier-returns",
      "/admin/loyalty",
    ]));
  });

  it("keeps owner-only team management out of cashier navigation", () => {
    const hrefs = workspaceNavigationForRole("cashier")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/pos");
    expect(hrefs).toContain("/shifts");
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/printers");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/expenses");
    expect(hrefs).not.toContain("/transfers");
    expect(hrefs).not.toContain("/suppliers");
    expect(hrefs).not.toContain("/purchase-orders");
    expect(hrefs).not.toContain("/supplier-returns");
    expect(hrefs).not.toContain("/admin/loyalty");
  });

  it.each(["owner", "manager", "cashier", "inventory"])("does not duplicate routes for %s", (role) => {
    const hrefs = flattenedWorkspaceNavigation(role).map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
