import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  completeSchema,
  discountApprovalSchema,
  draftCreateSchema,
  paymongoCheckoutSchema,
  receiptEmailSchema,
  reconcileSchema,
  refundRequestSchema,
  salesQuerySchema,
  voidSaleSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { toCsv } from "../../common/csv";
import { createRateLimiter } from "../../common/rate-limit";
import { AuthService } from "../../auth/nest/auth.service";
import { ManagerApprovalPolicyService, type AppliedManagerApproval } from "../../auth/nest/manager-approval-policy.service";
import { SalesService } from "./sales.service";
import { resolvePaymentMethods } from "../payment-methods";
import type { DbPort } from "../../common/db.port";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { Scopes } from "../../apitokens/scopes.decorator";
import { isPayMongoMethod } from "../../payments/paymongo";
import { discountApprovalFingerprint } from "../discount-approval";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

function idemKey(req: Request): string | null {
  const raw = req.headers["idempotency-key"];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.trim() === "") return null;
  return key;
}

const SELL_ROLES = new Set(["owner", "manager", "cashier"]);

// Flood brake on money-moving commands: 1000/min/business stays far above
// legitimate cashier throughput and load cohorts while capping runaway loops.
// (An earlier 60/min value tripped the Phase 8 load harness — see the
// performance audit — so the ceiling was raised with headroom.)
const moneyLimiter = createRateLimiter(1000, 60_000);
const approvalLimiter = createRateLimiter(5, 60_000);

