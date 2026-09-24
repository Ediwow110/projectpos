import { Body, Controller, Get, Inject, Patch, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { businessSettingsSchema, onboardingPatchSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { BusinessService } from "./business.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class BusinessController {
  constructor(
    @Inject(BusinessService) private readonly business: BusinessService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("business")
  async getBusiness(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.json(await this.business.getBusiness(req.auth!.businessId));
  }

  @Patch("business/settings")
  @UseGuards(CsrfGuard)
  async patchSettings(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const auth = req.auth!;
    try {
      this.auth.checkReAuth(auth.authenticatedAt);
    } catch (e) {
      const code = e instanceof Error ? e.message : "AUTH_REAUTH_REQUIRED";
      fail(res, 403, code, "Re-authentication required", req);
      return;
    }
    const parsed = businessSettingsSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid settings payload", req);
      return;
    }
    try {
      const settings = await this.business.patchSettings(
        auth.businessId,
        auth.userId,
        parsed.data as Record<string, unknown>,
        rid(req),
      );
      res.json({ settings });
    } catch (e) {
      failFromError(res, e, "Settings update failed", req);
    }
  }

  @Get("onboarding")
  async getOnboarding(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.json(await this.business.getOnboarding(req.auth!.businessId));
  }

  @Patch("onboarding")
  @UseGuards(CsrfGuard)
  async patchOnboarding(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = onboardingPatchSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid onboarding payload", req);
      return;
    }
    const auth = req.auth!;
    try {
      const state = await this.business.patchOnboarding(
        auth.businessId,
        auth.userId,
        parsed.data,
        rid(req),
      );
      res.json(state);
    } catch (e) {
      failFromError(res, e, "Onboarding update failed", req);
    }
  }
}
