import { Controller, Get, Inject, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { SessionGuard } from "../../common/session.guard";
import { me } from "../../routes/me";
import { health } from "../../routes/health";
import { getCorrelationId } from "../../correlation";
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
    const profile = await this.tenant.me(auth.userId, auth.businessId);
    const requestId = rid(req);
    res.json({ ...me({ businessId: profile.businessId, userId: profile.userId }, requestId), ...profile });
  }

  @Get("health")
  async health(@Req() req: Request, @Res() res: Response): Promise<void> {
    const auth = req.auth!;
    res.json(health({ businessId: auth.businessId }, rid(req)));
  }
}