@Controller("api/v1")
@UseGuards(ApiTokenGuard, SessionGuard)
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  @Post("sales/discount-approval")
  @UseGuards(CsrfGuard)
  async discountApproval(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = discountApprovalSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid manager approval payload", req);
      return;
    }
    const granted = this.perms(req);
    if (!SELL_ROLES.has(req.auth!.role) || granted.includes("discount.override")) {
      fail(res, 403, "FORBIDDEN", "Manager approval is not available for this session", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await approvalLimiter.hit(`${auth.businessId}:discount-approval:${auth.userId}`)) {
        fail(res, 429, "RATE_LIMITED", "Too many approval attempts", req);
        return;
      }
      const out = await this.auth.mintManagerApproval(
        auth.businessId,
        auth.userId,
        rid(req),
        {
          email: parsed.data.email,
          ...(parsed.data.password ? { password: parsed.data.password } : {}),
          ...(parsed.data.pin ? { pin: parsed.data.pin } : {}),
          permission: "discount.override",
          fingerprint: discountApprovalFingerprint(parsed.data),
        },
      );
      res.status(201).json({
        token: out.token,
        expiresAt: out.expiresAt,
        approver: { name: out.approver.name, role: out.approver.role },
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "AUTH_INVALID_CREDENTIALS";
      fail(res, statusFor(code), code, "Manager approval failed", req);
    }
  }

  @Post("sales/drafts")
  @UseGuards(CsrfGuard)
  async createDraft(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = draftCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid draft payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      let granted = this.perms(req);
      let approval: { approverId: string; permission: "discount.override" } | undefined;
      if (parsed.data.approvalToken && !granted.includes("discount.override")) {
        const consumed = await this.auth.consumeManagerApproval(
          auth.businessId,
          auth.userId,
          "discount.override",
          discountApprovalFingerprint(parsed.data),
          parsed.data.approvalToken,
        );
        granted = [...granted, "discount.override"];
        approval = { approverId: consumed.approverId, permission: "discount.override" };
      }
      const sale = await this.sales.createDraft(
        auth.businessId,
        auth.userId,
        rid(req),
        {
          lines: parsed.data.lines,
          orderDiscountMinor: parsed.data.orderDiscountMinor,
          customerId: parsed.data.customerId,
          customerName: parsed.data.customerName,
          notes: parsed.data.notes,
          registerId: parsed.data.registerId,
          branchId: parsed.data.branchId,
        },
        granted,
        approval,
      );
      res.status(201).json(sale);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Draft creation failed", req);
    }
  }

  @Post("sales/:id/paymongo/checkout")
  @UseGuards(CsrfGuard)
  async paymongoCheckout(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!SELL_ROLES.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Payment initiation not permitted for this role", req);
      return;
    }
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = paymongoCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid PayMongo checkout payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await moneyLimiter.hit(`${auth.businessId}:paymongo-checkout`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      const webUrl = process.env["WEB_URL"] ?? "http://localhost:3000";
      const out = await this.sales.startPayMongoCheckout(
        auth.businessId,
        auth.userId,
        rid(req),
        id,
        parsed.data.method,
        key,
        webUrl,
      );
      res.status(out.replayed ? 200 : 201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "PayMongo checkout failed", req);
    }
  }

  @Post("sales/complete")
  @UseGuards(CsrfGuard)
  async complete(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!SELL_ROLES.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Sale completion not permitted for this role", req);
      return;
    }
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = completeSchema.safeParse({ ...(body as Record<string, unknown>), idempotencyKey: key });
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid complete payload", req);
      return;
    }
    const configuredMethods = new Set(
      (await resolvePaymentMethods(this.db, req.auth!.businessId)).map((method) => method.key),
    );
    if (parsed.data.payments.some((payment) => !configuredMethods.has(payment.method))) {
      fail(res, 400, "VALIDATION", "Payment method is not configured for this business", req);
      return;
    }
    if (parsed.data.payments.some((payment) => isPayMongoMethod(payment.method) && !(payment.providerRef ?? "").startsWith("unknown-"))) {
      fail(res, 409, "PAYMENT_PROVIDER_REQUIRED", "Card, GCash, Maya, and QR Ph payments must use the PayMongo checkout flow", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await moneyLimiter.hit(`${auth.businessId}:complete`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      const { sale, replayed } = await this.sales.completeSale(
        auth.businessId,
        auth.userId,
        rid(req),
        parsed.data.saleId,
        {
          payments: parsed.data.payments.map((p) => ({
            method: p.method,
            amountMinor: p.amountMinor,
            providerRef: p.providerRef,
          })),
          key,
          granted: this.perms(req),
          registerId: parsed.data.registerId,
          branchId: parsed.data.branchId,
        },
      );
      if (sale.status === "PAYMENT_UNKNOWN") {
        res.status(202).json({
          code: "PAYMENT_UNKNOWN",
          message: "Payment status unknown. Reconcile via POST /api/v1/payments/:id/reconcile. Do not retry with a new key.",
          correlationId: rid(req),
          sale,
        });
        return;
      }
      res.status(replayed ? 200 : 201).json({ ...sale, replayed });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sale completion failed", req);
    }
  }

  @Get("sales")
  @Scopes("sales:read")
  async listSales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = salesQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sales query", req);
      return;
    }
    try {
      const page = await this.sales.listSales(req.auth!.businessId, {
        cursor: parsed.data.cursor,
        limit: parsed.data.limit,
        status: parsed.data.status,
        customerId: parsed.data.customerId,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
      });
      res.json(page);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sales fetch failed", req);
    }
  }

  @Get("sales/export")
  async exportSales(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!this.perms(req).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    const parsed = salesQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sales query", req);
      return;
    }
    try {
      const { headers, rows } = await this.sales.buildSalesExport(req.auth!.businessId, {
        status: parsed.data.status,
        customerId: parsed.data.customerId,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
      });
      res.status(200).set("Content-Type", "text/csv; charset=utf-8").send(toCsv(headers, rows));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sales export failed", req);
    }
  }

  @Get("sales/held")
  async heldSales(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!SELL_ROLES.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Held sales are not available for this role", req);
      return;
    }
    try {
      res.json(await this.sales.listHeldSales(req.auth!.businessId, req.auth!.userId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Held sales fetch failed", req);
    }
  }

  @Get("sales/:id")
  async getSale(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      res.json(await this.sales.getSale(req.auth!.businessId, id, this.perms(req), req.auth!.role));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sale fetch failed", req);
    }
  }

  @Post("sales/:id/hold")
  @UseGuards(CsrfGuard)
  async hold(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.sales.holdSale(auth.businessId, auth.userId, rid(req), id));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Hold failed", req);
    }
  }

  @Post("sales/:id/resume")
  @UseGuards(CsrfGuard)
  async resume(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(await this.sales.resumeSale(auth.businessId, auth.userId, rid(req), id));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Resume failed", req);
    }
  }

  @Post("sales/:id/void")
  @UseGuards(CsrfGuard)
  async void(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = voidSaleSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Void reason required", req);
      return;
    }
    try {
      const auth = req.auth!;
      const requirement = await this.approvalPolicy.resolveRequirement(auth.businessId, auth.userId, {
        kind: "sale_void", saleId: id, reason: parsed.data.reason,
      });
      if (!requirement) throw new Error("FORBIDDEN");
      let granted = this.perms(req);
      let approval: AppliedManagerApproval | undefined;
      if (!granted.includes(requirement.permission)) {
        if (!parsed.data.approvalToken) throw new Error("FORBIDDEN");
        const consumed = await this.auth.consumeManagerApproval(
          auth.businessId, auth.userId, requirement.permission, requirement.fingerprint, parsed.data.approvalToken,
        );
        granted = [...granted, requirement.permission];
        approval = { approverId: consumed.approverId, permission: requirement.permission };
      }
      res.status(200).json(
        await this.sales.voidSale(auth.businessId, auth.userId, rid(req), id, parsed.data.reason, granted, approval),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Void failed", req);
    }
  }

  @Post("sales/:id/refund-request")
  @UseGuards(CsrfGuard)
  async refundRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = refundRequestSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid refund payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (!SELL_ROLES.has(auth.role)) {
        fail(res, 403, "FORBIDDEN", "Refund requests are not available for this role", req);
        return;
      }
      res.status(201).json(
        await this.sales.requestRefund(
          auth.businessId,
          auth.userId,
          rid(req),
          id,
          parsed.data.reason,
          key,
          ["sale.refund"],
        ),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Refund request failed", req);
    }
  }

  @Post("payments/:id/reconcile")
  @UseGuards(CsrfGuard)
  async reconcile(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.perms(req).includes("sale.refund")) {
      fail(res, 403, "FORBIDDEN", "Reconcile requires sale.refund", req);
      return;
    }
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = reconcileSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid reconcile payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await moneyLimiter.hit(`${auth.businessId}:reconcile`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      res.status(200).json(
        await this.sales.reconcilePayment(
          auth.businessId,
          auth.userId,
          rid(req),
          id,
          parsed.data.outcome,
          key,
        ),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Reconcile failed", req);
    }
  }

  @Get("payments/:id/provider-status")
  async providerStatus(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.sales.queryProvider(auth.businessId, id, query["provider"]),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Provider query failed", req);
    }
  }

  @Get("payments/methods")
  async paymentMethods(@Req() req: Request, @Res() res: Response): Promise<void> {
    // FR-PAY-01: methods are configuration — the business's list, not a
    // hard-coded enum.
    const methods = await resolvePaymentMethods(this.db, req.auth!.businessId);
    res.json({
      methods: methods.map((method) => ({
        ...method,
        available: isPayMongoMethod(method.key) ? this.sales.isPayMongoConfigured() : true,
        provider: isPayMongoMethod(method.key) ? "paymongo" : "manual",
      })),
    });
  }

  @Get("receipts/:saleId")
  async receipt(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      res.json(await this.sales.receiptData(req.auth!.businessId, saleId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt fetch failed", req);
    }
  }

  // FR-RECEIPT-01: downloadable receipt (plain text).
  @Get("receipts/:saleId/download")
  async receiptDownload(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      const { filename, text } = await this.sales.downloadReceipt(req.auth!.businessId, saleId);
      res.status(200)
        .set("Content-Type", "text/plain; charset=utf-8")
        .set("Content-Disposition", `attachment; filename="${filename}"`)
        .send(text);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt download failed", req);
    }
  }

  // FR-RECEIPT-01: mint a short-lived public share link for the receipt.
  @Post("receipts/:saleId/share")
  @UseGuards(CsrfGuard)
  async receiptShare(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      const out = await this.sales.createShareToken(auth.businessId, auth.userId, rid(req), saleId);
      res.status(201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt share failed", req);
    }
  }

  @Post("receipts/:saleId/email")
  @UseGuards(CsrfGuard)
  async receiptEmail(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = receiptEmailSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid receipt email recipient", req);
      return;
    }
    try {
      const auth = req.auth!;
      const out = await this.sales.sendReceiptEmail(
        auth.businessId,
        auth.userId,
        rid(req),
        saleId,
        parsed.data.to,
        key,
      );
      res.status(out.replayed ? 200 : 201).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt email delivery failed", req);
    }
  }

  @Get("receipts/:saleId/deliveries")
  async receiptDeliveries(
    @Req() req: Request,
    @Res() res: Response,
    @Param("saleId") saleId: string,
  ): Promise<void> {
    try {
      res.status(200).json(await this.sales.listReceiptDeliveries(req.auth!.businessId, saleId));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Receipt delivery history failed", req);
    }
  }
}
