import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { approvalPinSchema, membershipCreateSchema, roleAssignmentSchema, roleRevocationSchema } from "@pos/validation";
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
    const granted = this.auth.rolePermissionsForRoles(req.auth!.roles ?? [req.auth!.role]);
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

  @Post("memberships/:id/reactivate")
  @UseGuards(CsrfGuard)
  async reactivate(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    try {
      const auth = req.auth!;
      res.status(200).json(await this.memberships.reactivate(auth.businessId, auth.userId, rid(req), granted, id));
    } catch (e) {
      failFromError(res, e, "Membership reactivation failed", req);
    }
  }

  @Get("memberships/:id/role-assignments")
  async listRoleAssignments(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    try {
      res.status(200).json(await this.memberships.listRoleAssignments(req.auth!.businessId, id));
    } catch (e) {
      failFromError(res, e, "Role assignment fetch failed", req);
    }
  }

  @Post("memberships/:id/role-assignments")
  @UseGuards(CsrfGuard)
  async assignRole(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    const parsed = roleAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid role assignment payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const input = parsed.data;
      res.status(201).json(await this.memberships.assignRole(auth.businessId, auth.userId, rid(req), granted, id, {
        role: input.role,
        assignmentType: input.assignmentType,
        branchId: input.branchId ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        expiresAt: input.expiresAt === undefined || input.expiresAt === null ? input.expiresAt : new Date(input.expiresAt),
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      }));
    } catch (e) {
      failFromError(res, e, "Role assignment failed", req);
    }
  }

  @Post("role-assignments/:id/revoke")
  @UseGuards(CsrfGuard)
  async revokeRole(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    const parsed = roleRevocationSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid role revocation payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(await this.memberships.revokeRole(auth.businessId, auth.userId, rid(req), granted, id, parsed.data.reason));
    } catch (e) {
      failFromError(res, e, "Role revocation failed", req);
    }
  }

  @Post("memberships/:id/approval-pin")
  @UseGuards(CsrfGuard)
  async setApprovalPin(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    const parsed = approvalPinSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Approval PIN must be exactly six digits", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.memberships.setApprovalPin(auth.businessId, auth.userId, rid(req), granted, id, parsed.data.pin),
      );
    } catch (e) {
      failFromError(res, e, "Approval PIN update failed", req);
    }
  }
}
