import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { giftCardIssueSchema, giftCardLookupSchema, giftCardStatusSchema, loyaltyProgramSchema, storedValueAdjustSchema } from "@pos/validation";
import { SessionGuard } from "../common/session.guard";
import { CsrfGuard } from "../common/csrf.guard";
import { AuthService } from "../auth/nest/auth.service";
import { ManagerApprovalPolicyService } from "../auth/nest/manager-approval-policy.service";
import type { DbPort } from "../common/db.port";
import { fail, statusFor } from "../common/http-helpers";
import { getCorrelationId } from "../correlation";
import { createRateLimiter } from "../common/rate-limit";
import { StoredValueService } from "./stored-value.service";


function requestId(req: Request): string {
  const raw = req.headers["x-request-id"];
  return Array.isArray(raw) ? raw[0] ?? "value" : raw ?? getCorrelationId({});
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ValueController {
  private readonly service: StoredValueService;
  private readonly lookupLimiter = createRateLimiter(60, 60_000);

  constructor(@Inject("DbPort") private readonly db: DbPort, @Inject(AuthService) private readonly auth: AuthService, @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService) {
    this.service = new StoredValueService(db);
  }

  private granted(req: Request): string[] { return this.auth.permissionsForRequest(req.auth!); }

  // A cashier can look up a card and customer balances for checkout, but
  // business-wide liabilities and append-only value ledgers are management data.
  private canReviewLedger(req: Request, permission: "gift_card.manage" | "stored_value.adjust"): boolean {
    return (req.auth?.role === "owner" || req.auth?.role === "manager") &&
      this.granted(req).includes(permission);
  }

  private async authorizeAdjustment(req: Request, valueType: "gift_card" | "store_credit" | "loyalty", targetId: string, amountDelta: number, reason: string, approvalToken?: string): Promise<{ approverId?: string }> {
    const auth = req.auth!;
    const granted = this.granted(req);
    const permission = valueType === "loyalty" ? "loyalty.adjust" : "stored_value.adjust";
    if (granted.includes(permission)) return {};
    const requirement = await this.approvalPolicy.resolveRequirement(auth.businessId, auth.userId, { kind: "value_adjustment", valueType, targetId, amountDelta, reason });
    if (!requirement || requirement.permission !== permission || !approvalToken) throw new Error("FORBIDDEN");
    const consumed = await this.auth.consumeManagerApproval(auth.businessId, auth.userId, requirement.permission, requirement.fingerprint, approvalToken, requirement.requireDistinctApprover);
    return { approverId: consumed.approverId };
  }

  @Get("gift-cards")
  async listGiftCards(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.canReviewLedger(req, "gift_card.manage")) { fail(res, 403, "FORBIDDEN", "Gift card register access denied", req); return; }
    try { const cards = await this.db.listGiftCards(req.auth!.businessId); res.json(await Promise.all(cards.map(async (card) => ({ id: card.id, maskedCode: this.service.maskGiftCard(card), codeLast4: card.codeLast4, status: card.status, balanceMinor: await this.service.giftCardBalance(card.businessId, card.id) })))); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Gift cards unavailable", req); }
  }

  @Get("reports/stored-value")
  async storedValueReport(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.canReviewLedger(req, "stored_value.adjust")) { fail(res, 403, "FORBIDDEN", "Stored-value report access denied", req); return; }
    try {
      const businessId = req.auth!.businessId;
      const cards = await this.db.listGiftCards(businessId);
      const giftCardBalances = await Promise.all(cards.map((card) => this.service.giftCardBalance(businessId, card.id)));
      const customers = await this.db.listCustomersByBusiness(businessId);
      let storeCreditMinor = 0;
      let loyaltyPoints = 0;
      for (const customer of customers) {
        storeCreditMinor += await this.service.storeCreditBalance(businessId, customer.id);
        loyaltyPoints += await this.service.loyaltyBalance(businessId, customer.id);
      }
      res.json({ giftCards: { count: cards.length, liabilityMinor: giftCardBalances.reduce((sum, value) => sum + value, 0) }, storeCredit: { liabilityMinor: storeCreditMinor }, loyalty: { outstandingPoints: loyaltyPoints } });
    } catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Stored-value report unavailable", req); }
  }

  @Post("gift-cards/lookup")
  @UseGuards(CsrfGuard)
  async lookupGiftCard(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    // The bearer code is the card: a URL query would leave it in proxy and
    // access logs, browser history, and APM capture, so it travels in the body.
    const parsed = giftCardLookupSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid gift-card lookup request", req); return; }
    if (await this.lookupLimiter.hit(`${req.auth!.businessId}:${req.ip}`)) { fail(res, 429, "RATE_LIMITED", "Too many lookup attempts", req); return; }
    try { res.json(await this.service.lookupGiftCard(req.auth!.businessId, parsed.data.code)); }
    catch (error) { const value = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(value), value, "Gift card lookup failed", req); }
  }

  @Get("gift-cards/:id/history")
  async giftCardHistory(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (!this.canReviewLedger(req, "gift_card.manage")) { fail(res, 403, "FORBIDDEN", "Gift-card history access denied", req); return; }
    try { const card = await this.db.findGiftCardById(id, req.auth!.businessId); if (!card) throw new Error("NOT_FOUND"); res.json({ id: card.id, maskedCode: this.service.maskGiftCard(card), status: card.status, transactions: await this.db.listGiftCardTransactions(id, req.auth!.businessId) }); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code), code, "Gift card history unavailable", req); }
  }

  @Post("gift-cards/issue")
  @UseGuards(CsrfGuard)
  async issueGiftCard(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = giftCardIssueSchema.safeParse(body);
    if (!parsed.success || !this.granted(req).includes("gift_card.manage")) { fail(res, 403, "FORBIDDEN", "Gift card issuance not permitted", req); return; }
    try { const result = await this.service.issueGiftCard(req.auth!.businessId, req.auth!.userId, requestId(req), parsed.data.idempotencyKey); res.status(201).json({ id: result.card.id, ...(result.code ? { code: result.code } : {}), maskedCode: this.service.maskGiftCard(result.card), status: result.card.status }); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Gift card issuance failed", req); }
  }

  @Post("gift-cards/:id/adjust")
  @UseGuards(CsrfGuard)
  async adjustGiftCard(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = storedValueAdjustSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid gift-card adjustment", req); return; }
    try { const key = String(req.headers["idempotency-key"] ?? ""); if (key.length < 8) throw new Error("VALIDATION"); const approval = await this.authorizeAdjustment(req, "gift_card", id, parsed.data.amountMinor, parsed.data.reason, parsed.data.approvalToken); const result = await this.service.adjustGiftCardWithMetadata(req.auth!.businessId, req.auth!.userId, requestId(req), id, parsed.data.amountMinor, parsed.data.reason, key, approval.approverId); res.json(result.result); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Gift card adjustment failed", req); }
  }

  @Post("gift-cards/:id/status")
  @UseGuards(CsrfGuard)
  async setGiftCardStatus(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = giftCardStatusSchema.safeParse(body);
    if (!parsed.success || !this.granted(req).includes("gift_card.manage")) { fail(res, 403, "FORBIDDEN", "Gift card status changes not permitted", req); return; }
    try { res.json(await this.service.setGiftCardStatus(req.auth!.businessId, req.auth!.userId, requestId(req), id, parsed.data.status, parsed.data.reason)); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Gift card status change failed", req); }
  }

  @Get("customers/:id/stored-value")
  async customerValue(@Req() req: Request, @Res() res: Response, @Param("id") customerId: string): Promise<void> {
    try { res.json({ customerId, storeCreditMinor: await this.service.storeCreditBalance(req.auth!.businessId, customerId), loyaltyPoints: await this.service.loyaltyBalance(req.auth!.businessId, customerId) }); }
    catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code), code, "Stored value unavailable", req); }
  }

  @Get("customers/:id/stored-value/history")
  async customerValueHistory(@Req() req: Request, @Res() res: Response, @Param("id") customerId: string): Promise<void> {
    if (!this.canReviewLedger(req, "stored_value.adjust")) { fail(res, 403, "FORBIDDEN", "Customer value history access denied", req); return; }
    try {
      const businessId = req.auth!.businessId;
      const credit = await this.db.findStoreCreditAccount(customerId, businessId);
      const loyalty = await this.db.findLoyaltyAccount(customerId, businessId);
      res.json({ customerId, storeCredit: credit ? await this.db.listStoreCreditTransactions(credit.id, businessId) : [], loyalty: loyalty ? await this.db.listLoyaltyTransactions(loyalty.id, businessId) : [] });
    } catch (error) { const code = error instanceof Error ? error.message : "NOT_FOUND"; fail(res, statusFor(code), code, "Stored-value history unavailable", req); }
  }

  @Post("customers/:id/store-credit/adjust")
  @UseGuards(CsrfGuard)
  async adjustStoreCredit(@Req() req: Request, @Res() res: Response, @Param("id") customerId: string, @Body() body: unknown): Promise<void> {
    const parsed = storedValueAdjustSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid store-credit adjustment", req); return; }
    try {
      const key = String(req.headers["idempotency-key"] ?? "");
      if (key.length < 8) throw new Error("VALIDATION");
      const approval = await this.authorizeAdjustment(req, "store_credit", customerId, parsed.data.amountMinor, parsed.data.reason, parsed.data.approvalToken);
      const adjustment = await this.service.adjustStoreCreditWithMetadata(req.auth!.businessId, req.auth!.userId, requestId(req), customerId, parsed.data.amountMinor, parsed.data.reason, key, approval.approverId);
      res.json({ customerId, balanceMinor: adjustment.result });
    }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Store-credit adjustment failed", req); }
  }

  @Post("customers/:id/loyalty/adjust")
  @UseGuards(CsrfGuard)
  async adjustLoyalty(@Req() req: Request, @Res() res: Response, @Param("id") customerId: string, @Body() body: unknown): Promise<void> {
    const parsed = storedValueAdjustSchema.safeParse(body);
    if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid loyalty adjustment", req); return; }
    try {
      const key = String(req.headers["idempotency-key"] ?? "");
      if (key.length < 8) throw new Error("VALIDATION");
      const approval = await this.authorizeAdjustment(req, "loyalty", customerId, parsed.data.amountMinor, parsed.data.reason, parsed.data.approvalToken);
      const adjustment = await this.service.adjustLoyaltyWithMetadata(req.auth!.businessId, req.auth!.userId, requestId(req), customerId, parsed.data.amountMinor, parsed.data.reason, key, approval.approverId);
      res.json({ customerId, points: adjustment.result });
    }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Loyalty adjustment failed", req); }
  }

  @Post("loyalty/program")
  @UseGuards(CsrfGuard)
  async saveLoyaltyProgram(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = loyaltyProgramSchema.safeParse(body);
    if (!parsed.success || !this.granted(req).includes("loyalty.manage")) { fail(res, 403, "FORBIDDEN", "Loyalty configuration not permitted", req); return; }
    try { res.json(await this.service.saveLoyaltyProgram(req.auth!.businessId, { ...parsed.data, minimumRedeemPoints: parsed.data.minimumRedeemPoints ?? null })); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Loyalty configuration failed", req); }
  }

  @Get("loyalty/program")
  async getLoyaltyProgram(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.granted(req).includes("loyalty.manage")) { fail(res, 403, "FORBIDDEN", "Loyalty configuration not permitted", req); return; }
    try { res.json(await this.service.getLoyaltyProgram(req.auth!.businessId)); }
    catch (error) { const code = error instanceof Error ? error.message : "VALIDATION"; fail(res, statusFor(code), code, "Loyalty configuration unavailable", req); }
  }
}
