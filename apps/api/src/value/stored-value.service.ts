import { createHmac, randomBytes } from "node:crypto";
import type { DbGiftCard, DbLoyaltyProgram, DbPort, DbSaleLoyalty, DbStoreCreditAccount } from "../common/db.port";

const DEV_GIFT_CARD_SECRET = "phase20-development-only-gift-card-secret";

export interface SafeGiftCard {
  id: string;
  maskedCode: string;
  codeLast4: string;
  status: string;
  balanceMinor: number;
  /** Raw bearer codes are never returned by lookup; this exists only to make the redaction contract explicit. */
  code?: never;
}

export interface StoredValueAdjustment<T> {
  result: T;
  created: boolean;
  previousBalance: number;
  newBalance: number;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export class StoredValueService {
  constructor(private readonly db: DbPort) {}

  private giftCardSecret(): string {
    const secret = process.env["GIFT_CARD_CODE_SECRET"];
    if (secret && secret.length >= 32) return secret;
    if (process.env["NODE_ENV"] === "production") throw new Error("GIFT_CARD_CODE_SECRET_MISSING");
    return DEV_GIFT_CARD_SECRET;
  }

  hashGiftCardCode(code: string): string {
    return createHmac("sha256", this.giftCardSecret()).update(normalizeCode(code), "utf8").digest("hex");
  }

  private generatedCode(): string {
    const bytes = randomBytes(16).toString("hex").toUpperCase();
    return `NXP-GC-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 24)}-${bytes.slice(24, 28)}-${bytes.slice(28, 32)}`;
  }

  async issueGiftCard(businessId: string, actorId: string, requestId: string, idempotencyKey: string): Promise<{ card: DbGiftCard; code: string }> {
    return this.db.withLock(`gift-card:issue:${businessId}:${idempotencyKey}`, async () => {
      const prior = await this.db.findGiftCardTransactionByIdempotency(businessId, idempotencyKey);
      if (prior) {
        const existing = await this.db.findGiftCardById(prior.giftCardId, businessId);
        if (existing) return { card: existing, code: "" };
      }
      const code = this.generatedCode();
      const normalized = normalizeCode(code);
      const card = await this.db.createGiftCard({
        businessId,
        codeHash: this.hashGiftCardCode(normalized),
        codePrefix: normalized.slice(0, 7),
        codeLast4: normalized.slice(-4),
        status: "ACTIVE",
        createdBy: actorId,
        activatedAt: new Date(),
        suspendedAt: null,
        version: 1,
      });
      await this.db.createGiftCardTransaction({ businessId, giftCardId: card.id, type: "ISSUE", amountDeltaMinor: 0, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: null, branchId: null });
      await this.db.appendAudit({ businessId, actorId, action: "gift-card.issue", entityType: "GiftCard", entityId: card.id, requestId, after: { codeLast4: card.codeLast4 } });
      return { card, code };
    });
  }

  maskGiftCard(card: Pick<DbGiftCard, "codePrefix" | "codeLast4">): string {
    return `${card.codePrefix}••••${card.codeLast4}`;
  }

  async giftCardBalance(businessId: string, giftCardId: string): Promise<number> {
    const card = await this.db.findGiftCardById(giftCardId, businessId);
    if (!card) throw new Error("NOT_FOUND");
    const rows = await this.db.listGiftCardTransactions(giftCardId, businessId);
    return rows.reduce((sum, row) => sum + row.amountDeltaMinor, 0);
  }

  async lookupGiftCard(businessId: string, code: string): Promise<SafeGiftCard> {
    const card = await this.db.findGiftCardByHash(this.hashGiftCardCode(code), businessId);
    if (!card || card.status === "VOID") throw new Error("NOT_FOUND");
    return { id: card.id, maskedCode: this.maskGiftCard(card), codeLast4: card.codeLast4, status: card.status, balanceMinor: await this.giftCardBalance(businessId, card.id) };
  }

  async adjustGiftCard(businessId: string, actorId: string, requestId: string, giftCardId: string, amountDeltaMinor: number, reason: string, idempotencyKey: string): Promise<SafeGiftCard> {
    return (await this.adjustGiftCardWithMetadata(businessId, actorId, requestId, giftCardId, amountDeltaMinor, reason, idempotencyKey)).result;
  }

  async adjustGiftCardWithMetadata(businessId: string, actorId: string, requestId: string, giftCardId: string, amountDeltaMinor: number, reason: string, idempotencyKey: string): Promise<StoredValueAdjustment<SafeGiftCard>> {
    if (!Number.isInteger(amountDeltaMinor) || amountDeltaMinor === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(`gift-card:${businessId}:${giftCardId}`, async () => {
      const card = await this.db.findGiftCardById(giftCardId, businessId);
      if (!card) throw new Error("NOT_FOUND");
      if (card.status === "SUSPENDED" || card.status === "VOID") throw new Error("GIFT_CARD_INVALID_STATUS");
      const existing = await this.db.findGiftCardTransactionByIdempotency(businessId, idempotencyKey);
      const previousBalance = await this.giftCardBalance(businessId, giftCardId);
      if (!existing) {
        await this.db.createGiftCardTransaction({ businessId, giftCardId, type: amountDeltaMinor > 0 ? "ADJUST_CREDIT" : "ADJUST_DEBIT", amountDeltaMinor, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim(), branchId: null });
      }
      const balance = await this.giftCardBalance(businessId, giftCardId);
      if (!existing) {
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "gift-card.adjust",
          entityType: "GiftCard",
          entityId: giftCardId,
          requestId,
          reason: reason.trim(),
          before: { balanceMinor: previousBalance },
          after: { balanceMinor: balance, amountDeltaMinor },
        });
      }
      const result = { id: card.id, maskedCode: this.maskGiftCard(card), codeLast4: card.codeLast4, status: balance === 0 ? "EXHAUSTED" : card.status, balanceMinor: balance };
      return { result, created: !existing, previousBalance, newBalance: balance };
    });
  }

