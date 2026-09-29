import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { activeBranchSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { me } from "../../routes/me";
import { health } from "../../routes/health";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { TenantService } from "./tenant.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class TenantController {
  constructor(@Inject(TenantService) private readonly tenant: TenantService) {}

  @Get("me")
  async me(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = req.auth!;
    const profile = await this.tenant.me(auth.userId, auth.businessId, auth.activeBranchId);
    const requestId = rid(req);
    res.json({ ...me({ businessId: profile.businessId, userId: profile.userId }, requestId), ...profile });
  }

  @Post("me/active-branch")
  @UseGuards(CsrfGuard)
  async setActiveBranch(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = activeBranchSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid branch scope", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.tenant.setActiveBranch(
          auth.userId,
          auth.businessId,
          auth.sessionId,
          parsed.data.branchId,
          rid(req),
        ),
      );
    } catch (error) {
      failFromError(res, error, "Cannot switch branch", req);
    }
  }

  @Get("health")
  async health(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = req.auth!;
    res.json(health({ businessId: auth.businessId }, rid(req)));
  }

  @Post("me/tour/seen")
  @UseGuards(CsrfGuard)
  async markWorkspaceTourSeen(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.status(200).json(await this.tenant.markWorkspaceTourSeen(req.auth!.userId));
  }
}
