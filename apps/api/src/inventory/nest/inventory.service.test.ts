import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";

describe("phase3 inventory port", () => {
  it("round-trips a movement scoped to its business", async () => {
    const db = createMemoryDb();
    await db.createMovement({
      businessId: "b1", productId: "p1", type: "receive", qtyDelta: 10,
      reason: null, referenceType: null, referenceId: null,
      actorId: "u1", requestId: "r1",
    });
    expect((await db.listMovements("p1", "b1")).length).toBe(1);
    expect(await db.listMovements("p1", "b2")).toEqual([]);
  });
  it("upserts balances scoped to business", async () => {
    const db = createMemoryDb();
    await db.upsertBalance({ businessId: "b1", productId: "p1", qtyOnHand: 10 });
    expect((await db.findBalance("p1", "b1"))!.qtyOnHand).toBe(10);
    expect(await db.findBalance("p1", "b2")).toBeNull();
    expect(await db.listBalances("b2")).toEqual([]);
  });
});
