import { createMemoryDb } from "../common/memory.db";
import { StoredValueService, assertProductionGiftCardCodeSecret } from "./stored-value.service";
import { describe, expect, it, vi } from "vitest";

describe("StoredValueService", () => {
  it("requires a separate configured HMAC secret before production API startup", () => {
    expect(() => assertProductionGiftCardCodeSecret({ NODE_ENV: "production" })).toThrow("GIFT_CARD_CODE_SECRET_MISSING");
    expect(() => assertProductionGiftCardCodeSecret({ NODE_ENV: "production", GIFT_CARD_CODE_SECRET: "short" })).toThrow("GIFT_CARD_CODE_SECRET_MISSING");
    expect(() => assertProductionGiftCardCodeSecret({ NODE_ENV: "production", GIFT_CARD_CODE_SECRET: "s".repeat(32) })).not.toThrow();
    expect(() => assertProductionGiftCardCodeSecret({ NODE_ENV: "development" })).not.toThrow();
  });
  it("keeps gift-card money and approval audit atomic and rejects mismatched replays", async () => {
    const { db, service, business } = await fixture();
    const issued = await service.issueGiftCard(business.id, "cashier", "issue", "gift-issue");
    const realAudit = db.appendAudit.bind(db);
    const spy = vi.spyOn(db, "appendAudit").mockImplementation(async (entry) => {
      if (entry.action === "manager.approval.applied") throw new Error("AUDIT_UNAVAILABLE");
      return realAudit(entry);
    });
    const adjust = (amount: number) => service.adjustGiftCardWithMetadata(
      business.id, "cashier", "request", issued.card.id, amount, "Approved correction", "gift-atomic-key", "manager");
    await expect(adjust(25)).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(await service.giftCardBalance(business.id, issued.card.id)).toBe(0);
    spy.mockRestore();
    await adjust(25);
    await adjust(25);
    await expect(adjust(30)).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(await service.giftCardBalance(business.id, issued.card.id)).toBe(25);
    expect((await db.listAudit()).filter((entry) => entry.action === "manager.approval.applied")).toHaveLength(1);
  });
  it.each(["store_credit", "loyalty"] as const)("rolls back %s monetary writes if the manager-applied audit fails", async (kind) => {
    const { db, service, business, customer } = await fixture();
    const realAudit = db.appendAudit.bind(db);
    const spy = vi.spyOn(db, "appendAudit").mockImplementation(async (entry) => {
      if (entry.action === "manager.approval.applied") throw new Error("AUDIT_UNAVAILABLE");
      return realAudit(entry);
    });
    const apply = () => kind === "store_credit"
      ? service.adjustStoreCreditWithMetadata(business.id, "cashier", "request", customer.id, 25, "Approved correction", "audit-failure-key", "manager")
      : service.adjustLoyaltyWithMetadata(business.id, "cashier", "request", customer.id, 25, "Approved correction", "audit-failure-key", "manager");
    await expect(apply()).rejects.toThrow("AUDIT_UNAVAILABLE");
    expect(kind === "store_credit"
      ? await db.findStoreCreditAccount(customer.id, business.id)
      : await db.findLoyaltyAccount(customer.id, business.id)).toBeNull();
    expect((await db.listAudit()).filter((entry) => entry.action.endsWith(".adjust") || entry.action === "manager.approval.applied")).toHaveLength(0);
    spy.mockRestore();
    await apply();
    await apply();
    const audits = (await db.listAudit()).filter((entry) => entry.action === "manager.approval.applied");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: "cashier", after: { approverId: "manager", amountDelta: 25 } });
  });
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
      before: { balanceMinor: 0 },
      after: { amountDeltaMinor: 1000, balanceMinor: 1000 },
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

  it("rolls back first-account creation on failed adjustments and rejects key reuse with different values", async () => {
    const { db, service, business, customer } = await fixture();
    await expect(service.adjustStoreCredit(business.id, "actor", "debit", customer.id,
      -100, "Unsupported debit", "credit-first-debit")).rejects.toThrow("STORE_CREDIT_INSUFFICIENT_BALANCE");
    expect(await db.findStoreCreditAccount(customer.id, business.id)).toBeNull();
    await service.adjustStoreCredit(business.id, "actor", "credit", customer.id,
      300, "Approved credit", "credit-first-key");
    await expect(service.adjustStoreCredit(business.id, "actor", "mismatch", customer.id,
      400, "Approved credit", "credit-first-key")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    const credit = await db.findStoreCreditAccount(customer.id, business.id);
    expect(await db.listStoreCreditTransactions(credit!.id, business.id)).toHaveLength(1);

    await service.adjustLoyalty(business.id, "actor", "loyalty", customer.id,
      20, "Approved points", "loyalty-first-key");
    await expect(service.adjustLoyalty(business.id, "actor", "mismatch", customer.id,
      21, "Approved points", "loyalty-first-key")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    const loyalty = await db.findLoyaltyAccount(customer.id, business.id);
    expect(await db.listLoyaltyTransactions(loyalty!.id, business.id)).toHaveLength(1);
  });

  it("uses integer loyalty math and snapshots program settings", async () => {
    const { service, business, customer } = await fixture();
    await service.saveLoyaltyProgram(business.id, { enabled: true, earnAmountMinor: 100, earnPoints: 3, redeemPoints: 100, redeemValueMinor: 50, minimumRedeemPoints: 100 });
    const result = await service.earnLoyalty(business.id, "actor", "req-1", customer.id, 250, "sale-1", "earn-1");
    expect(result.points).toBe(7);
    expect(result.snapshot.earnPointsSnapshot).toBe(3);
    await expect(service.redeemLoyalty(business.id, "actor", "req-2", customer.id, 100, "sale-2", "redeem-1")).rejects.toThrow("LOYALTY_INSUFFICIENT_POINTS");
  });
  it("writes one business audit per new manual adjustment and none on idempotent replay", async () => {
    const { db, service, business, customer } = await fixture();
    const issued = await service.issueGiftCard(business.id, "actor", "req-issue", "issue-1");

    await service.adjustGiftCard(business.id, "actor", "req-gift", issued.card.id, 500, "qa gift load", "gift-1");
    await service.adjustGiftCard(business.id, "actor", "req-gift-replay", issued.card.id, 500, "qa gift load", "gift-1");
    await service.adjustStoreCredit(business.id, "actor", "req-credit", customer.id, 250, "qa credit", "credit-1");
    await service.adjustStoreCredit(business.id, "actor", "req-credit-replay", customer.id, 250, "qa credit", "credit-1");
    await service.adjustLoyalty(business.id, "actor", "req-loyalty", customer.id, 10, "qa points", "loyalty-1");
    await service.adjustLoyalty(business.id, "actor", "req-loyalty-replay", customer.id, 10, "qa points", "loyalty-1");

    const audits = (await db.listAudit()).filter((entry) => entry.businessId === business.id);
    const adjustments = audits.filter((entry) => entry.action.endsWith(".adjust"));
    expect(adjustments.map((entry) => entry.action).sort()).toEqual([
      "gift-card.adjust",
      "loyalty.adjust",
      "store-credit.adjust",
    ]);
    expect(adjustments.find((entry) => entry.action === "gift-card.adjust")?.after).toEqual({ balanceMinor: 500, amountDeltaMinor: 500 });
    expect(adjustments.find((entry) => entry.action === "store-credit.adjust")?.after).toEqual({ balanceMinor: 250, amountDeltaMinor: 250 });
    expect(adjustments.find((entry) => entry.action === "loyalty.adjust")?.after).toEqual({ points: 10, pointsDelta: 10 });
  });

});
