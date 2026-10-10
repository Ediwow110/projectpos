import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { accountingAccountCreateSchema, accountingAccountUpdateSchema, accountingBackfillIssueResolutionSchema, accountingOpeningBalanceSchema } from "@pos/validation";
import { AuthService } from "../auth/nest/auth.service";
import type { DbPort } from "../common/db.port";
import { CsrfGuard } from "../common/csrf.guard";
import { fail, failFromError } from "../common/http-helpers";
import { SessionGuard } from "../common/session.guard";
import { getCorrelationId } from "../correlation";
import { JournalPostingService } from "./journal-posting.service";
import { buildOpeningBalanceDraft } from "./opening-balance";
import { validateJournalDraft } from "./journal-rules";
import { AccountingBackfillService } from "./accounting-backfill.service";

function requestId(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

function accountingCsvCell(value: string | number): string {
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

@Controller("api/v1/accounting")
@UseGuards(SessionGuard)
export class AccountingController {
  constructor(
    @Inject(JournalPostingService) private readonly journals: JournalPostingService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private allowed(req: Request, permission: string): boolean {
    return this.auth.rolePermissions(req.auth!.role).includes(permission);
  }

  private reportRange(query: Record<string, string | undefined>): { dateFrom?: Date; dateTo?: Date; branchId?: string | null } | null {
    const parse = (value: string | undefined, end = false): Date | undefined | null => {
      if (!value) return undefined;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const result = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== value) return null;
      if (end) result.setUTCDate(result.getUTCDate() + 1);
      return result;
    };
    const dateFrom = parse(query["dateFrom"]);
    const dateTo = parse(query["dateTo"], true);
    if (dateFrom === null || dateTo === null || (dateFrom && dateTo && dateFrom >= dateTo)) return null;
    if (dateFrom && dateTo && dateTo.getTime() - dateFrom.getTime() > 366 * 24 * 60 * 60 * 1000) return null;
    const branch = query["branchId"];
    if (branch !== undefined && branch.length === 0) return null;
    return { ...(dateFrom ? { dateFrom } : {}), ...(dateTo ? { dateTo } : {}), ...(branch !== undefined ? { branchId: branch === "head-office" ? null : branch } : {}) };
  }

  @Get("journal")
  async journal(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    const range = this.reportRange(query);
    const limit = query["limit"] === undefined ? 50 : Number(query["limit"]);
    const accountId = query["accountId"];
    if (!range || !Number.isInteger(limit) || limit < 1 || limit > 100 || (accountId !== undefined && !accountId.trim())) return fail(res, 400, "VALIDATION", "Invalid journal filters", req);
    let after: { effectiveAt: Date; id: string } | undefined;
    if (query["cursor"]) {
      try {
        const cursor = JSON.parse(Buffer.from(query["cursor"], "base64url").toString("utf8")) as { at?: string; id?: string };
        const effectiveAt = new Date(cursor.at ?? "");
        if (!cursor.id || Number.isNaN(effectiveAt.getTime())) throw new Error("invalid cursor");
        after = { effectiveAt, id: cursor.id };
      } catch { return fail(res, 400, "VALIDATION", "Invalid journal cursor", req); }
    }
    try {
      const businessId = req.auth!.businessId;
      if (range.branchId !== undefined && range.branchId !== null && !(await this.db.findBranchById(range.branchId, businessId))) return fail(res, 403, "FORBIDDEN", "Branch access denied", req);
      if (accountId && !(await this.db.listAccountingAccounts(businessId)).some((account) => account.id === accountId)) return fail(res, 404, "NOT_FOUND", "Accounting account not found", req);
      const branchId = range.branchId !== undefined ? range.branchId : req.auth!.activeBranchId ?? undefined;
      const entries = await this.db.listJournalEntries(businessId, { ...range, branchId, ...(accountId ? { accountId } : {}), ...(after ? { after } : {}), limit: limit + 1 });
      const hasMore = entries.length > limit;
      const page = entries.slice(0, limit);
      const accounts = await this.db.listAccountingAccounts(businessId);
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      const rows = await Promise.all(page.map(async (entry) => ({ entry, lines: (await this.db.listJournalLines(entry.id, businessId)).map((line) => ({ ...line, accountCode: accountById.get(line.accountId)?.code ?? "", accountName: accountById.get(line.accountId)?.name ?? "Account" })) })));
      const last = page.at(-1);
      res.status(200).json({ items: rows, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ at: last.effectiveAt.toISOString(), id: last.id })).toString("base64url") : null });
    } catch (error) { failFromError(res, error, "Journal could not be loaded", req); }
  }

  @Get("journal.csv")
  async journalCsv(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    const range = this.reportRange(query);
    if (!range) return fail(res, 400, "VALIDATION", "Invalid journal export filters", req);
    try {
      const businessId = req.auth!.businessId;
      if (range.branchId !== undefined && range.branchId !== null && !(await this.db.findBranchById(range.branchId, businessId))) return fail(res, 403, "FORBIDDEN", "Branch access denied", req);
      const branchId = range.branchId !== undefined ? range.branchId : req.auth!.activeBranchId ?? undefined;
      const accounts = await this.db.listAccountingAccounts(businessId);
      const accountById = new Map(accounts.map((account) => [account.id, account]));
      res.status(200).set("Content-Type", "text/csv; charset=utf-8");
      res.write("\uFEFFdate,sourceType,sourceId,accountCode,accountName,debitMinor,creditMinor,memo\n");
      let after: { effectiveAt: Date; id: string } | undefined;
      for (;;) {
        const entries = await this.db.listJournalEntries(businessId, { ...range, branchId, ...(after ? { after } : {}), limit: 101 });
        const page = entries.slice(0, 100);
        for (const entry of page) {
          const lines = await this.db.listJournalLines(entry.id, businessId);
          for (const line of lines) {
            const account = accountById.get(line.accountId);
            const cells = [entry.effectiveAt.toISOString(), entry.sourceType, entry.sourceId, account?.code ?? "", account?.name ?? "Account", line.debitMinor, line.creditMinor, line.memo ?? ""];
            res.write(cells.map(accountingCsvCell).join(",") + "\n");
          }
        }
        if (entries.length <= 100) break;
        const last = page.at(-1);
        if (!last) break;
        after = { effectiveAt: last.effectiveAt, id: last.id };
      }
      await this.db.appendAudit({ businessId, actorId: req.auth!.userId, action: "accounting.journal_csv.export", entityType: "JournalEntry", entityId: businessId, requestId: requestId(req), after: { dateFrom: range.dateFrom?.toISOString() ?? null, dateTo: range.dateTo?.toISOString() ?? null, branchId: branchId ?? null } });
      res.end();
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      failFromError(res, error, "Journal CSV export failed", req);
    }
  }

  @Get("trial-balance")
  async trialBalance(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    const range = this.reportRange(query);
    if (!range) return fail(res, 400, "VALIDATION", "Invalid trial balance date range", req);
    try {
      const businessId = req.auth!.businessId;
      if (range.branchId !== undefined && range.branchId !== null && !(await this.db.findBranchById(range.branchId, businessId))) return fail(res, 403, "FORBIDDEN", "Branch access denied", req);
      const branchId = range.branchId !== undefined ? range.branchId : req.auth!.activeBranchId ?? undefined;
      const items = await this.db.aggregateJournalAccountTotals(businessId, { ...range, branchId });
      const rows = items.map(({ account, debitMinor, creditMinor }) => {
        const net = debitMinor - creditMinor;
        return { accountId: account.id, code: account.code, name: account.name, type: account.type, debitMinor, creditMinor, debitBalanceMinor: Math.max(0, net), creditBalanceMinor: Math.max(0, -net) };
      });
      res.status(200).json({ items: rows, debitMinor: rows.reduce((sum, row) => sum + row.debitMinor, 0), creditMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0), currency: (await this.db.findBusinessById(businessId))?.currency ?? null, range: { from: range.dateFrom?.toISOString() ?? null, toExclusive: range.dateTo?.toISOString() ?? null }, completeness: "posted-journal-only" });
    } catch (error) { failFromError(res, error, "Trial balance could not be loaded", req); }
  }

  @Get("profit-and-loss")
  async profitAndLoss(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    const range = this.reportRange(query);
    if (!range) return fail(res, 400, "VALIDATION", "Invalid profit and loss date range", req);
    const businessId = req.auth!.businessId;
    if (range.branchId !== undefined && range.branchId !== null && !(await this.db.findBranchById(range.branchId, businessId))) return fail(res, 403, "FORBIDDEN", "Branch access denied", req);
    try {
      const activation = await this.db.findAccountingActivation(businessId);
      if (activation?.status !== "ACTIVE" || !activation.accountingStartAt) return fail(res, 409, "ACCOUNTING_ACTIVATION_REQUIRED", "Profit and loss is unavailable until historical activation and reconciliation are complete", req);
      if (range.dateFrom && range.dateFrom < activation.accountingStartAt) return fail(res, 400, "ACCOUNTING_RANGE_BEFORE_START", "Report range cannot begin before the accounting start date", req);
      const effectiveRange = { ...range, dateFrom: range.dateFrom ?? activation.accountingStartAt };
      const branchId = range.branchId !== undefined ? range.branchId : req.auth!.activeBranchId ?? undefined;
      const totals = await this.db.aggregateJournalAccountTotals(businessId, { ...effectiveRange, branchId });
      const revenue = totals.filter(({ account }) => account.type === "revenue").map(({ account, debitMinor, creditMinor }) => ({ accountId: account.id, code: account.code, name: account.name, amountMinor: creditMinor - debitMinor }));
      const expenses = totals.filter(({ account }) => account.type === "expense").map(({ account, debitMinor, creditMinor }) => ({ accountId: account.id, code: account.code, name: account.name, amountMinor: debitMinor - creditMinor }));
      const revenueMinor = revenue.reduce((sum, row) => sum + row.amountMinor, 0);
      const expensesMinor = expenses.reduce((sum, row) => sum + row.amountMinor, 0);
      const latest = await this.db.listJournalEntries(businessId, { ...effectiveRange, branchId, limit: 1 });
      res.status(200).json({
        revenue, expenses, revenueMinor, expensesMinor, netIncomeMinor: revenueMinor - expensesMinor,
        currency: (await this.db.findBusinessById(businessId))?.currency ?? null,
        range: { from: effectiveRange.dateFrom?.toISOString() ?? null, toExclusive: range.dateTo?.toISOString() ?? null },
        latestEntryAt: latest[0]?.effectiveAt.toISOString() ?? null,
        completeness: "posted-journal-only", historicalActivationRequired: false,
      });
    } catch (error) { failFromError(res, error, "Profit and loss could not be loaded", req); }
  }

  @Get("activation")
  async activation(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    try {
      const businessId = req.auth!.businessId;
      const [activation, latestBackfillRun] = await Promise.all([this.db.findAccountingActivation(businessId), this.db.findLatestAccountingBackfillRun(businessId)]);
      const issues = latestBackfillRun ? await this.db.listAccountingBackfillIssues(latestBackfillRun.id, businessId, 20) : [];
      const backfillIssues = await Promise.all(issues.map(async (issue) => {
        if (issue.sourceType === "InventoryMovement") {
          const movement = (await this.db.listMovementsByBusiness(businessId)).find((row) => row.id === issue.sourceId);
          return { ...issue, sourceDetails: movement ? { qtyDelta: movement.qtyDelta, productId: movement.productId } : null };
        }
        if (issue.sourceType === "InventoryCount") {
          const count = await this.db.findInventoryCountById(issue.sourceId, businessId);
          const lines = count ? await this.db.listInventoryCountLines(count.id, businessId) : [];
          return { ...issue, sourceDetails: { lines: lines.filter((line) => line.varianceQty !== null && line.varianceQty !== 0).map((line) => ({ lineId: line.id, productName: line.productNameSnapshot, varianceQty: line.varianceQty })) } };
        }
        if (issue.sourceType === "StoredValue") {
          const sources = await new AccountingBackfillService(this.db).storedValueIssueDetails(businessId, activation?.accountingStartAt ?? undefined);
          return { ...issue, sourceDetails: { transactions: sources.map((row) => ({ ...row, effectiveAt: row.effectiveAt.toISOString() })) } };
        }
        return { ...issue, sourceDetails: null };
      }));
      res.status(200).json({ ...(activation ?? { businessId, status: "NOT_STARTED", accountingStartAt: null, openingEntryId: null, csvCutoverAt: null }), latestBackfillRun, backfillIssues });
    } catch (error) { failFromError(res, error, "Accounting activation status could not be loaded", req); }
  }

  @Post("activation/opening-balance/preview")
  @UseGuards(CsrfGuard)
  async previewOpeningBalance(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (req.auth!.role !== "owner") return fail(res, 403, "FORBIDDEN", "Only the business owner can prepare opening balances", req);
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingOpeningBalanceSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid opening balance worksheet", req);
    const startAt = new Date(`${parsed.data.accountingStartAt}T00:00:00.000Z`);
    if (startAt.toISOString().slice(0, 10) !== parsed.data.accountingStartAt) return fail(res, 400, "ACCOUNTING_INVALID_DATE", "Invalid accounting start date", req);
    const businessId = req.auth!.businessId;
    const business = await this.db.findBusinessById(businessId);
    if (!business) return fail(res, 404, "NOT_FOUND", "Business not found", req);
    try {
      const accounts = await this.journals.seedChart(businessId);
      const draft = buildOpeningBalanceDraft({ accountingStartAt: startAt, currency: business.currency, lines: parsed.data.lines, accounts });
      const totals = validateJournalDraft(draft);
      res.status(200).json({ draft, totals, retainedEarningsAccount: accounts.find((account) => account.code === "3000") ?? null });
    } catch (error) { failFromError(res, error, "Opening balance worksheet preview failed", req); }
  }

  @Post("activation/opening-balance")
  @UseGuards(CsrfGuard)
  async confirmOpeningBalance(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (req.auth!.role !== "owner") return fail(res, 403, "FORBIDDEN", "Only the business owner can confirm opening balances", req);
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingOpeningBalanceSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid opening balance worksheet", req);
    const keyHeader = req.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) return fail(res, 400, "VALIDATION", "A valid Idempotency-Key header is required", req);
    const startAt = new Date(`${parsed.data.accountingStartAt}T00:00:00.000Z`);
    if (startAt.toISOString().slice(0, 10) !== parsed.data.accountingStartAt) return fail(res, 400, "ACCOUNTING_INVALID_DATE", "Invalid accounting start date", req);
    const businessId = req.auth!.businessId;
    const business = await this.db.findBusinessById(businessId);
    if (!business) return fail(res, 404, "NOT_FOUND", "Business not found", req);
    let draft;
    try {
      const accounts = await this.journals.seedChart(businessId);
      draft = buildOpeningBalanceDraft({ accountingStartAt: startAt, currency: business.currency, lines: parsed.data.lines, accounts });
    } catch (error) { return failFromError(res, error, "Opening balance worksheet is not balanced", req); }

    try {
      const result = await this.db.withLock(`accounting-activation:${businessId}`, async () => this.db.withTransaction(async (tx) => {
        const current = await tx.findAccountingActivation(businessId);
        if (current && !["NOT_STARTED", "REVIEW", "BACKFILLING"].includes(current.status)) throw new Error("ACCOUNTING_ACTIVATION_IN_PROGRESS");
        const latestBackfill = await tx.findLatestAccountingBackfillRun(businessId);
        if (latestBackfill?.status === "RUNNING") throw new Error("ACCOUNTING_ACTIVATION_IN_PROGRESS");
        const journals = new JournalPostingService(tx);
        const originalOpening = await tx.findJournalEntryBySource(businessId, "AccountingOpening", businessId, "opening-balance");
        if (originalOpening?.entry.requestId === idempotencyKey) {
          const replay = await journals.postSourceEvent({ businessId, branchId: null, sourceType: "AccountingOpening", sourceId: businessId, sourceEvent: "opening-balance", draft, actorId: req.auth!.userId, requestId: idempotencyKey });
          return { activation: current, entry: replay.entry };
        }
        const priorRevision = await tx.findJournalEntryBySource(businessId, "AccountingOpeningRevision", idempotencyKey, "opening-balance");
        if (priorRevision) {
          const replay = await journals.postSourceEvent({ businessId, branchId: null, sourceType: "AccountingOpeningRevision", sourceId: idempotencyKey, sourceEvent: "opening-balance", draft, actorId: req.auth!.userId, requestId: idempotencyKey });
          return { activation: current, entry: replay.entry };
        }
        if (latestBackfill && current?.accountingStartAt?.getTime() !== startAt.getTime()) throw new Error("ACCOUNTING_ACTIVATION_IN_PROGRESS");
        if (current?.openingEntryId) {
          const previous = await tx.findJournalEntryById(current.openingEntryId, businessId);
          if (!previous) throw new Error("ACCOUNTING_ENTRY_NOT_FOUND");
          await journals.reverse(previous.id, businessId, req.auth!.userId, idempotencyKey, new Date());
        }
        const posted = await journals.postSourceEvent({
          businessId, branchId: null,
          sourceType: current?.openingEntryId ? "AccountingOpeningRevision" : "AccountingOpening",
          sourceId: current?.openingEntryId ? idempotencyKey : businessId,
          sourceEvent: "opening-balance", draft, actorId: req.auth!.userId, requestId: idempotencyKey,
        });
        const activation = await tx.saveAccountingActivation({
          businessId, status: current?.status === "BACKFILLING" ? "BACKFILLING" : "REVIEW", accountingStartAt: startAt, openingEntryId: posted.entry.id, csvCutoverAt: null,
        });
        await tx.appendAudit({ businessId, actorId: req.auth!.userId, action: current?.openingEntryId ? "accounting.opening_balance.revise" : "accounting.opening_balance.confirm", entityType: "JournalEntry", entityId: posted.entry.id, requestId: idempotencyKey, ...(current?.openingEntryId ? { before: { openingEntryId: current.openingEntryId, accountingStartAt: current.accountingStartAt?.toISOString() ?? null } } : {}), after: { openingEntryId: posted.entry.id, accountingStartAt: startAt.toISOString(), lineCount: draft.lines.length } });
        return { activation, entry: posted.entry };
      }));
      res.status(201).json(result);
    } catch (error) { failFromError(res, error, "Opening balance worksheet could not be confirmed", req); }
  }

  @Post("activation/backfill")
  @UseGuards(CsrfGuard)
  async startBackfill(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (req.auth!.role !== "owner" || !this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Only the business owner can start historical activation", req);
    const keyHeader = req.headers["idempotency-key"];
    const requestKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!requestKey || requestKey.length < 8 || requestKey.length > 128) return fail(res, 400, "VALIDATION", "A valid Idempotency-Key header is required", req);
    try {
      const run = await new AccountingBackfillService(this.db).start({ businessId: req.auth!.businessId, actorId: req.auth!.userId, requestId: requestKey });
      res.status(202).json(run);
    } catch (error) { failFromError(res, error, "Historical activation could not start", req); }
  }

  @Get("activation/backfill/:runId")
  async getBackfill(@Req() req: Request, @Res() res: Response, @Param("runId") runId: string): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    try {
      const run = await this.db.findAccountingBackfillRun(runId, req.auth!.businessId);
      if (!run) return fail(res, 404, "NOT_FOUND", "Backfill run not found", req);
      const issues = await this.db.listAccountingBackfillIssues(runId, req.auth!.businessId, 100);
      res.status(200).json({ run, issues });
    } catch (error) { failFromError(res, error, "Historical activation status could not be loaded", req); }
  }

  @Post("activation/backfill/:runId/issues/:issueId/resolve")
  @UseGuards(CsrfGuard)
  async resolveBackfillIssue(@Req() req: Request, @Res() res: Response, @Param("runId") runId: string, @Param("issueId") issueId: string, @Body() body: unknown): Promise<void> {
    if (req.auth!.role !== "owner" || !this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Only the business owner can resolve historical accounting issues", req);
    const parsed = accountingBackfillIssueResolutionSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid historical cost evidence", req);
    const keyHeader = req.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) return fail(res, 400, "VALIDATION", "A valid Idempotency-Key header is required", req);
    try {
      const service = new AccountingBackfillService(this.db);
      const result = parsed.data.storedValueAdjustments
        ? await service.resolveStoredValueIssue({ businessId: req.auth!.businessId, runId, issueId, actorId: req.auth!.userId, requestId: idempotencyKey, evidence: parsed.data.evidence, storedValueAdjustments: parsed.data.storedValueAdjustments })
        : await service.resolveInventoryIssue({ businessId: req.auth!.businessId, runId, issueId, actorId: req.auth!.userId, requestId: idempotencyKey, ...parsed.data });
      res.status(201).json(result);
    } catch (error) { failFromError(res, error, "Historical cost issue could not be resolved", req); }
  }

  @Post("activation/backfill/:runId/run")
  @UseGuards(CsrfGuard)
  async runBackfillBatch(@Req() req: Request, @Res() res: Response, @Param("runId") runId: string, @Body() body: unknown): Promise<void> {
    if (req.auth!.role !== "owner" || !this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Only the business owner can run historical activation", req);
    if (typeof body !== "object" || body === null || !("expectedCursor" in body)) return fail(res, 400, "VALIDATION", "Expected backfill cursor is required", req);
    const cursor = (body as { expectedCursor?: unknown }).expectedCursor;
    if (typeof cursor !== "object" || cursor === null || !("family" in cursor) || !("afterId" in cursor)) return fail(res, 400, "VALIDATION", "Expected backfill cursor is invalid", req);
    const expectedCursor = cursor as { family: string; afterId: string | null };
    if (!(["sales", "expenses", "refunds", "purchase-receipts", "supplier-returns", "supplier-bills", "inventory-counts", "inventory-movements", "remaining"].includes(expectedCursor.family) && (expectedCursor.afterId === null || typeof expectedCursor.afterId === "string"))) return fail(res, 400, "VALIDATION", "Expected backfill cursor is invalid", req);
    try {
      const run = await new AccountingBackfillService(this.db).runBatch({ businessId: req.auth!.businessId, runId, actorId: req.auth!.userId, requestId: requestId(req), expectedCursor });
      res.status(200).json(run);
    } catch (error) { failFromError(res, error, "Historical activation batch failed", req); }
  }

  @Get("accounts")
  async accounts(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    try {
      const rows = await this.journals.seedChart(req.auth!.businessId);
      res.status(200).json(rows);
    } catch (error) { failFromError(res, error, "Accounting accounts could not be loaded", req); }
  }

  @Post("accounts")
  @UseGuards(CsrfGuard)
  async createAccount(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingAccountCreateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid accounting account", req);
    try {
      const created = await this.journals.createAccount({ ...parsed.data, businessId: req.auth!.businessId, actorId: req.auth!.userId, requestId: requestId(req) });
      res.status(201).json(created);
    } catch (error) { failFromError(res, error, "Accounting account could not be created", req); }
  }

  @Patch("accounts/:id")
  @UseGuards(CsrfGuard)
  async updateAccount(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingAccountUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid accounting account update", req);
    try {
      const updated = await this.journals.updateAccount({ ...parsed.data, businessId: req.auth!.businessId, accountId: id, actorId: req.auth!.userId, requestId: requestId(req) });
      res.status(200).json(updated);
    } catch (error) { failFromError(res, error, "Accounting account could not be updated", req); }
  }
}
