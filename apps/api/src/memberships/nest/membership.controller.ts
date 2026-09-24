import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { membershipCreateSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { MembershipService } from "./membership.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(SessionGuard)
export class MembershipController {
  constructor(
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private manageGuard(req: Request, res: Response): string[] | false {
    const granted = this.auth.rolePermissions(req.auth!.role);
    if (!granted.includes("user.manage")) {
      fail(res, 403, "FORBIDDEN", "Membership management requires user.manage", req);
      return false;
    }
    return granted;
  }

  @Get("memberships")
  async list(@Req() req: Request, @Res() res: Response): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    try {
      res.status(200).json(await this.memberships.list(req.auth!.businessId));
    } catch (e) {
      failFromError(res, e, "Membership fetch failed", req);
    }
  }

  @Post("memberships")
  @UseGuards(CsrfGuard)
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    const parsed = membershipCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid membership payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.memberships.create(auth.businessId, auth.userId, rid(req), granted, parsed.data),
      );
    } catch (e) {
      failFromError(res, e, "Membership creation failed", req);
    }
  }

  @Post("memberships/:id/deactivate")
  @UseGuards(CsrfGuard)
  async deactivate(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.memberships.deactivate(auth.businessId, auth.userId, rid(req), granted, id),
      );
    } catch (e) {
      failFromError(res, e, "Membership deactivation failed", req);
    }
  }
}
