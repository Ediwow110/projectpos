import { Body, Controller, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { flagOverrideSchema, invoiceIssueSchema, platformPlanSchema } from "@pos/validation";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { BillingService } from "./billing.service";
import { isPlatformKey } from "../platform-key";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

// No SessionGuard here: platform callers authenticate with x-platform-key,
// never a tenant session. Tenants must never change their own plan.
@Controller("api/v1/platform")
export class PlatformController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  private platformGuard(req: Request, res: Response): boolean {
    const provided = req.headers["x-platform-key"];
    const key = Array.isArray(provided) ? provided[0] : provided;
    if (!isPlatformKey(key)) {
      fail(res, 403, "FORBIDDEN", "Platform key required", req);
      return false;
    }
    return true;
  }

  @Patch("businesses/:id/plan")
  async changePlan(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.platformGuard(req, res)) return;
    const parsed = platformPlanSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid plan payload", req);
      return;
    }
    try {
      res.status(200).json(
        await this.billing.changePlan(id, "platform", rid(req), parsed.data.planKey),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Plan change failed", req);
    }
  }

  @Post("invoices/issue")
  async issueInvoice(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.platformGuard(req, res)) return;
    const raw = body as { businessId?: unknown; periodStart?: unknown; periodEnd?: unknown };
    if (typeof raw.businessId !== "string" || raw.businessId.length === 0) {
      fail(res, 400, "VALIDATION", "Invalid invoice payload", req);
      return;
    }
    const dates = invoiceIssueSchema.safeParse({ periodStart: raw.periodStart, periodEnd: raw.periodEnd });
    if (!dates.success) {
      fail(res, 400, "VALIDATION", "Invalid invoice payload", req);
      return;
    }
    try {
      res.status(201).json(
        await this.billing.issueInvoice(raw.businessId, "platform", rid(req), {
          periodStart: new Date(dates.data.periodStart),
          periodEnd: new Date(dates.data.periodEnd),
        }),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Invoice issue failed", req);
    }
  }

  @Patch("businesses/:id/flags")
  async setFlag(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.platformGuard(req, res)) return;
    const parsed = flagOverrideSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid flag payload", req);
      return;
    }
    try {
      res.status(200).json(
        await this.billing.setFlag(id, "platform", rid(req), parsed.data.key, parsed.data.enabled),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Flag update failed", req);
    }
  }

  // Global default for every business that has no override of its own.
  @Patch("flags")
  async setGlobalFlag(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.platformGuard(req, res)) return;
    const parsed = flagOverrideSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid flag payload", req);
      return;
    }
    try {
      res.status(200).json(
        await this.billing.setFlag(null, "platform", rid(req), parsed.data.key, parsed.data.enabled),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Global flag update failed", req);
    }
  }
}
