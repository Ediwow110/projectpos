import type { DbAccountingAccount, DbJournalEntry, DbJournalLine, DbPort } from "../common/db.port";
import { DEFAULT_ACCOUNTS } from "./chart-of-accounts";
import { validateJournalDraft } from "./journal-rules";
import type { JournalDraft, JournalLineDraft } from "./accounting-types";
import type { AccountType, NormalSide } from "./accounting-types";

export interface PostSourceEventInput {
  businessId: string;
  branchId: string | null;
  sourceType: string;
  sourceId: string;
  sourceEvent: string;
  draft: JournalDraft;
  actorId: string;
  requestId: string;
  reversesEntryId?: string | null;
}

export class JournalPostingService {
  constructor(private readonly db: DbPort) {}

  async seedChart(businessId: string): Promise<DbAccountingAccount[]> {
    return this.db.withLock(`accounting-chart:${businessId}`, async () => this.db.withTransaction(async (tx) => {
      for (const definition of DEFAULT_ACCOUNTS) {
        const existing = await tx.findAccountingAccountByCode(businessId, definition.code);
        if (existing) {
          if (!existing.isSystem || existing.type !== definition.type || existing.normalSide !== definition.normalSide) throw new Error("ACCOUNTING_SYSTEM_ACCOUNT_MISMATCH");
          continue;
        }
        await tx.createAccountingAccount({ code: definition.code, name: definition.name, type: definition.type, normalSide: definition.normalSide, businessId, isSystem: definition.system, isActive: true });
      }
      return tx.listAccountingAccounts(businessId);
    }));
  }

  async createAccount(input: { businessId: string; code: string; name: string; type: AccountType; normalSide: NormalSide; actorId: string; requestId: string }): Promise<DbAccountingAccount> {
    if (!/^[0-9A-Z_-]{2,16}$/.test(input.code) || !input.name.trim()) throw new Error("VALIDATION");
    if (["asset", "expense"].includes(input.type) !== (input.normalSide === "debit")) throw new Error("ACCOUNTING_INVALID_ACCOUNT_TYPE");
    const created = await this.db.withLock(`accounting-chart:${input.businessId}`, async () => this.db.withTransaction(async (tx) => tx.createAccountingAccount({
      businessId: input.businessId, code: input.code, name: input.name.trim(), type: input.type, normalSide: input.normalSide, isSystem: false, isActive: true,
    })));
    await this.db.appendAudit({ businessId: input.businessId, actorId: input.actorId, action: "accounting.account.create", entityType: "AccountingAccount", entityId: created.id, requestId: input.requestId, after: { code: created.code, name: created.name, type: created.type, normalSide: created.normalSide } });
    return created;
  }

