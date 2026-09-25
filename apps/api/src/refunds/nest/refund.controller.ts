import { Body, Controller, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { refundApproveSchema, refundRejectSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { createRateLimiter } from "../../common/rate-limit";
import { AuthService } from "../../auth/nest/auth.service";
import { RefundService } from "./refund.service";

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
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  // Same abuse brake as sales money commands: 1000/min/business.
  private readonly approveLimiter = createRateLimiter(1000, 60_000);

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
      const { refund, sale, replayed } = await this.refunds.approveRefund(
        auth.businessId,
        auth.userId,
        rid(req),
        id,
        {
          items: parsed.data.items,
          reason: parsed.data.reason,
          key,
        },
        this.perms(req),
        auth.role,
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
