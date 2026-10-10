import { createHmac, randomBytes } from "node:crypto";
import type { DbGiftCard, DbLoyaltyProgram, DbPort, DbSaleLoyalty, DbStoreCreditAccount } from "../common/db.port";
import { JournalPostingService } from "../accounting/journal-posting.service";
import { buildStoredValueAdjustmentDraft } from "../accounting/journal-rules";

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

  async adjustGiftCard(businessId: string, actorId: string, requestId: string, giftCardId: string, amountDeltaMinor: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<SafeGiftCard> {
    return (await this.adjustGiftCardWithMetadata(businessId, actorId, requestId, giftCardId, amountDeltaMinor, reason, counterAccountCode, idempotencyKey)).result;
  }

  async adjustGiftCardWithMetadata(businessId: string, actorId: string, requestId: string, giftCardId: string, amountDeltaMinor: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<StoredValueAdjustment<SafeGiftCard>> {
    if (!Number.isSafeInteger(amountDeltaMinor) || amountDeltaMinor === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    await new JournalPostingService(this.db).seedChart(businessId);
    return this.db.withLock(`gift-card:${businessId}:${giftCardId}`, async () => this.db.withTransaction(async (tx) => {
      const card = await tx.findGiftCardById(giftCardId, businessId);
      if (!card) throw new Error("NOT_FOUND");
      if (card.status === "SUSPENDED" || card.status === "VOID") throw new Error("GIFT_CARD_INVALID_STATUS");
      const existing = await tx.findGiftCardTransactionByIdempotency(businessId, idempotencyKey);
      if (existing && (existing.giftCardId !== giftCardId || existing.amountDeltaMinor !== amountDeltaMinor || existing.reason !== reason.trim())) throw new Error("IDEMPOTENCY_MISMATCH");
      const previousBalance = (await tx.listGiftCardTransactions(giftCardId, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      const account = await tx.findAccountingAccountByCode(businessId, counterAccountCode);
      if (!account?.isActive || account.code === "2300") throw new Error("ACCOUNTING_INVALID_ACCOUNT");
      const business = await tx.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const adjustment = existing ?? await tx.createGiftCardTransaction({ businessId, giftCardId, type: amountDeltaMinor > 0 ? "ADJUST_CREDIT" : "ADJUST_DEBIT", amountDeltaMinor, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim(), branchId: null });
      const draft = buildStoredValueAdjustmentDraft({ currency: business.currency, effectiveAt: adjustment.createdAt, liabilityAccountCode: "2300", counterAccountCode, amountMinor: Math.abs(amountDeltaMinor), liabilityDeltaPositive: amountDeltaMinor > 0, description: "Gift card balance adjustment" });
      await new JournalPostingService(tx).postSourceEvent({ businessId, branchId: null, sourceType: "GiftCardTransaction", sourceId: adjustment.id, sourceEvent: "adjusted", draft, actorId, requestId });
      const balance = (await tx.listGiftCardTransactions(giftCardId, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (!existing) {
        await tx.appendAudit({
          businessId,
          actorId,
          action: "gift-card.adjust",
          entityType: "GiftCard",
          entityId: giftCardId,
          requestId,
          reason: reason.trim(),
          before: { balanceMinor: previousBalance },
          after: { balanceMinor: balance, amountDeltaMinor, counterAccountCode },
        });
      }
      const result = { id: card.id, maskedCode: this.maskGiftCard(card), codeLast4: card.codeLast4, status: balance === 0 ? "EXHAUSTED" : card.status, balanceMinor: balance };
      return { result, created: !existing, previousBalance, newBalance: balance };
    }));
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

  async adjustStoreCredit(businessId: string, actorId: string, requestId: string, customerId: string, amountDeltaMinor: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<number> {
    return (await this.adjustStoreCreditWithMetadata(businessId, actorId, requestId, customerId, amountDeltaMinor, reason, counterAccountCode, idempotencyKey)).result;
  }

  async adjustStoreCreditWithMetadata(businessId: string, actorId: string, requestId: string, customerId: string, amountDeltaMinor: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<StoredValueAdjustment<number>> {
    if (!Number.isSafeInteger(amountDeltaMinor) || amountDeltaMinor === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    await new JournalPostingService(this.db).seedChart(businessId);
    return this.db.withLock(`store-credit:${businessId}:${customerId}`, async () => this.db.withTransaction(async (tx) => {
      if (!(await tx.findCustomerById(customerId, businessId))) throw new Error("NOT_FOUND");
      const account = await tx.createStoreCreditAccount({ businessId, customerId });
      const existing = await tx.findStoreCreditTransactionByIdempotency(businessId, idempotencyKey);
      if (existing && (existing.customerId !== customerId || existing.amountDeltaMinor !== amountDeltaMinor || existing.reason !== reason.trim())) throw new Error("IDEMPOTENCY_MISMATCH");
      const previousBalance = (await tx.listStoreCreditTransactions(account.id, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      const counter = await tx.findAccountingAccountByCode(businessId, counterAccountCode);
      if (!counter?.isActive || counter.code === "2310") throw new Error("ACCOUNTING_INVALID_ACCOUNT");
      const business = await tx.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const adjustment = existing ?? await tx.createStoreCreditTransaction({ businessId, accountId: account.id, customerId, type: amountDeltaMinor > 0 ? "MANUAL_CREDIT" : "MANUAL_DEBIT", amountDeltaMinor, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim(), branchId: null });
      const draft = buildStoredValueAdjustmentDraft({ currency: business.currency, effectiveAt: adjustment.createdAt, liabilityAccountCode: "2310", counterAccountCode, amountMinor: Math.abs(amountDeltaMinor), liabilityDeltaPositive: amountDeltaMinor > 0, description: "Store credit balance adjustment" });
      await new JournalPostingService(tx).postSourceEvent({ businessId, branchId: null, sourceType: "StoreCreditTransaction", sourceId: adjustment.id, sourceEvent: "adjusted", draft, actorId, requestId });
      const balance = (await tx.listStoreCreditTransactions(account.id, businessId)).reduce((sum, row) => sum + row.amountDeltaMinor, 0);
      if (!existing) {
        await tx.appendAudit({
          businessId,
          actorId,
          action: "store-credit.adjust",
          entityType: "StoreCreditAccount",
          entityId: account.id,
          requestId,
          reason: reason.trim(),
          before: { balanceMinor: previousBalance },
          after: { balanceMinor: balance, amountDeltaMinor, counterAccountCode },
        });
      }
      return { result: balance, created: !existing, previousBalance, newBalance: balance };
    }));
  }

  async saveLoyaltyProgram(businessId: string, input: Omit<DbLoyaltyProgram, "id" | "businessId" | "updatedAt" | "version">): Promise<DbLoyaltyProgram> {
    if (!Number.isSafeInteger(input.earnAmountMinor) || input.earnAmountMinor <= 0 || !Number.isSafeInteger(input.earnPoints) || input.earnPoints <= 0 || !Number.isSafeInteger(input.redeemPoints) || input.redeemPoints <= 0 || !Number.isSafeInteger(input.redeemValueMinor) || input.redeemValueMinor <= 0) throw new Error("VALIDATION");
    return this.db.upsertLoyaltyProgram({ ...input, businessId, version: 1 });
  }

  async getLoyaltyProgram(businessId: string): Promise<DbLoyaltyProgram | null> {
    return this.db.getLoyaltyProgram(businessId);
  }

  async ensureLoyaltyAccount(businessId: string, customerId: string) { if (!(await this.db.findCustomerById(customerId, businessId))) throw new Error("NOT_FOUND"); return this.db.createLoyaltyAccount({ businessId, customerId }); }

  async loyaltyBalance(businessId: string, customerId: string): Promise<number> { const account = await this.db.findLoyaltyAccount(customerId, businessId); if (!account) return 0; return (await this.db.listLoyaltyTransactions(account.id, businessId)).reduce((sum, row) => sum + row.pointsDelta, 0); }

  async adjustLoyalty(businessId: string, actorId: string, requestId: string, customerId: string, pointsDelta: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<number> {
    return (await this.adjustLoyaltyWithMetadata(businessId, actorId, requestId, customerId, pointsDelta, reason, counterAccountCode, idempotencyKey)).result;
  }

  async adjustLoyaltyWithMetadata(businessId: string, actorId: string, requestId: string, customerId: string, pointsDelta: number, reason: string, counterAccountCode: string, idempotencyKey: string): Promise<StoredValueAdjustment<number>> {
    if (!Number.isSafeInteger(pointsDelta) || pointsDelta === 0 || reason.trim().length < 3) throw new Error("VALIDATION");
    await new JournalPostingService(this.db).seedChart(businessId);
    return this.db.withLock(`loyalty:${businessId}:${customerId}`, async () => this.db.withTransaction(async (tx) => {
      if (!(await tx.findCustomerById(customerId, businessId))) throw new Error("NOT_FOUND");
      const account = await tx.createLoyaltyAccount({ businessId, customerId });
      const existing = await tx.findLoyaltyTransactionByIdempotency(businessId, idempotencyKey);
      if (existing && (existing.customerId !== customerId || existing.pointsDelta !== pointsDelta || existing.reason !== reason.trim())) throw new Error("IDEMPOTENCY_MISMATCH");
      const previousBalance = (await tx.listLoyaltyTransactions(account.id, businessId)).reduce((sum, row) => sum + row.pointsDelta, 0);
      const counter = await tx.findAccountingAccountByCode(businessId, counterAccountCode);
      if (!counter?.isActive || counter.code === "2320") throw new Error("ACCOUNTING_INVALID_ACCOUNT");
      const program = await tx.getLoyaltyProgram(businessId);
      if (!existing && (!program || program.redeemPoints <= 0 || program.redeemValueMinor <= 0)) throw new Error("ACCOUNTING_LOYALTY_VALUE_UNAVAILABLE");
      if (existing && existing.valueMinorSnapshot === null) throw new Error("ACCOUNTING_LOYALTY_VALUE_UNAVAILABLE");
      const valueMinorBigInt = existing
        ? BigInt(existing.valueMinorSnapshot!)
        : (BigInt(Math.abs(pointsDelta)) * BigInt(program!.redeemValueMinor)) / BigInt(program!.redeemPoints);
      if (valueMinorBigInt > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("ACCOUNTING_INVALID_AMOUNT");
      const valueMinor = Number(valueMinorBigInt);
      if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0) throw new Error("ACCOUNTING_INVALID_AMOUNT");
      const business = await tx.findBusinessById(businessId);
      if (!business) throw new Error("NOT_FOUND");
      const adjustment = existing ?? await tx.createLoyaltyTransaction({ businessId, accountId: account.id, customerId, type: pointsDelta > 0 ? "MANUAL_CREDIT" : "MANUAL_DEBIT", pointsDelta, valueMinorSnapshot: valueMinor, saleId: null, refundId: null, actorId, requestId, idempotencyKey, reason: reason.trim() });
      const draft = buildStoredValueAdjustmentDraft({ currency: business.currency, effectiveAt: adjustment.createdAt, liabilityAccountCode: "2320", counterAccountCode, amountMinor: valueMinor, liabilityDeltaPositive: pointsDelta > 0, description: "Loyalty points balance adjustment" });
      await new JournalPostingService(tx).postSourceEvent({ businessId, branchId: null, sourceType: "LoyaltyTransaction", sourceId: adjustment.id, sourceEvent: "adjusted", draft, actorId, requestId });
      const balance = (await tx.listLoyaltyTransactions(account.id, businessId)).reduce((sum, row) => sum + row.pointsDelta, 0);
      if (!existing) {
        await tx.appendAudit({
          businessId,
          actorId,
          action: "loyalty.adjust",
          entityType: "LoyaltyAccount",
          entityId: account.id,
          requestId,
          reason: reason.trim(),
          before: { points: previousBalance },
          after: { points: balance, pointsDelta, valueMinorSnapshot: adjustment.valueMinorSnapshot, counterAccountCode },
        });
      }
      return { result: balance, created: !existing, previousBalance, newBalance: balance };
    }));
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