  async updateAccount(input: { businessId: string; accountId: string; name?: string; isActive?: boolean; actorId: string; requestId: string }): Promise<DbAccountingAccount> {
    const accounts = await this.db.listAccountingAccounts(input.businessId);
    const before = accounts.find((account) => account.id === input.accountId);
    if (!before) throw new Error("NOT_FOUND");
    if (before.isSystem && input.isActive === false) throw new Error("ACCOUNTING_SYSTEM_ACCOUNT_PROTECTED");
    if (input.isActive === false && await this.db.isAccountingAccountUsed(input.businessId, before.id)) throw new Error("ACCOUNTING_ACCOUNT_IN_USE");
    const updated = await this.db.updateAccountingAccount(before.id, input.businessId, { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) });
    if (!updated) throw new Error("NOT_FOUND");
    await this.db.appendAudit({ businessId: input.businessId, actorId: input.actorId, action: "accounting.account.update", entityType: "AccountingAccount", entityId: updated.id, requestId: input.requestId, before: { name: before.name, isActive: before.isActive }, after: { name: updated.name, isActive: updated.isActive } });
    return updated;
  }

  async postSourceEvent(input: PostSourceEventInput): Promise<{ entry: DbJournalEntry; lines: DbJournalLine[] }> {
    validateJournalDraft(input.draft);
    if (!input.businessId || !input.sourceType || !input.sourceId || !input.sourceEvent || !input.actorId || !input.requestId) throw new Error("ACCOUNTING_INVALID_SOURCE");
    const business = await this.db.findBusinessById(input.businessId);
    if (!business) throw new Error("NOT_FOUND");
    if (business.currency !== input.draft.currency) throw new Error("ACCOUNTING_CURRENCY_MISMATCH");
    if (input.branchId !== null && !(await this.db.findBranchById(input.branchId, input.businessId))) throw new Error("FORBIDDEN");
    await this.seedChart(input.businessId);

    const lockKey = `journal:${input.businessId}:${input.sourceType}:${input.sourceId}:${input.sourceEvent}`;
    return this.db.withLock(lockKey, async () => this.db.withTransaction(async (tx) => {
      const existing = await tx.findJournalEntryBySource(input.businessId, input.sourceType, input.sourceId, input.sourceEvent);
      if (existing) {
        if (!(await this.sameDraft(tx, existing.lines, input.draft.lines)) || existing.entry.effectiveAt.getTime() !== input.draft.effectiveAt.getTime() || existing.entry.currency !== input.draft.currency || existing.entry.branchId !== input.branchId) {
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
        return existing;
      }
      const accountRows = await tx.listAccountingAccounts(input.businessId);
      const byCode = new Map(accountRows.map((account) => [account.code, account]));
      const lines = input.draft.lines.map((line) => {
        const account = byCode.get(line.accountCode);
        if (!account || !account.isActive) throw new Error("ACCOUNTING_INVALID_ACCOUNT");
        return { accountId: account.id, debitMinor: line.debitMinor, creditMinor: line.creditMinor, memo: line.memo ?? null };
      });
      return tx.createJournalEntry({
        businessId: input.businessId, branchId: input.branchId, sourceType: input.sourceType, sourceId: input.sourceId,
        sourceEvent: input.sourceEvent, effectiveAt: input.draft.effectiveAt, currency: input.draft.currency,
        description: input.draft.description, actorId: input.actorId, requestId: input.requestId,
        reversesEntryId: input.reversesEntryId ?? null, lines,
      });
    }));
  }

  async reverse(entryId: string, businessId: string, actorId: string, requestId: string, effectiveAt = new Date()): Promise<{ entry: DbJournalEntry; lines: DbJournalLine[] }> {
    const original = await this.db.findJournalEntryById(entryId, businessId);
    if (!original) throw new Error("NOT_FOUND");
    const priorReversal = await this.db.findJournalEntryBySource(businessId, "JournalReversal", entryId, "reversal");
    if (priorReversal) {
      if (priorReversal.entry.reversesEntryId !== entryId) throw new Error("CONFLICT");
      return priorReversal;
    }
    const originalLines = await this.db.listJournalLines(entryId, businessId);
    const accounts = await this.db.listAccountingAccounts(businessId);
    const codeById = new Map(accounts.map((account) => [account.id, account.code]));
    const reversalLines: JournalLineDraft[] = originalLines.map((line) => {
      const accountCode = codeById.get(line.accountId);
      if (!accountCode) throw new Error("ACCOUNTING_INVALID_ACCOUNT");
      return { accountCode, debitMinor: line.creditMinor, creditMinor: line.debitMinor, memo: `Reversal of ${entryId}` };
    });
    const reversal = await this.postSourceEvent({
      businessId, branchId: original.branchId, sourceType: "JournalReversal", sourceId: entryId, sourceEvent: "reversal",
      draft: { effectiveAt, currency: original.currency, description: `Reversal of ${entryId}`, lines: reversalLines },
      actorId, requestId, reversesEntryId: entryId,
    });
    await this.db.appendAudit({ businessId, actorId, action: "accounting.journal.reverse", entityType: "JournalEntry", entityId: reversal.entry.id, requestId, reason: `Reversal of ${entryId}` });
    return reversal;
  }

  private async sameDraft(tx: DbPort, lines: DbJournalLine[], draftLines: JournalLineDraft[]): Promise<boolean> {
    const accounts = await tx.listAccountingAccounts(lines[0]?.businessId ?? "");
    const codeById = new Map(accounts.map((account) => [account.id, account.code]));
    const normalize = (rows: Array<{ accountCode: string; debitMinor: number; creditMinor: number; memo?: string | null }>) => rows
      .map((line) => `${line.accountCode}|${line.debitMinor}|${line.creditMinor}|${line.memo ?? ""}`).sort();
    return JSON.stringify(normalize(lines.map((line) => ({ accountCode: codeById.get(line.accountId) ?? "", debitMinor: line.debitMinor, creditMinor: line.creditMinor, memo: line.memo })))) === JSON.stringify(normalize(draftLines));
  }
}
