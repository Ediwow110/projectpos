import { describe, expect, it } from "vitest";
import { MemorySyncStore } from "../src/lib/sync-store";
import type { OutboxCommand } from "../src/lib/sync-store";

function cmd(localId: string, queuedAt: string): OutboxCommand {
  return {
    localId, commandType: "sale.complete", key: `k-${localId}`, fingerprint: "fp",
    payload: { saleId: localId }, queuedAt, status: "QUEUED", attempts: 0,
    lastAttemptAt: null, lastError: null, serverResultId: null,
    provisionalReceipt: `OFFLINE-${localId}`,
  };
}

describe("phase9b replay worker", () => {
  it("marks applied commands SYNCED with the server result", async () => {
    const { runReplayOnce } = await import("../src/lib/replay");
    const store = new MemorySyncStore();
    await store.enqueue({ ...cmd("a", "2026-09-24T00:00:01.000Z") });
    const summary = await runReplayOnce({
      store,
      send: async () => ({ status: 201, code: null, resultId: "sale-1" }),
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => true,
    });
    expect(summary).toEqual({ sent: 1, synced: 1, conflicts: 0, retried: 0 });
    const all = await store.listAll();
    expect(all[0].status).toBe("SYNCED");
    expect(all[0].serverResultId).toBe("sale-1");
  });
  it("flags conflicts and keeps sending later commands", async () => {
    const { runReplayOnce } = await import("../src/lib/replay");
    const store = new MemorySyncStore();
    await store.enqueue({ ...cmd("a", "2026-09-24T00:00:01.000Z") });
    await store.enqueue({ ...cmd("b", "2026-09-24T00:00:02.000Z") });
    const sent: string[] = [];
    const summary = await runReplayOnce({
      store,
      send: async (c) => {
        sent.push(c.localId);
        if (c.localId === "a") return { status: 409, code: "INSUFFICIENT_STOCK", resultId: null };
        return { status: 201, code: null, resultId: "sale-b" };
      },
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => true,
    });
    expect(sent).toEqual(["a", "b"]);
    expect(summary).toEqual({ sent: 2, synced: 1, conflicts: 1, retried: 0 });
    const byId = new Map((await store.listAll()).map((c) => [c.localId, c]));
    expect(byId.get("a")!.status).toBe("CONFLICT");
    expect(byId.get("a")!.lastError).toBe("INSUFFICIENT_STOCK");
    expect(byId.get("b")!.status).toBe("SYNCED");
  });
  it("records network failures as retryable with bumped attempts", async () => {
    const { runReplayOnce } = await import("../src/lib/replay");
    const store = new MemorySyncStore();
    await store.enqueue({ ...cmd("a", "2026-09-24T00:00:01.000Z") });
    const summary = await runReplayOnce({
      store,
      send: async () => { throw new Error("NETWORK"); },
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => true,
    });
    expect(summary).toEqual({ sent: 1, synced: 0, conflicts: 0, retried: 1 });
    const all = await store.listAll();
    expect(all[0].status).toBe("FAILED");
    expect(all[0].attempts).toBe(1);
    expect(all[0].lastError).toBe("NETWORK");
  });
  it("skips FAILED commands whose backoff has not elapsed", async () => {
    const { runReplayOnce } = await import("../src/lib/replay");
    const store = new MemorySyncStore();
    await store.enqueue({ ...cmd("a", "2026-09-24T00:00:01.000Z") });
    await store.mark({ localId: "a", status: "FAILED", attempts: 1 });
    let calls = 0;
    const summary = await runReplayOnce({
      store,
      send: async () => { calls += 1; return { status: 201, code: null, resultId: "x" }; },
      nowMs: () => Date.parse("2026-09-24T00:01:00.000Z"),
      dueCheck: () => false,
    });
    expect(calls).toBe(0);
    expect(summary).toEqual({ sent: 0, synced: 0, conflicts: 0, retried: 0 });
  });
});
