import { describe, expect, it, vi } from "vitest";
import { sendSaleCommand, toDraftBody } from "./replay-sale";
import type { OutboxCommand } from "./sync-store";

const payload = {
  lines: [{ productId: "p1", qty: 1 }],
  registerId: "reg-1",
  payments: [{ method: "cash", amountMinor: 1000 }],
};

function command(): OutboxCommand {
  return {
    localId: "local-1",
    commandType: "sale.complete",
    key: "attempt-key-1",
    fingerprint: "fp-1",
    payload,
    queuedAt: new Date(0).toISOString(),
    status: "QUEUED",
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    serverResultId: null,
    provisionalReceipt: null,
  };
}

function api(check: () => Promise<{ applied: boolean; resultId?: string }>) {
  return {
    check,
    createDraft: vi.fn(async () => ({ id: "sale-1", totalMinor: 1000 })),
    complete: vi.fn(async () => ({ status: 201, code: null, resultId: "sale-1" })),
  };
}

describe("sendSaleCommand ledger check", () => {
  it("treats a refused or never-landed ledger check as no answer and creates no draft", async () => {
    const deps = api(async () => {
      throw new Error("ledger check refused");
    });
    await expect(sendSaleCommand(command(), deps)).rejects.toThrow();
    expect(deps.createDraft).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("replays the recorded sale when the ledger answers applied", async () => {
    const deps = api(async () => ({ applied: true, resultId: "sale-existing" }));
    const out = await sendSaleCommand(command(), deps);
    expect(out).toEqual({ status: 200, code: null, resultId: "sale-existing" });
    expect(deps.createDraft).not.toHaveBeenCalled();
  });

  it("creates the draft only when the ledger actually answered not applied", async () => {
    const deps = api(async () => ({ applied: false }));
    const out = await sendSaleCommand(command(), deps);
    expect(out.resultId).toBe("sale-1");
    expect(deps.createDraft).toHaveBeenCalledWith(toDraftBody(payload));
    expect(deps.complete).toHaveBeenCalledWith("attempt-key-1", { saleId: "sale-1", payments: payload.payments, registerId: "reg-1" });
  });
});
