import { describe, expect, it } from "vitest";
import { me } from "../src/routes/me";

describe("PLAN Phase 0 exit scoped read", () => {
  it("returns tenant-scoped profile with ISO8601 timestamp", () => {
    const res = me({ businessId: "biz_1", userId: "user_1" }, "req_1");
    expect(res.businessId).toBe("biz_1");
    expect(typeof res.timestamp).toBe("string");
    expect(new Date(res.timestamp).toISOString()).toBe(res.timestamp);
  });
});
