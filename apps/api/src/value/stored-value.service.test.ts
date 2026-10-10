import { createMemoryDb } from "../common/memory.db";
import { StoredValueService } from "./stored-value.service";
import { describe, expect, it, vi } from "vitest";

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
    await service.adjustGiftCard(business.id, "actor", "req-2", issued.card.id, 1000, "qa load", "6000", "load-1");
    await expect(service.adjustGiftCard(business.id, "actor", "req-3", issued.card.id, -1001, "too much", "6000", "debit-1")).rejects.toThrow("GIFT_CARD_INSUFFICIENT_BALANCE");
    await service.adjustGiftCard(business.id, "actor", "req-2-replay", issued.card.id, 1000, "qa load", "6000", "load-1");
    expect(await service.giftCardBalance(business.id, issued.card.id)).toBe(1000);
  });

  it("rolls back stored-value adjustment when journal posting fails", async () => {
    const { db, service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-issue", "issue-rollback");
    const post = vi.spyOn(db, "createJournalEntry").mockRejectedValue(new Error("injected posting failure"));
    await expect(service.adjustGiftCard(business.id, "actor", "req-adjust", issued.card.id, 300, "qa adjustment", "6000", "adjust-rollback")).rejects.toThrow("injected posting failure");
    post.mockRestore();
    expect(await service.giftCardBalance(business.id, issued.card.id)).toBe(0);
    expect(await db.listJournalEntries(business.id, { limit: 10 })).toHaveLength(0);
  });

  it("audits direct gift-card adjustments once and excludes bearer secrets", async () => {
    const { db, service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-1", "issue-1");
    await service.adjustGiftCard(business.id, "actor", "req-2", issued.card.id, 1000, "qa load", "6000", "adjust-1");
    await service.adjustGiftCard(business.id, "actor", "req-3", issued.card.id, 1000, "qa load", "6000", "adjust-1");

    const audits = (await db.listAudit()).filter((entry) => entry.action === "gift-card.adjust");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      businessId: business.id,
      actorId: "actor",
      entityType: "GiftCard",
      entityId: issued.card.id,
      reason: "qa load",
      before: { balanceMinor: 0 },
      after: { amountDeltaMinor: 1000, balanceMinor: 1000 },
    });
    expect(JSON.stringify(audits[0])).not.toContain(issued.code);
  });

  it("audits store-credit and loyalty adjustments once, while failed mutations create no audit", async () => {
    const { db, service, business, customer } = await fixture();
    await service.adjustStoreCredit(business.id, "actor", "req-1", customer.id, 1000, "qa credit", "6000", "credit-1");
    await service.adjustStoreCredit(business.id, "actor", "req-2", customer.id, 1000, "qa credit", "6000", "credit-1");
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10 });
    await service.adjustLoyalty(business.id, "actor", "req-3", customer.id, 10, "qa points", "6000", "points-1");
    await service.adjustLoyalty(business.id, "actor", "req-4", customer.id, 10, "qa points", "6000", "points-1");
    await expect(service.adjustStoreCredit(business.id, "actor", "req-5", customer.id, -2000, "too much", "6000", "credit-2")).rejects.toThrow("STORE_CREDIT_INSUFFICIENT_BALANCE");

    const audits = await db.listAudit();
    expect(audits.filter((entry) => entry.action === "store-credit.adjust")).toHaveLength(1);
    expect(audits.filter((entry) => entry.action === "loyalty.adjust")).toHaveLength(1);
    expect(audits.filter((entry) => entry.action.endsWith(".adjust"))).toHaveLength(2);
  });

  it("binds store credit to the authoritative customer and enforces balance", async () => {
    const { service, business, customer } = await fixture();
    const account = await service.ensureStoreCreditAccount(business.id, customer.id);
    await service.adjustStoreCredit(business.id, "actor", "req-1", customer.id, 500, "refund", "6000", "credit-1");
    expect(await service.storeCreditBalance(business.id, customer.id)).toBe(500);
    await expect(service.adjustStoreCredit(business.id, "actor", "req-2", "foreign-customer", -1, "bad", "6000", "debit-1")).rejects.toThrow("NOT_FOUND");
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

  it("does not value a legacy loyalty adjustment from today's program when replayed", async () => {
    const { db, service, business, customer } = await fixture();
    const account = await service.ensureLoyaltyAccount(business.id, customer.id);
    await db.createLoyaltyTransaction({ businessId: business.id, accountId: account.id, customerId: customer.id, type: "MANUAL_CREDIT", pointsDelta: 10, valueMinorSnapshot: null, saleId: null, refundId: null, actorId: "actor", requestId: "legacy-request", idempotencyKey: "legacy-loyalty", reason: "Legacy points" });
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10 });
    await expect(service.adjustLoyalty(business.id, "actor", "replay-request", customer.id, 10, "Legacy points", "6000", "legacy-loyalty")).rejects.toThrow("ACCOUNTING_LOYALTY_VALUE_UNAVAILABLE");
    expect(await db.listJournalEntries(business.id, { limit: 10 })).toHaveLength(0);
  });

  it("writes one business audit per new manual adjustment and none on idempotent replay", async () => {
    const { db, service, business, customer } = await fixture();
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 1, redeemPoints: 10, redeemValueMinor: 100, minimumRedeemPoints: 10 });
    const issued = await service.issueGiftCard(business.id, "actor", "req-issue", "issue-1");

    await service.adjustGiftCard(business.id, "actor", "req-gift", issued.card.id, 500, "qa gift load", "6000", "gift-1");
    await service.adjustGiftCard(business.id, "actor", "req-gift-replay", issued.card.id, 500, "qa gift load", "6000", "gift-1");
    await expect(service.adjustGiftCard(business.id, "actor", "req-gift-mismatch", issued.card.id, 500, "qa gift load", "4000", "gift-1")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await service.adjustStoreCredit(business.id, "actor", "req-credit", customer.id, 250, "qa credit", "6000", "credit-1");
    await service.adjustStoreCredit(business.id, "actor", "req-credit-replay", customer.id, 250, "qa credit", "6000", "credit-1");
    await service.adjustLoyalty(business.id, "actor", "req-loyalty", customer.id, 10, "qa points", "6000", "loyalty-1");
    await service.adjustLoyalty(business.id, "actor", "req-loyalty-replay", customer.id, 10, "qa points", "6000", "loyalty-1");

    const audits = (await db.listAudit()).filter((entry) => entry.businessId === business.id);
    const adjustments = audits.filter((entry) => entry.action.endsWith(".adjust"));
    expect(adjustments.map((entry) => entry.action).sort()).toEqual([
      "gift-card.adjust",
      "loyalty.adjust",
      "store-credit.adjust",
    ]);
    expect(adjustments.find((entry) => entry.action === "gift-card.adjust")?.after).toEqual({ balanceMinor: 500, amountDeltaMinor: 500, counterAccountCode: "6000" });
    expect(adjustments.find((entry) => entry.action === "store-credit.adjust")?.after).toEqual({ balanceMinor: 250, amountDeltaMinor: 250, counterAccountCode: "6000" });
    expect(adjustments.find((entry) => entry.action === "loyalty.adjust")?.after).toEqual({ points: 10, pointsDelta: 10, valueMinorSnapshot: 100, counterAccountCode: "6000" });
    const entries = await db.listJournalEntries(business.id, { limit: 10 });
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      const lines = await db.listJournalLines(entry.id, business.id);
      expect(lines.reduce((sum, line) => sum + line.debitMinor, 0)).toBe(lines.reduce((sum, line) => sum + line.creditMinor, 0));
    }
    expect(await db.hasUnaccountedValueAdjustments(business.id)).toBe(false);
  });

});
