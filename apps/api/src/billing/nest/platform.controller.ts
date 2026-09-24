import { Body, Controller, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { flagOverrideSchema, invoiceIssueSchema, platformPlanSchema, supportGrantSchema } from "@pos/validation";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { BillingService } from "./billing.service";
import { SupportGrantService } from "./support-grant.service";
import { isPlatformKey } from "../platform-key";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

interface RequestSupportGrant {
  id: string;
  purpose: string;
}

// No SessionGuard here: platform callers authenticate with x-platform-key or
// with a time-bounded support grant, never a tenant session. Tenants must
// never change their own plan.
@Controller("api/v1/platform")
export class PlatformController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(SupportGrantService) private readonly grants: SupportGrantService,
  ) {}

  // FR-PLATFORM-01: the static platform key always works; a time-bounded
  // support grant substitutes for it while unexpired and unused, and the
  // first platform mutation consumes it.
  private async authenticate(req: Request, res: Response): Promise<boolean> {
    const provided = req.headers["x-platform-key"];
    const key = Array.isArray(provided) ? provided[0] : provided;
    if (isPlatformKey(key)) return true;
    const header = req.headers["x-support-grant"];
    const token = Array.isArray(header) ? header[0] : header;
    const grant = await this.grants.resolve(token ?? "");
    if (!grant) {
      fail(res, 403, "FORBIDDEN", "Platform key or support grant required", req);
      return false;
    }
    (req as Request & { supportGrant?: RequestSupportGrant }).supportGrant = {
      id: grant.id, purpose: grant.purpose,
    };
    return true;
  }

  private async consumeGrant(req: Request, res: Response, businessId: string | null): Promise<void> {
    const grant = (req as Request & { supportGrant?: RequestSupportGrant }).supportGrant;
    if (!grant) return;
    await this.grants.consume(grant.id);
    await this.billing.auditGrantUse(businessId, grant.id, grant.purpose, rid(req));
  }

  @Post("grants")
  async mintGrant(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    // Only the static platform key may mint grants; a grant cannot renew itself.
    const provided = req.headers["x-platform-key"];
    const key = Array.isArray(provided) ? provided[0] : provided;
    if (!isPlatformKey(key)) {
      fail(res, 403, "FORBIDDEN", "Platform key required", req);
      return;
    }
    const parsed = supportGrantSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid grant payload", req);
      return;
    }
    try {
      res.status(201).json(await this.grants.mint(parsed.data, rid(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Grant minting failed", req);
    }
  }

  @Patch("businesses/:id/plan")
  async changePlan(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!(await this.authenticate(req, res))) return;
    const parsed = platformPlanSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid plan payload", req);
      return;
    }
    try {
      const out = await this.billing.changePlan(id, "platform", rid(req), parsed.data.planKey);
      await this.consumeGrant(req, res, id);
      res.status(200).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Plan change failed", req);
    }
  }

  @Post("invoices/issue")
  async issueInvoice(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!(await this.authenticate(req, res))) return;
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
      const out = await this.billing.issueInvoice(raw.businessId, "platform", rid(req), {
        periodStart: new Date(dates.data.periodStart),
        periodEnd: new Date(dates.data.periodEnd),
      });
      await this.consumeGrant(req, res, raw.businessId);
      res.status(201).json(out);
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
    if (!(await this.authenticate(req, res))) return;
    const parsed = flagOverrideSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid flag payload", req);
      return;
    }
    try {
      const out = await this.billing.setFlag(id, "platform", rid(req), parsed.data.key, parsed.data.enabled);
      await this.consumeGrant(req, res, id);
      res.status(200).json(out);
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
    if (!(await this.authenticate(req, res))) return;
    const parsed = flagOverrideSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid flag payload", req);
      return;
    }
    try {
      const out = await this.billing.setFlag(null, "platform", rid(req), parsed.data.key, parsed.data.enabled);
      await this.consumeGrant(req, res, null);
      res.status(200).json(out);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Global flag update failed", req);
    }
  }
}
