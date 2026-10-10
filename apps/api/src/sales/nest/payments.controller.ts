import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  paymongoCheckoutSchema,
  reconcileSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ManagerApprovalPolicyService } from "../../auth/nest/manager-approval-policy.service";
import { SalesService } from "./sales.service";
import { resolvePaymentMethods } from "../payment-methods";
import type { DbPort } from "../../common/db.port";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { isPayMongoMethod } from "../../payments/paymongo";
import { idemKey, moneyLimiter, rid, SELL_ROLES } from "./sales.controller.shared";

@Controller("api/v1")
@UseGuards(ApiTokenGuard, SessionGuard)
export class PaymentsController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
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
}
