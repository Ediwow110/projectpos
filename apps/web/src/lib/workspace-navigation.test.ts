import { describe, expect, it } from "vitest";

import { workspaceNavigationForRole } from "./workspace-navigation";

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
      "/sync",
    ]));
  });

  it("keeps owner-only team management out of cashier navigation", () => {
    const hrefs = workspaceNavigationForRole("cashier")
      .flatMap((group) => group.items)
      .map((item) => item.href);

    expect(hrefs).toContain("/pos");
    expect(hrefs).toContain("/shifts");
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/expenses");
    expect(hrefs).not.toContain("/transfers");
  });
});
