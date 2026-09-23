import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { BranchService } from "./branch.service";

describe("phase9a branch port", () => {
  it("round-trips a branch scoped to its business", async () => {
    const db = createMemoryDb();
    const b = await db.createBranch({ businessId: "b1", name: "Main", type: "store", isActive: true });
    expect((await db.listBranchesByBusiness("b1")).map((x) => x.id)).toContain(b.id);
    expect(await db.listBranchesByBusiness("b2")).toEqual([]);
    expect(await db.findBranchById(b.id, "b2")).toBeNull();
  });
});

describe("phase9a branch service", () => {
  it("creates branches with audit and duplicate protection", async () => {
    const db = createMemoryDb();
    const svc = new BranchService(db);
    const b = await svc.createBranch("b1", "u1", "r1", { name: "Main" }, "owner");
    expect(b.type).toBe("store");
    await expect(svc.createBranch("b1", "u1", "r2", { name: "Main" }, "owner")).rejects.toThrow("VALIDATION");
    await svc.createBranch("b1", "u1", "r3", { name: "Warehouse", type: "warehouse" }, "manager");
    expect((await db.listAudit()).some((a) => a.action === "branch.create")).toBe(true);
  });
  it("blocks cashier branch management and cross-tenant reads", async () => {
    const db = createMemoryDb();
    const svc = new BranchService(db);
    await expect(svc.createBranch("b1", "u9", "r9", { name: "Back" }, "cashier")).rejects.toThrow("FORBIDDEN");
    const b = await svc.createBranch("b1", "u1", "r1", { name: "Main" }, "owner");
    await expect(svc.updateBranch("b1", "u1", "r2", b.id, { name: "HQ" }, "cashier")).rejects.toThrow("FORBIDDEN");
    expect(await db.findBranchById(b.id, "b2")).toBeNull();
  });
});
