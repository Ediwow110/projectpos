import { describe, expect, it } from "vitest";
import type { OutboxCommand } from "../src/lib/sync-store";
import type { SaleApi } from "../src/lib/replay-sale";

function cmd(): OutboxCommand {
  return {
    localId: "a", commandType: "sale.complete", key: "k1", fingerprint: "fp1",
    payload: {
      lines: [{ productId: "p1", qty: 2 }],
      registerId: "r1",
      payments: [{ method: "cash", amountMinor: 5000 }],
    },
    queuedAt: "2026-09-24T00:00:01.000Z", status: "QUEUED", attempts: 0,
    lastAttemptAt: null, lastError: null, serverResultId: null,
    provisionalReceipt: "OFFLINE-abcdef12",
  };
}

describe("phase9b sale replay sender", () => {
  it("drafts then completes with the original key", async () => {
    const { sendSaleCommand } = await import("../src/lib/replay-sale");
    const calls: string[] = [];
    const api: SaleApi = {
      check: async () => ({ applied: false }),
      createDraft: async (body) => {
        calls.push("draft");
        expect((body as { lines: unknown[] }).lines).toEqual([{ productId: "p1", qty: 2 }]);
        return { id: "draft-1", totalMinor: 5000 };
      },
      complete: async (key, body) => {
        calls.push("complete");
        expect(key).toBe("k1");
        expect(body.saleId).toBe("draft-1");
        expect(body.payments).toEqual([{ method: "cash", amountMinor: 5000 }]);
        expect(body.registerId).toBe("r1");
        return { status: 201, code: null, resultId: "sale-9" };
      },
    };
    const out = await sendSaleCommand(cmd(), api);
    expect(calls).toEqual(["draft", "complete"]);
    expect(out).toEqual({ status: 201, code: null, resultId: "sale-9" });
  });
  it("skips resend when the key already applied", async () => {
    const { sendSaleCommand } = await import("../src/lib/replay-sale");
    const api: SaleApi = {
      check: async () => ({ applied: true, resultId: "sale-9" }),
      createDraft: async () => { throw new Error("must not draft"); },
      complete: async () => { throw new Error("must not complete"); },
    };
    const out = await sendSaleCommand(cmd(), api);
    expect(out).toEqual({ status: 200, code: null, resultId: "sale-9" });
  });
  it("surfaces conflict codes from complete", async () => {
    const { sendSaleCommand } = await import("../src/lib/replay-sale");
    const api: SaleApi = {
      check: async () => ({ applied: false }),
      createDraft: async () => ({ id: "draft-2", totalMinor: 5000 }),
      complete: async () => ({ status: 409, code: "INSUFFICIENT_STOCK", resultId: null }),
    };
    const out = await sendSaleCommand(cmd(), api);
    expect(out).toEqual({ status: 409, code: "INSUFFICIENT_STOCK", resultId: null });
  });
});
