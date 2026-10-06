import { describe, expect, it } from "vitest";
import { withPg } from "./helpers";
import type { DbPort } from "../../src/common/db.port";
import { PgContext } from "../../src/common/pg/context";

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

  it("serializes concurrent lock bodies (mutual exclusion, any acquisition order)", async () => {
    await withPg(async (db, ctx) => {
      const order: string[] = [];
      let inside = 0;
      let maxInside = 0;
      // Both bodies hold the lock for a moment. The key is test-unique so a
      // stale advisory lock from an earlier run can never block it.
      const key = `foundation-serialize-${Date.now()}`;
      const body = (name: string) => async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        order.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 150));
        order.push(`${name}:end`);
        inside -= 1;
      };
      // withLock guarantees mutual exclusion, not acquisition order: either
      // body may win the race, but they must never overlap.
      await Promise.all([ctx.withLock(key, body("first")), ctx.withLock(key, body("second"))]);
      expect(maxInside).toBe(1);
      expect(order).toHaveLength(4);
      expect(order[1]).toBe(order[0]!.replace(":start", ":end"));
      expect(order[3]).toBe(order[2]!.replace(":start", ":end"));
      void db;
    });
  });

  it("rolls back every write inside a failed lock body", async () => {
    await withPg(async (db, ctx) => {
      const biz = await db.createBusiness({ name: "Rollback", currency: "PHP" });
      await expect(
        ctx.withLock(`foundation-rollback-${Date.now()}`, async () => {
          await db.saveSettings(biz.id, { currency: "PHP" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // The settings write was part of the transaction: gone after rollback.
      expect(await db.getSettings(biz.id)).toEqual({});
      expect(await db.findBusinessById(biz.id)).not.toBeNull(); // outside tx: survived
    });
  });

  it("nested locks inside one transaction still block another PostgreSQL instance", async () => {
    await withPg(async (_db, ctx) => {
      const base = process.env["PGTEST_BASE"] ?? "postgres://pos:pos@localhost:5433";
      const testDb = process.env["PGTEST_DB"] ?? "pos_test_pg";
      const competitor = new PgContext(base + "/" + testDb);
      const outerKey = "foundation-outer-" + Date.now();
      const innerKey = "foundation-inner-" + Date.now();
      let releaseInner!: () => void;
      const innerReleased = new Promise<void>((resolve) => {
        releaseInner = resolve;
      });
      let innerEntered!: () => void;
      const innerStarted = new Promise<void>((resolve) => {
        innerEntered = resolve;
      });
      let competitorEntered = false;

      try {
        const holder = ctx.withLock(outerKey, async () => {
          await ctx.withLock(innerKey, async () => {
            innerEntered();
            await innerReleased;
          });
        });
        await innerStarted;

        const contender = competitor.withLock(innerKey, async () => {
          competitorEntered = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(competitorEntered).toBe(false);

        releaseInner();
        await Promise.all([holder, contender]);
        expect(competitorEntered).toBe(true);
      } finally {
        releaseInner?.();
        await competitor.close();
      }
    });
  });
});
