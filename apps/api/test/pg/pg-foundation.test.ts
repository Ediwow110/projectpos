import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import type { DbPort } from "../../src/common/db.port";

describe("phase12 pg foundation", () => {
  it("seeds the four plans and reads them back", async () => {
    await withPg(async (db: DbPort) => {
      expect((await db.listPlans()).map((p) => p.key).sort()).toEqual(["basic", "enterprise", "free", "pro"]);
      expect((await db.findPlanByKey("pro"))!.pricesMinor.monthlyMinor).toBe(149000);
    });
  });

  it("aggregates settings rows into one object and replaces them on save", async () => {
    await withPg(async (db: DbPort) => {
      const biz = await db.createBusiness({ name: "PG Store", currency: "PHP" });
      expect(await db.getSettings(biz.id)).toEqual({});
      await db.saveSettings(biz.id, { currency: "PHP", receiptFooter: "Salamat" });
      expect(await db.getSettings(biz.id)).toEqual({ currency: "PHP", receiptFooter: "Salamat" });
      // saveSettings replaces the whole record, exactly like memory.
      await db.saveSettings(biz.id, { currency: "USD" });
      expect(await db.getSettings(biz.id)).toEqual({ currency: "USD" });
    });
  });

  it("stamps audit rows with a timestamp and orders them", async () => {
    await withPg(async (db: DbPort) => {
      await db.appendAudit({
        businessId: null, actorId: "platform", action: "flag.global",
        entityType: "FeatureFlag", entityId: "x:false", requestId: "r1",
        reason: "global off",
      });
      const rows = await db.listAudit();
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const last = rows.at(-1)!;
      expect(last.at).toBeInstanceOf(Date);
      expect(last.reason).toBe("global off");
    });
  });

  it("serializes concurrent lock bodies and rolls back on failure", async () => {
    await withPg(async (db, ctx) => {
      const order: string[] = [];
      let releases: Array<() => void> = [];
      const gate = new Promise<void>((resolve) => { releases.push(resolve); });
      // Two lock bodies on the same key: the second must not start until the
      // first releases.
      const first = ctx.withLock("sales:b1", async () => {
        order.push("first:start");
        await gate;
        order.push("first:end");
      });
      const second = ctx.withLock("sales:b1", async () => {
        order.push("second:start");
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(order).toEqual(["first:start"]);
      releases[0]!();
      await first;
      await second;
      expect(order).toEqual(["first:start", "first:end", "second:start"]);
      void db;
    });
  });

  it("rolls back every write inside a failed lock body", async () => {
    await withPg(async (db, ctx) => {
      const biz = await db.createBusiness({ name: "Rollback", currency: "PHP" });
      await expect(
        ctx.withLock("sales:b1", async () => {
          await db.saveSettings(biz.id, { currency: "PHP" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // The settings write was part of the transaction: gone after rollback.
      expect(await db.getSettings(biz.id)).toEqual({});
      expect(await db.findBusinessById(biz.id)).not.toBeNull(); // outside tx: survived
    });
  });
});
