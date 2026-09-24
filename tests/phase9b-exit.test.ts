// Phase 9b exit gate: offline outbox replays through the real service stack.
// Covers the full loop at the service/lib boundary (browser E2E lives in
// e2e/offline.spec.ts): enqueue -> replay -> SYNCED with server effects, and
// the oversell path -> CONFLICT, without touching the network.
import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../apps/api/src/common/memory.db";
import { SalesService } from "../apps/api/src/sales/nest/sales.service";
import { SyncService } from "../apps/api/src/sync/nest/sync.service";
import { DeviceService } from "../apps/api/src/devices/nest/device.service";
import { MemorySyncStore } from "../apps/web/src/lib/sync-store";
import { runReplayOnce } from "../apps/web/src/lib/replay";
import { sendSaleCommand } from "../apps/web/src/lib/replay-sale";

const GRANT = ["discount.override", "sale.void", "sale.refund", "cost.view", "inventory.adjust"];

async function setup() {
  const db = createMemoryDb();
  const prod = await db.createProduct({
    businessId: "b1", categoryId: null, name: "Coke", sku: null, barcode: null,
    brand: null, unit: "pc", costMinor: 1000, priceMinor: 2500, taxRateBps: null,
    reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null,
  });
  await db.upsertBalance({ businessId: "b1", branchId: null, productId: prod.id, qtyOnHand: 10 });
  const sales = new SalesService(db);
  const draft = await sales.createDraft("b1", "u1", "r0", {
    lines: [{ productId: prod.id, qty: 1, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
  }, GRANT);
  return { db, sales, sync: new SyncService(db), devices: new DeviceService(db), productId: prod.id, totalMinor: draft.totalMinor };
}

function sender(sales: SalesService, sync: SyncService) {
  return {
    check: async (key: string) => {
      const out = await sync.checkKeys("b1", [{ key, commandType: "sale.complete" }]);
      const hit = out.applied.find((a) => a.key === key);
      return hit ? { applied: true, resultId: hit.resultId } : { applied: false as boolean };
    },
    createDraft: async (body: { lines: Array<{ productId: string; qty: number }> }) => {
      const d = await sales.createDraft("b1", "u1", "r1", {
        lines: body.lines.map((l) => ({ ...l, lineDiscountMinor: 0 })), orderDiscountMinor: 0,
      }, GRANT);
      return { id: d.id, totalMinor: d.totalMinor };
    },
    complete: async (key: string, body: { saleId: string; payments: Array<{ method: string; amountMinor: number }> }) => {
      try {
        const done = await sales.completeSale("b1", "u1", "r2", body.saleId, {
          payments: body.payments.map((p) => ({ ...p })),
          key,
          granted: GRANT,
        });
        return { status: 201, code: null as string | null, resultId: done.sale.id };
      } catch (e) {
        return { status: 400, code: e instanceof Error ? e.message : "VALIDATION", resultId: null as string | null };
      }
    },
  };
}

describe("phase9b exit", () => {
  it("replays a queued offline sale to SYNCED with server effects", async () => {
    const { db, sales, sync, productId, totalMinor } = await setup();
    const store = new MemorySyncStore();
    const fp = "fp-exit-1";
    await store.enqueue({
      localId: "cmd-1", commandType: "sale.complete", key: "exit-key-1", fingerprint: fp,
      payload: { lines: [{ productId, qty: 2 }], payments: [{ method: "cash", amountMinor: totalMinor * 2 }] },
      queuedAt: "2026-09-24T00:00:01.000Z", lastAttemptAt: null, provisionalReceipt: "OFFLINE-exit0001",
    });
    const summary = await runReplayOnce({
      store,
      send: (cmd) => sendSaleCommand(cmd, sender(sales, sync)),
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => true,
    });
    expect(summary).toEqual({ sent: 1, synced: 1, conflicts: 0, retried: 0 });
    expect((await db.findBalance(productId, "b1", null))!.qtyOnHand).toBe(8);
    const [row] = await store.listAll();
    expect(row.status).toBe("SYNCED");
    expect(row.serverResultId).not.toBeNull();
  });

  it("maps an oversold replay to CONFLICT without partial writes", async () => {
    const { sales, sync, productId, totalMinor } = await setup();
    // Rest of the world buys 10 of 10 first.
    const drain = await sales.createDraft("b1", "u1", "r9", {
      lines: [{ productId, qty: 10, lineDiscountMinor: 0 }], orderDiscountMinor: 0,
    }, GRANT);
    await sales.completeSale("b1", "u1", "r9", drain.id, {
      payments: [{ method: "cash", amountMinor: drain.totalMinor }], key: "exit-drain-1", granted: GRANT,
    });
    const store = new MemorySyncStore();
    await store.enqueue({
      localId: "cmd-2", commandType: "sale.complete", key: "exit-key-2", fingerprint: "fp-exit-2",
      payload: { lines: [{ productId, qty: 1 }], payments: [{ method: "cash", amountMinor: totalMinor }] },
      queuedAt: "2026-09-24T00:00:02.000Z", lastAttemptAt: null, provisionalReceipt: "OFFLINE-exit0002",
    });
    const summary = await runReplayOnce({
      store,
      send: (cmd) => sendSaleCommand(cmd, sender(sales, sync)),
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => true,
    });
    expect(summary).toEqual({ sent: 1, synced: 0, conflicts: 1, retried: 0 });
    const [row] = await store.listAll();
    expect(row.status).toBe("CONFLICT");
    expect(row.lastError).toBe("INSUFFICIENT_STOCK");
  });

  it("sync/check reconciles applied and unknown keys, devices enroll and bind", async () => {
    const { db, sync, devices } = await setup();
    const dev = await devices.enrollDevice("b1", "u1", "r1", { label: "Till 1" });
    expect(dev.revokedAt).toBeNull();
    expect((await devices.listDevices("b1", "u1")).map((d) => d.id)).toContain(dev.id);
    const checked = await sync.checkKeys("b1", [
      { key: "exit-key-1", commandType: "sale.complete" },
      { key: "never-seen", commandType: "sale.complete" },
    ]);
    // Fresh db per test: nothing claimed yet, everything unknown.
    expect(checked.applied).toEqual([]);
    expect(checked.unknown.map((k) => k.key)).toContain("never-seen");
    expect(typeof checked.serverTime).toBe("string");
    await db.claimIdempotency({
      businessId: "b1", key: "k-applied", commandType: "sale.complete",
      fingerprint: "fp", resultId: "sale-1",
    });
    const recheck = await sync.checkKeys("b1", [{ key: "k-applied", commandType: "sale.complete" }]);
    expect(recheck.applied).toEqual([{ key: "k-applied", resultId: "sale-1" }]);
  });
});
