import { describe, expect, it } from "vitest";
import { branchCreateSchema, transferCreateSchema } from "../src/branches.schema";

describe("phase9a branch schemas", () => {
  it("rejects empty branch name", () => {
    expect(() => branchCreateSchema.parse({ name: "" })).toThrow();
  });
  it("rejects unknown branch type", () => {
    expect(() => branchCreateSchema.parse({ name: "Main", type: "planet" })).toThrow();
  });
  it("defaults branch type to store", () => {
    expect(branchCreateSchema.parse({ name: "Main" }).type).toBe("store");
  });
  it("rejects same-branch transfers and empty lines", () => {
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "b", toBranchId: "b", lines: [{ productId: "p", qty: 1 }] }),
    ).toThrow();
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "a", toBranchId: "b", lines: [] }),
    ).toThrow();
  });
  it("rejects zero qty lines", () => {
    expect(() =>
      transferCreateSchema.parse({ fromBranchId: "a", toBranchId: "b", lines: [{ productId: "p", qty: 0 }] }),
    ).toThrow();
  });
});
