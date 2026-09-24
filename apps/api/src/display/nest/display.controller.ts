import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { displayTokenSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { DisplayService } from "./display.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

// NOTE: the feed route carries no SessionGuard by design — customer displays
// authenticate with the short-lived display token, never a staff session.
@Controller("api/v1")
export class DisplayController {
  constructor(@Inject(DisplayService) private readonly display: DisplayService) {}

  @Post("display/tokens")
  @UseGuards(SessionGuard, CsrfGuard)
  async mintToken(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = displayTokenSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid display token payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.display.mintToken(auth.businessId, auth.userId, rid(req), parsed.data.registerId, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Display token failed", req);
    }
  }

  @Get("display/:registerId")
  async feed(
    @Req() req: Request,
    @Res() res: Response,
    @Param("registerId") registerId: string,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const token = query["token"];
    if (!token) {
      fail(res, 401, "TENANT_REQUIRED", "Display token required", req);
      return;
    }
    try {
      // The token identifies both the business and the register, so the feed
      // needs no tenant parameter from the caller.
      res.status(200).json(await this.display.feed(registerId, token));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code, 404), code, "Display feed failed", req);
    }
  }
}
