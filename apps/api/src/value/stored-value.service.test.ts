import { createMemoryDb } from "../common/memory.db";
import { StoredValueService } from "./stored-value.service";
import { describe, expect, it } from "vitest";

describe("StoredValueService", () => {
  async function fixture() {
    const db = createMemoryDb();
    const business = await db.createBusiness({ name: "Value test", currency: "PHP" });
    const customer = await db.createCustomer({ businessId: business.id, name: "QA Customer", phone: null, email: null, address: null, notes: null, isActive: true });
    return { db, business, customer, service: new StoredValueService(db) };
  }

  it("generates a high-entropy bearer code and only exposes a masked view", async () => {
    const { service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-1", "issue-1");
    expect(issued.code).toMatch(/^NXP-GC-/);
    expect(Buffer.from(issued.code.replaceAll("NXP-GC-", "").replaceAll("-", ""), "hex").length).toBe(16);
    expect(issued.card.codeHash).not.toContain(issued.code);
    expect(service.maskGiftCard(issued.card)).toContain("••••");
    expect((await service.lookupGiftCard(business.id, issued.code)).code).toBeUndefined();
    const replay = await service.issueGiftCard(business.id, "actor", "req-replay", "issue-1");
    expect(replay.card.id).toBe(issued.card.id);
    expect(replay.code).toBe("");
  });

  it("keeps gift-card balances append-only, idempotent, and non-negative", async () => {
    const { service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-1", "issue-1");
    await service.adjustGiftCard(business.id, "actor", "req-2", issued.card.id, 1000, "qa load", "load-1");
    await expect(service.adjustGiftCard(business.id, "actor", "req-3", issued.card.id, -1001, "too much", "debit-1")).rejects.toThrow("GIFT_CARD_INSUFFICIENT_BALANCE");
    await service.adjustGiftCard(business.id, "actor", "req-2-replay", issued.card.id, 1000, "qa load", "load-1");
    expect(await service.giftCardBalance(business.id, issued.card.id)).toBe(1000);
  });

  it("binds store credit to the authoritative customer and enforces balance", async () => {
    const { service, business, customer } = await fixture();
    const account = await service.ensureStoreCreditAccount(business.id, customer.id);
    await service.adjustStoreCredit(business.id, "actor", "req-1", customer.id, 500, "refund", "credit-1");
    expect(await service.storeCreditBalance(business.id, customer.id)).toBe(500);
    await expect(service.adjustStoreCredit(business.id, "actor", "req-2", "foreign-customer", -1, "bad", "debit-1")).rejects.toThrow("NOT_FOUND");
    expect(account.customerId).toBe(customer.id);
  });

  it("uses integer loyalty math and snapshots program settings", async () => {
    const { service, business, customer } = await fixture();
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 3, redeemPoints: 100, redeemValueMinor: 50, minimumRedeemPoints: 100 });
    const result = await service.earnLoyalty(business.id, "actor", "req-1", customer.id, 250, "sale-1", "earn-1");
    expect(result.points).toBe(7);
    expect(result.snapshot.earnPointsSnapshot).toBe(3);
    await expect(service.redeemLoyalty(business.id, "actor", "req-2", customer.id, 100, "sale-2", "redeem-1")).rejects.toThrow("LOYALTY_INSUFFICIENT_POINTS");
  });
});