  async setGiftCardStatus(businessId: string, actorId: string, requestId: string, giftCardId: string, status: "SUSPENDED" | "ACTIVE", reason: string): Promise<SafeGiftCard> {
    if (reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(`gift-card:${businessId}:${giftCardId}`, async () => {
      const card = await this.db.findGiftCardById(giftCardId, businessId);
      if (!card || card.status === "VOID") throw new Error("NOT_FOUND");
      const updated = await this.db.updateGiftCard(giftCardId, businessId, { status, suspendedAt: status === "SUSPENDED" ? new Date() : null, version: card.version + 1 });
      await this.db.appendAudit({ businessId, actorId, action: `gift-card.${status.toLowerCase()}`, entityType: "GiftCard", entityId: giftCardId, requestId, reason });
      return { id: giftCardId, maskedCode: this.maskGiftCard(updated ?? card), codeLast4: card.codeLast4, status, balanceMinor: await this.giftCardBalance(businessId, giftCardId) };
    });
  }

  async ensureStoreCreditAccount(businessId: string, customerId: string): Promise<DbStoreCreditAccount> {
    const customer = await this.db.findCustomerById(customerId, businessId);
    if (!customer) throw new Error("NOT_FOUND");
    return this.db.createStoreCreditAccount({ businessId, customerId });
  }

  async storeCreditBalance(businessId: string, customerId: string): Promise<number> {
    const account = await this.db.findStoreCreditAccount(customerId, businessId);
    if (!account) return 0;
    return (await this.db.listStoreCreditTransactions(account.id, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
  }

  async adjustStoreCredit(businessId: string, actorId: string, requestId: string, customerId: string, amountDeltaMinor: number, reason: string, idempotencyKey: string): Promise<number> {
    return (await this.adjustStoreCreditWithMetadata(businessId, actorId, requestId, customerId, amountDeltaMinor, reason, idempotencyKey)).result;
  }

  async adjustStoreCreditWithMetadata(businessId: string, actorId: string, requestId: string, customerId: string, amountDeltaMinor: number, reason: string, idempotencyKey: string): Promise<StoredValueAdjustment<number>> {
    if (!Number.isInteger(amountDeltaMinor) || amountDeltaMinor === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(`store-credit:${businessId}:${customerId}`, async () => {
      const account = await this.ensureStoreCreditAccount(businessId, customerId);
      const existing = await this.db.findStoreCreditTransactionByIdempotency(businessId, idempotencyKey);
      const previousBalance = await this.storeCreditBalance(businessId, customerId);
      if (!existing) {
        await this.db.createStoreCreditTransaction({ businessId, accountId: account.id, customerId, type: amountDeltaMinor > 0 ? "MANUAL_CREDIT" : "MANUAL_DEBIT", amountDeltaMinor, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim(), branchId: null });
      }
      const balance = await this.storeCreditBalance(businessId, customerId);
      if (!existing) {
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "store-credit.adjust",
          entityType: "StoreCreditAccount",
          entityId: account.id,
          requestId,
          reason: reason.trim(),
          before: { balanceMinor: previousBalance },
          after: { balanceMinor: balance, amountDeltaMinor },
        });
      }
      return { result: balance, created: !existing, previousBalance, newBalance: balance };
    });
  }

  async saveLoyaltyProgram(businessId: string, input: Omit<DbLoyaltyProgram, "id" | "businessId" | "updatedAt" | "version">): Promise<DbLoyaltyProgram> {
    if (!Number.isInteger(input.earnAmountMinor) || input.earnAmountMinor <= 0 || !Number.isInteger(input.earnPoints) || input.earnPoints <= 0 || !Number.isInteger(input.redeemPoints) || input.redeemPoints <= 0 || !Number.isInteger(input.redeemValueMinor) || input.redeemValueMinor <= 0) throw new Error("VALIDATION");
    return this.db.upsertLoyaltyProgram({ ...input, businessId, version: 1 });
  }

  async getLoyaltyProgram(businessId: string): Promise<DbLoyaltyProgram | null> {
    return this.db.getLoyaltyProgram(businessId);
  }

  async ensureLoyaltyAccount(businessId: string, customerId: string) { if (!(await this.db.findCustomerById(customerId, businessId))) throw new Error("NOT_FOUND"); return this.db.createLoyaltyAccount({ businessId, customerId }); }

  async loyaltyBalance(businessId: string, customerId: string): Promise<number> { const account = await this.db.findLoyaltyAccount(customerId, businessId); if (!account) return 0; return (await this.db.listLoyaltyTransactions(account.id, businessId)).reduce((sum, row) => sum + row.pointsDelta, 0); }

  async adjustLoyalty(businessId: string, actorId: string, requestId: string, customerId: string, pointsDelta: number, reason: string, idempotencyKey: string): Promise<number> {
    return (await this.adjustLoyaltyWithMetadata(businessId, actorId, requestId, customerId, pointsDelta, reason, idempotencyKey)).result;
  }

  async adjustLoyaltyWithMetadata(businessId: string, actorId: string, requestId: string, customerId: string, pointsDelta: number, reason: string, idempotencyKey: string): Promise<StoredValueAdjustment<number>> {
    if (!Number.isInteger(pointsDelta) || pointsDelta === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    return this.db.withLock(`loyalty:${businessId}:${customerId}`, async () => {
      const account = await this.ensureLoyaltyAccount(businessId, customerId);
      const existing = await this.db.findLoyaltyTransactionByIdempotency(businessId, idempotencyKey);
      const previousBalance = await this.loyaltyBalance(businessId, customerId);
      if (!existing) {
        await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId, type: pointsDelta > 0 ? "MANUAL_CREDIT" : "MANUAL_DEBIT", pointsDelta, valueMinorSnapshot: null, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim() });
      }
      const balance = await this.loyaltyBalance(businessId, customerId);
      if (!existing) {
        await this.db.appendAudit({
          businessId,
          actorId,
          action: "loyalty.adjust",
          entityType: "LoyaltyAccount",
          entityId: account.id,
          requestId,
          reason: reason.trim(),
          before: { points: previousBalance },
          after: { points: balance, pointsDelta },
        });
      }
      return { result: balance, created: !existing, previousBalance, newBalance: balance };
    });
  }

  async earnLoyalty(businessId: string, actorId: string, requestId: string, customerId: string, eligibleSpendMinor: number, saleId: string, idempotencyKey: string): Promise<{ points: number; snapshot: DbSaleLoyalty }> {
    return this.db.withLock(`loyalty:${businessId}:${customerId}`, async () => {
      const program = await this.db.getLoyaltyProgram(businessId);
      if (!program || !program.enabled) throw new Error("LOYALTY_DISABLED");
      const account = await this.ensureLoyaltyAccount(businessId, customerId);
      const points = Math.floor(eligibleSpendMinor * program.earnPoints / program.earnAmountMinor);
      const existing = await this.db.findLoyaltyTransactionByIdempotency(businessId, idempotencyKey);
      if (!existing && points > 0) await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId, type: "EARN", pointsDelta: points, valueMinorSnapshot: eligibleSpendMinor, saleId, refundId: null, actorId, requestId, idempotencyKey, reason: null });
      const snapshot = await this.db.findSaleLoyalty(saleId, businessId) ?? await this.db.createSaleLoyalty({ businessId, saleId, customerId, loyaltyAccountId: account.id, programVersion: program.version, eligibleSpendMinor, earnedPoints: points, redeemedPoints: 0, redeemedValueMinor: 0, earnAmountMinorSnapshot: program.earnAmountMinor, earnPointsSnapshot: program.earnPoints, redeemPointsSnapshot: program.redeemPoints, redeemValueMinorSnapshot: program.redeemValueMinor });
      return { points, snapshot };
    });
  }

  async redeemLoyalty(businessId: string, actorId: string, requestId: string, customerId: string, points: number, saleId: string, idempotencyKey: string): Promise<number> {
    return this.db.withLock(`loyalty:${businessId}:${customerId}`, async () => {
      const program = await this.db.getLoyaltyProgram(businessId); if (!program || !program.enabled) throw new Error("LOYALTY_DISABLED");
      if (!Number.isInteger(points) || points <= 0 || (program.minimumRedeemPoints !== null && points < program.minimumRedeemPoints)) throw new Error("VALIDATION");
      const account = await this.ensureLoyaltyAccount(businessId, customerId); const value = Math.floor(points * program.redeemValueMinor / program.redeemPoints);
      if (value <= 0) throw new Error("VALIDATION");
      if (!(await this.db.findLoyaltyTransactionByIdempotency(businessId, idempotencyKey))) await this.db.createLoyaltyTransaction({ businessId, accountId: account.id, customerId, type: "REDEEM", pointsDelta: -points, valueMinorSnapshot: value, saleId, refundId: null, actorId, requestId, idempotencyKey, reason: null });
      return value;
    });
  }
}
