import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attemptSlot,
  claimAttemptKey,
  clearAttemptKey,
  currentAttemptKey,
  fetchAttemptOutcome,
  readAttemptKey,
} from "./pos-attempt";

/**
 * T1 - the attempt must survive a reload.
 * T2 - a second tab must JOIN the attempt rather than pay again.
 *
 * The slot is the shared, per-register handle on the attempt. The server
 * remains the authority on the outcome; the slot only carries the key.
 */

describe("payment attempt slot", () => {
  beforeEach(() => {
    // The web suite runs in the node environment, so the browser storage is
    // shimmed here rather than pulled in as a new test dependency.
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the attempt key in a slot scoped to the register", () => {
    const slot = attemptSlot("business-1", "register-1");

    expect(slot).toContain("business-1");
    expect(slot).toContain("register-1");
    expect(attemptSlot("business-1", "register-2")).not.toBe(slot);
  });

  it("survives a reload, because the slot is on the device and not in memory", () => {
    const slot = attemptSlot("business-1", "register-1");

    claimAttemptKey(slot, "attempt-1");

    // A reload is modelled by reading the slot again from storage.
    expect(readAttemptKey(slot)).toBe("attempt-1");
    expect(currentAttemptKey(slot)).toBe("attempt-1");
  });

  it("makes a second tab join the attempt instead of starting another one", () => {
    const slot = attemptSlot("business-1", "register-1");

    const first = claimAttemptKey(slot, "attempt-from-tab-a");
    const second = claimAttemptKey(slot, "attempt-from-tab-b");

    expect(first).toBe("attempt-from-tab-a");
    // The second tab does not get its own key: it joins the attempt, so the
    // server's idempotency returns the sale that is already being paid.
    expect(second).toBe("attempt-from-tab-a");
  });

  it("releases the slot when the attempt reaches a definitive outcome", () => {
    const slot = attemptSlot("business-1", "register-1");
    claimAttemptKey(slot, "attempt-1");

    clearAttemptKey(slot);

    expect(currentAttemptKey(slot)).toBeNull();
    expect(claimAttemptKey(slot, "attempt-2")).toBe("attempt-2");
  });

  it("treats a blank slot as no attempt", () => {
    const slot = attemptSlot("business-1", "register-1");
    window.localStorage.setItem(slot, "   ");

    expect(readAttemptKey(slot)).toBeNull();
  });

  it("asks the server what happened to the attempt", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        attempt: { found: true, stage: "draft", saleId: "sale-1", status: "DRAFT" },
      }),
    }));

    const outcome = await fetchAttemptOutcome("attempt-1", fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/sales/attempts/attempt-1",
      expect.anything(),
    );
    expect(outcome).toMatchObject({ found: true, stage: "draft", saleId: "sale-1" });
  });

  it("reports no attempt when the server cannot answer", async () => {
    const failing = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchAttemptOutcome("attempt-1", failing as unknown as typeof fetch)).toEqual({
      found: false,
      stage: "none",
    });

    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await fetchAttemptOutcome("attempt-1", throwing as unknown as typeof fetch)).toEqual({
      found: false,
      stage: "none",
    });
  });
});
