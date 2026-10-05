import { describe, expect, it } from "vitest";
import { buildFamilyOptionUpdate } from "./family-dimensions";

describe("phase21 family dimension editor", () => {
  it("builds explicit add/archive operations without inferring IDs from labels", () => {
    expect(buildFamilyOptionUpdate(
      [{ id: "opt-size", name: "Size" }],
      { "opt-size": " Size " },
      { "opt-size": " L, XL " },
      { "opt-size": ["value-m"] },
    )).toEqual([{ id: "opt-size", name: "Size", addValues: ["L", "XL"], archiveValueIds: ["value-m"] }]);
  });
});
