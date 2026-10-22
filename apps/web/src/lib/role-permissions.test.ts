import { describe, expect, it } from "vitest";

import { hasPermission } from "./role-permissions";

describe("hasPermission", () => {
  it("grants a permission the server listed", () => {
    expect(hasPermission(["settings.write", "gift_card.manage"], "settings.write")).toBe(true);
  });

  it("refuses a permission the server did not list", () => {
    expect(hasPermission(["gift_card.manage"], "settings.write")).toBe(false);
  });

  it("refuses everything when the server sent no permission list", () => {
    expect(hasPermission(undefined, "settings.write")).toBe(false);
    expect(hasPermission([], "settings.write")).toBe(false);
  });
});
