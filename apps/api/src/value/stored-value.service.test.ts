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

  it("audits direct gift-card adjustments once and excludes bearer secrets", async () => {
    const { db, service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-1", "issue-1");
    await service.adjustGiftCard(business.id, "actor", "req-2", issued.card.id, 1000, "qa load", "adjust-1");
    await service.adjustGiftCard(business.id, "actor", "req-3", issued.card.id, 1000, "qa load", "adjust-1");

    const audits = (await db.listAudit()).filter((entry) => entry.action === "gift-card.adjust");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      businessId: business.id,
      actorId: "actor",
      entityType: "GiftCard",
      entityId: issued.card.id,
      reason: "qa load",
      before: { previousBalance: 0 },
      after: { delta: 1000, newBalance: 1000 },
    });
    expect(JSON.stringify(audits[0])).not.toContain(issued.code);
  });

  it("audits store-credit and loyalty adjustments once, while failed mutations create no audit", async () => {
    const { db, service, business, customer } = await fixture();
    await service.adjustStoreCredit(business.id, "actor", "req-1", customer.id, 1000, "qa credit", "credit-1");
    await service.adjustStoreCredit(business.id, "actor", "req-2", customer.id, 1000, "qa credit", "credit-1");
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10 });
    await service.adjustLoyalty(business.id, "actor", "req-3", customer.id, 10, "qa points", "points-1");
    await service.adjustLoyalty(business.id, "actor", "req-4", customer.id, 10, "qa points", "points-1");
    await expect(service.adjustStoreCredit(business.id, "actor", "req-5", customer.id, -2000, "too much", "credit-2")).rejects.toThrow("STORE_CREDIT_INSUFFICIENT_BALANCE");

    const audits = await db.listAudit();
    expect(audits.filter((entry) => entry.action === "store-credit.adjust")).toHaveLength(1);
    expect(audits.filter((entry) => entry.action === "loyalty.adjust")).toHaveLength(1);
    expect(audits.filter((entry) => entry.action.endsWith(".adjust"))).toHaveLength(2);
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
