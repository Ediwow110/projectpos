import { Body, Controller, Inject, Param, Patch, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { platformPlanSchema } from "@pos/validation";
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
}
