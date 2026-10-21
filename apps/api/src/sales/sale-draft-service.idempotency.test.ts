import { describe, expect, it } from "vitest";

import type { DbPort, DbSale } from "../common/db.port";
import { SalesDraftService } from "./sale-draft-service";
import type { SalesStockService } from "./sale-stock-service";

/**
 * T3 - a lost draft response must not be able to create a second draft.
 *
 * The draft is the first write of a payment attempt. If its response is
 * lost, the client cannot know whether the draft exists, and a retry would
 * create a SECOND draft for one payment. Recording the attempt under the
 * caller's idempotency key makes the retry return the draft that already
 * exists.
 */

function serviceWith(db: Partial<DbPort>): SalesDraftService {
  return new SalesDraftService(db as DbPort, {} as SalesStockService);
}

const existingSale = { id: "sale-1", status: "DRAFT", receiptNo: "2026-000001" } as unknown as DbSale;

const input = {
  lines: [{ productId: "product-1", qty: 1, lineDiscountMinor: 0, costMinor: 100 }],
  orderDiscountMinor: 0,
  customerId: null,
  customerName: null,
  notes: null,
  registerId: "register-1",
  branchId: "branch-1",
  giftCardLoad: null,
} as never;

describe("sale draft idempotency", () => {
  it("returns the draft that already exists for the same attempt key", async () => {
    const claimed: unknown[] = [];
    const db = {
      findIdempotency: async () => ({
        businessId: "business-1",
        key: "attempt-1",
        commandType: "sale.draft",
        fingerprint: (await import("./idempotency")).fingerprintPayload(input),
        resultId: existingSale.id,
      }),
      findSaleById: async () => existingSale,
      claimIdempotency: async (row: unknown) => { claimed.push(row); },
    } as unknown as DbPort;

    const sale = await serviceWith(db).createDraft(
      "business-1",
      "actor-1",
      "request-1",
      input,
      [],
      "attempt-1",
    );

    expect(sale.id).toBe(existingSale.id);
    // The draft was NOT created again, so no second idempotency claim.
    expect(claimed).toEqual([]);
  });

  it("rejects a different payload under the same attempt key", async () => {
    const db = {
      findIdempotency: async () => ({
        businessId: "business-1",
        key: "attempt-1",
        commandType: "sale.draft",
        fingerprint: "a-different-payload",
        resultId: existingSale.id,
      }),
      findSaleById: async () => existingSale,
    } as unknown as DbPort;

    await expect(
      serviceWith(db).createDraft("business-1", "actor-1", "request-1", input, [], "attempt-1"),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
  });

  it("does not consult the ledger when no attempt key is supplied", async () => {
    let consulted = false;
    const db = {
      findIdempotency: async () => { consulted = true; return null; },
    } as unknown as DbPort;

    await expect(
      serviceWith(db).createDraft("business-1", "actor-1", "request-1", input, [], null),
    ).rejects.toThrow();
    expect(consulted).toBe(false);
  });
});
