import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { exchangeCreateSchema, refundApproveSchema, refundRejectSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { AuthService } from "../../auth/nest/auth.service";
import { ManagerApprovalPolicyService, type AppliedManagerApproval } from "../../auth/nest/manager-approval-policy.service";
import { ExchangeService } from "./exchange.service";
import { RefundService } from "./refund.service";
import type { DbPort } from "../../common/db.port";

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

@Controller("api/v1")
@UseGuards(SessionGuard)
export class RefundController {
  constructor(
    @Inject(RefundService) private readonly refunds: RefundService,
    @Inject(ExchangeService) private readonly exchanges: ExchangeService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.permissionsForRequest(req.auth!);
  }

  // Same abuse brake as sales money commands: 1000/min/business.
  private readonly approveLimiter = createRateLimiter(1000, 60_000);

  @Post("sales/:id/exchange")
  @UseGuards(CsrfGuard)
  async exchange(
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
    const parsed = exchangeCreateSchema.safeParse({ ...(body as Record<string, unknown>), saleId: id });
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid exchange payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await this.approveLimiter.hit(`${auth.businessId}:exchange`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      const result = await this.exchanges.completeExchange(
        auth.businessId,
        auth.userId,
        rid(req),
        id,
        {
          returns: parsed.data.returns,
          replacements: parsed.data.replacements,
          reason: parsed.data.reason,
          concernId: parsed.data.concernId,
          key,
        },
        this.perms(req),
        auth.role,
      );
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Exchange failed", req);
    }
  }

  @Post("sales/:id/refund-approve")
  @UseGuards(CsrfGuard)
  async approve(
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
    const parsed = refundApproveSchema.safeParse({ ...(body as Record<string, unknown>), saleId: id });
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid refund approval payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      if (await this.approveLimiter.hit(`${auth.businessId}:refund-approve`)) {
        fail(res, 429, "RATE_LIMITED", "Too many attempts", req);
        return;
      }
      // A completed idempotent command must replay its authoritative result,
      // not be reclassified against the sale's later terminal state.
      const existing = await this.db.findIdempotency(auth.businessId, key, "refund.approve");
      if (existing) {
        const replay = await this.refunds.approveRefund(
          auth.businessId, auth.userId, rid(req), id,
          { items: parsed.data.items, loadRefunds: parsed.data.loadRefunds, deliveryRefundMinor: parsed.data.deliveryRefundMinor, reason: parsed.data.reason, destination: parsed.data.destination, concernId: parsed.data.concernId, key },
          this.perms(req), auth.role,
        );
        res.status(200).json({ refund: replay.refund, sale: replay.sale, replayed: true });
        return;
      }
      const requirement = await this.approvalPolicy.resolveRequirement(auth.businessId, auth.userId, {
        kind: "refund", saleId: id, items: parsed.data.items, loadRefunds: parsed.data.loadRefunds,
        deliveryRefundMinor: parsed.data.deliveryRefundMinor, reason: parsed.data.reason,
      });
      if (!requirement) throw new Error("FORBIDDEN");
      let granted = this.perms(req);
      let approval: AppliedManagerApproval | undefined;
      if (!granted.includes(requirement.permission) || requirement.requireDistinctApprover) {
        if (!parsed.data.approvalToken) throw new Error("FORBIDDEN");
        const consumed = await this.auth.consumeManagerApproval(
          auth.businessId, auth.userId, requirement.permission, requirement.fingerprint, parsed.data.approvalToken,
          requirement.requireDistinctApprover,
        );
        granted = [...new Set([...granted, "sale.refund", requirement.permission])];
        approval = { approverId: consumed.approverId, permission: requirement.permission };
      }
      const { refund, sale, replayed } = await this.refunds.approveRefund(
        auth.businessId,
        auth.userId,
        rid(req),
        id,
        {
          items: parsed.data.items,
          loadRefunds: parsed.data.loadRefunds,
          deliveryRefundMinor: parsed.data.deliveryRefundMinor,
          reason: parsed.data.reason,
          destination: parsed.data.destination,
          concernId: parsed.data.concernId,
          key,
        },
        granted,
        auth.role,
        approval,
      );
      res.status(replayed ? 200 : 201).json(replayed ? { refund, sale, replayed } : { refund, sale });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Refund approval failed", req);
    }
  }

  @Post("sales/:id/refund-reject")
  @UseGuards(CsrfGuard)
  async reject(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = refundRejectSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid refund rejection payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.refunds.rejectRefund(
          auth.businessId, auth.userId, rid(req), id, parsed.data.reason, this.perms(req),
        ),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Refund rejection failed", req);
    }
  }
}
