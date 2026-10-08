import { describe, expect, it } from "vitest";
import type { DbShift } from "../common/db.port";
import { selectShiftList } from "./shift-list";

function shift(id: string, openedBy: string, status: "OPEN" | "CLOSED" = "OPEN", registerId = "reg-1"): DbShift {
  return { id, registerId, branchId: null, openedBy, status } as DbShift;
}

const rows = [
  shift("s1", "me", "CLOSED"),
  shift("s2", "other", "OPEN"),
  shift("s3", "me"),
  shift("s4", "other", "CLOSED"),
];

describe("shift list read model", () => {
  it("limits cashier visibility to own shifts without close candidates", () => {
    const result = selectShiftList(rows, {}, "cashier", "me");
    expect(result.items.map((item) => item.id)).toEqual(["s3", "s1"]);
    expect(result.nextCursor).toBeNull();
  });

  it("shows other cashier OPEN shifts as restricted close candidates, never full rows", () => {
    const result = selectShiftList(rows, { includeCloseCandidates: true }, "cashier", "me");
    expect(result.items.map((item) => item.id)).toEqual(["s3", "s2", "s1"]);
    expect(result.items[1]).toEqual({
      id: "s2", registerId: "reg-1", branchId: null,
      status: "OPEN", openedBy: "other", closeCandidate: true,
    });
    expect(result.items.some((item) => item.id === "s4")).toBe(false);
  });

  it("keeps cursor sorting, filtering, and limits stable", () => {
    expect(selectShiftList(rows, { limit: 2 }, "owner", "me")).toMatchObject({
      items: [rows[3], rows[2]],
      nextCursor: "s3",
    });
    expect(selectShiftList(rows, { limit: 2, cursor: "s3" }, "owner", "me")).toMatchObject({
      items: [rows[1], rows[0]],
      nextCursor: null,
    });
    expect(selectShiftList(rows, { limit: 0, cursor: "missing" }, "owner", "me").items).toEqual([rows[3]]);
    expect(selectShiftList(rows, { status: "CLOSED" }, "owner", "me").items.map((item) => item.id)).toEqual(["s4", "s1"]);
    expect(selectShiftList(rows, { registerId: "another" }, "owner", "me").items).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });
});
