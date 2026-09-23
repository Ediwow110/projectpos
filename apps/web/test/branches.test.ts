import { describe, expect, it } from "vitest";

describe("phase9a branch web helpers", () => {
  it("gates branch management by role", async () => {
    const { canManageBranches } = await import("../src/lib/branches");
    expect(canManageBranches("manager")).toBe(true);
    expect(canManageBranches("cashier")).toBe(false);
  });
  it("labels transfer statuses as text", async () => {
    const { transferStatusLabel } = await import("../src/lib/branches");
    expect(transferStatusLabel("IN_TRANSIT")).toBe("IN TRANSIT");
    expect(transferStatusLabel("DRAFT")).toBe("DRAFT");
    expect(transferStatusLabel("RECEIVED")).toBe("RECEIVED");
  });
  it("builds the branches query path", async () => {
    const { buildBranchesQuery } = await import("../src/lib/branches");
    expect(buildBranchesQuery()).toBe("/api/v1/branches");
  });
});
