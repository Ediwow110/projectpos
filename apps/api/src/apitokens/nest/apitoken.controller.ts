import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { apiTokenCreateSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { ApiTokenService } from "./apitoken.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

const TOKEN_MANAGERS = new Set(["owner", "manager"]);

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ApiTokenController {
  constructor(@Inject(ApiTokenService) private readonly tokens: ApiTokenService) {}

  private manageGuard(req: Request, res: Response): boolean {
    if (!TOKEN_MANAGERS.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Token management requires owner or manager role", req);
      return false;
    }
    return true;
  }

  @Get("apitokens")
  async listTokens(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    try {
      res.status(200).json({ items: await this.tokens.listTokens(req.auth!.businessId) });
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Token fetch failed", req);
    }
  }

  @Post("apitokens")
  @UseGuards(CsrfGuard)
  async mintToken(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    const parsed = apiTokenCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid token payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.tokens.mintToken(auth.businessId, auth.userId, rid(req), {
          name: parsed.data.name,
          scopes: [...parsed.data.scopes],
          expiresAt: parsed.data.expiresAt,
        }, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Token mint failed", req);
    }
  }

  @Post("apitokens/:id/revoke")
  @UseGuards(CsrfGuard)
  async revokeToken(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.tokens.revokeToken(auth.businessId, auth.userId, rid(req), id, auth.role),
      );
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Token revoke failed", req);
    }
  }
}
