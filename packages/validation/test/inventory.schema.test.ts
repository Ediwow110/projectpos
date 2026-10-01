import { describe, expect, it } from "vitest";
import { movementCreateSchema, balancesQuerySchema } from "../src/inventory.schema";

describe("phase3 inventory schemas", () => {
  it("rejects zero qtyDelta", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 0 }),
    ).toThrow();
  });
  it("rejects non-integer qtyDelta", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 2.5 }),
    ).toThrow();
  });
  it("rejects unknown movement type", () => {
    expect(() =>
      movementCreateSchema.parse({ productId: "p1", type: "teleport", qtyDelta: 1 }),
    ).toThrow();
  });
  it("rejects view outside all|low|out", () => {
    expect(() => balancesQuerySchema.parse({ view: "everything" })).toThrow();
  });
  it("accepts a minimal valid movement", () => {
    const out = movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 10 });
    expect(out.qtyDelta).toBe(10);
  });
  it("accepts only a sufficiently opaque approval token", () => {
    expect(movementCreateSchema.parse({
      productId: "p1", type: "receive", qtyDelta: 10, approvalToken: "mgr_12345678901234567890",
    }).approvalToken).toBe("mgr_12345678901234567890");
    expect(() => movementCreateSchema.parse({ productId: "p1", type: "receive", qtyDelta: 10, approvalToken: "short" })).toThrow();
  });
});
