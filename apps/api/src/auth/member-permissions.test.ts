import { describe, expect, it } from "vitest";
import { ROLE_SEED } from "../tenant/seed";
import { deniedPermissions, effectivePermissions, MEMBER_DENIALS_KEY, visibleBusinessSettings } from "./member-permissions";

describe("deny-only membership permission controls", () => {
  it("does not change existing roles without an override", () => {
    expect(effectivePermissions("inventory", "mem_1", {})).toEqual(ROLE_SEED.inventory);
  });

  it("removes only selected permissions from exactly one membership", () => {
    const settings = { [MEMBER_DENIALS_KEY]: { mem_1: ["price.edit", "cost.view", "invented.permission"] } };
    expect(effectivePermissions("inventory", "mem_1", settings)).not.toContain("price.edit");
    expect(effectivePermissions("inventory", "mem_1", settings)).not.toContain("cost.view");
    expect(effectivePermissions("inventory", "mem_2", settings)).toContain("price.edit");
    expect(effectivePermissions("cashier", "mem_1", settings)).toEqual(ROLE_SEED.cashier);
    expect(deniedPermissions(settings, "mem_1")).toContain("cost.view");
  });

  it("never restricts or expands owner permissions with override data", () => {
    const settings = { [MEMBER_DENIALS_KEY]: { mem_1: ["settings.write", "user.manage", "sale.refund"] } };
    expect(effectivePermissions("owner", "mem_1", settings)).toEqual(ROLE_SEED.owner);
  });

  it("tolerates malformed old settings without granting new permissions", () => {
    const settings = { [MEMBER_DENIALS_KEY]: { mem_1: ["price.edit", null, 5] } };
    expect(effectivePermissions("inventory", "mem_1", settings)).not.toContain("price.edit");
    expect(deniedPermissions({ [MEMBER_DENIALS_KEY]: null }, "mem_1")).toEqual([]);
  });

  it("keeps the owner-only restriction map out of general staff business settings", () => {
    const settings = { currency: "PHP", [MEMBER_DENIALS_KEY]: { mem_1: ["price.edit"] } };
    expect(visibleBusinessSettings("cashier", settings)).toEqual({ currency: "PHP" });
    expect(visibleBusinessSettings("manager", settings)).toEqual({ currency: "PHP" });
    expect(visibleBusinessSettings("api", settings)).toEqual({ currency: "PHP" });
    expect(visibleBusinessSettings("owner", settings)).toEqual(settings);
    expect(settings[MEMBER_DENIALS_KEY]).toEqual({ mem_1: ["price.edit"] });
  });
});
