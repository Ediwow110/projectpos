import { Body, Controller, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { syncCheckSchema, syncResolveSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { SyncService } from "./sync.service";

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
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post("sync/check")
  @UseGuards(CsrfGuard)
  async check(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = syncCheckSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sync check payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.sync.checkKeys(auth.businessId, parsed.data.keys),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sync check failed", req);
    }
  }

  @Post("sync/resolve")
  @UseGuards(CsrfGuard)
  async resolve(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const key = idemKey(req);
    if (!key) {
      fail(res, 400, "VALIDATION", "Idempotency-Key header required", req);
      return;
    }
    const parsed = syncResolveSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid sync resolve payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.sync.resolveConflict(auth.businessId, auth.userId, rid(req), {
          key: parsed.data.key,
          commandType: parsed.data.commandType,
          reason: parsed.data.reason,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Sync resolve failed", req);
    }
  }

}
