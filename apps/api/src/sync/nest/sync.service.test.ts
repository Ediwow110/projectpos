import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { SyncService } from "./sync.service";

describe("phase9b sync service", () => {
  it("splits applied and unknown keys with server time", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({ businessId: "b1", key: "k1", commandType: "sale.complete", fingerprint: "fp", resultId: "s1" });
    const svc = new SyncService(db);
    const out = await svc.checkKeys("b1", [
      { key: "k1", commandType: "sale.complete" },
      { key: "k2", commandType: "sale.complete" },
    ]);
    expect(out.applied).toEqual([{ key: "k1", resultId: "s1" }]);
    expect(out.unknown).toEqual([{ key: "k2" }]);
    expect(Number.isNaN(new Date(out.serverTime).getTime())).toBe(false);
  });
  it("never leaks another tenant's keys", async () => {
    const db = createMemoryDb();
    await db.claimIdempotency({ businessId: "b1", key: "k9", commandType: "sale.complete", fingerprint: "fp", resultId: "s9" });
    const svc = new SyncService(db);
    const out = await svc.checkKeys("b2", [{ key: "k9", commandType: "sale.complete" }]);
    expect(out.applied).toEqual([]);
    expect(out.unknown).toEqual([{ key: "k9" }]);
  });
});
