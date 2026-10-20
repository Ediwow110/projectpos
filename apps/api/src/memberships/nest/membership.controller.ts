import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  approvalPinSchema, membershipBranchAssignmentSchema, membershipRegisterAssignmentSchema,
  membershipCreateSchema, membershipRoleChangeSchema, membershipRestrictionSchema,
} from "@pos/validation";
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
    const granted = this.auth.permissionsForRequest(req.auth!);
    if (!granted.includes("user.manage")) {
      fail(res, 403, "FORBIDDEN", "Membership management requires user.manage", req);
      return false;
    }
    return granted;
  }

  @Get("owner/audit")
  async ownerAudit(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (req.auth!.role !== "owner" || this.manageGuard(req, res) === false) {
      if (req.auth!.role !== "owner") fail(res, 403, "FORBIDDEN", "Owner access required", req);
      return;
    }
    const limit = query["limit"] === undefined ? 50 : Number(query["limit"]);
    const action = query["action"]?.trim() || undefined;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
        (action !== undefined && (action.length > 80 || !/^[a-zA-Z0-9._ -]+$/.test(action)))) {
      fail(res, 400, "VALIDATION", "Invalid audit filters", req);
      return;
    }
    try {
      res.json(await this.memberships.listOwnerAudit(req.auth!.businessId, limit, action));
    } catch (error) {
      failFromError(res, error, "Audit fetch failed", req);
    }
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

  @Get("memberships/role-permissions")
  async rolePermissions(@Req() req: Request, @Res() res: Response): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    res.json({
      items: (["owner", "manager", "cashier", "inventory"] as const).map((role) => ({
        role,
        permissions: this.auth.rolePermissions(role),
      })),
    });
  }

  @Get("memberships/:id/restrictions")
  async getRestrictions(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    if (this.manageGuard(req, res) === false) return;
    try {
      res.json(await this.memberships.getPermissionRestrictions(req.auth!.businessId, id));
    } catch (e) {
      failFromError(res, e, "Restrictions fetch failed", req);
    }
  }

  @Get("memberships/:id/branches")
  async getBranches(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (req.auth!.role !== "owner") {
      fail(res, 403, "FORBIDDEN", "Owner required", req);
      return;
    }
    try {
      res.json(await this.memberships.getBranchAssignment(req.auth!.businessId, id));
    } catch (error) {
      failFromError(res, error, "Branch assignment fetch failed", req);
    }
  }

  @Patch("memberships/:id/branches")
  @UseGuards(CsrfGuard)
  async setBranches(
    @Req() req: Request, @Res() res: Response,
    @Param("id") id: string, @Body() body: unknown,
  ): Promise<void> {
    if (req.auth!.role !== "owner") {
      fail(res, 403, "FORBIDDEN", "Owner required", req);
      return;
    }
    try {
      this.auth.checkReAuth(req.auth!.authenticatedAt);
    } catch {
      fail(res, 403, "AUTH_REAUTH_REQUIRED", "Re-authentication required", req);
      return;
    }
    const parsed = membershipBranchAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid branch assignment", req);
      return;
    }
    try {
      const actor = req.auth!;
      res.json(await this.memberships.setBranchAssignment(
        actor.businessId, actor.userId, rid(req),
        this.auth.permissionsForRequest(actor), id, parsed.data.branchIds,
      ));
    } catch (error) {
      failFromError(res, error, "Branch assignment update failed", req);
    }
  }

  @Get("memberships/:id/registers")
  async getRegisterAssignment(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    if (req.auth!.role !== "owner") {
      fail(res, 403, "FORBIDDEN", "Owner required", req);
      return;
    }
    try {
      res.json(await this.memberships.getRegisterAssignment(req.auth!.businessId, id));
    } catch (error) {
      failFromError(res, error, "Register assignment fetch failed", req);
    }
  }

  @Patch("memberships/:id/registers")
  @UseGuards(CsrfGuard)
  async setRegisterAssignment(
    @Req() req: Request, @Res() res: Response,
    @Param("id") id: string, @Body() body: unknown,
  ): Promise<void> {
    if (req.auth!.role !== "owner") {
      fail(res, 403, "FORBIDDEN", "Owner required", req);
      return;
    }
    try {
      this.auth.checkReAuth(req.auth!.authenticatedAt);
    } catch {
      fail(res, 403, "AUTH_REAUTH_REQUIRED", "Re-authentication required", req);
      return;
    }
    const parsed = membershipRegisterAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid register assignment", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.json(await this.memberships.setRegisterAssignment(
        auth.businessId, auth.userId, rid(req),
        this.auth.permissionsForRequest(auth), id, parsed.data.registerIds,
      ));
    } catch (error) {
      failFromError(res, error, "Register assignment update failed", req);
    }
  }

  @Patch("memberships/:id/restrictions")
  @UseGuards(CsrfGuard)
  async setRestrictions(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    try {
      this.auth.checkReAuth(req.auth!.authenticatedAt);
    } catch {
      fail(res, 403, "AUTH_REAUTH_REQUIRED", "Re-authentication required", req);
      return;
    }
    const parsed = membershipRestrictionSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid denied permission list", req);
      return;
    }
    try {
      const actor = req.auth!;
      res.json(await this.memberships.setPermissionRestrictions(
        actor.businessId, actor.userId, rid(req), granted, id, parsed.data.deniedPermissions,
      ));
    } catch (e) {
      failFromError(res, e, "Restrictions update failed", req);
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

  @Patch("memberships/:id/role")
  @UseGuards(CsrfGuard)
  async changeRole(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const granted = this.manageGuard(req, res);
    if (granted === false) return;
    // Changing a role can grant sensitive permissions; require a fresh owner
    // password confirmation, in addition to the existing CSRF/session guard.
    try {
      this.auth.checkReAuth(req.auth!.authenticatedAt);
    } catch {
      fail(res, 403, "AUTH_REAUTH_REQUIRED", "Re-authentication required", req);
      return;
    }
    const parsed = membershipRoleChangeSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid role", req);
      return;
    }
    try {
      const actor = req.auth!;
      res.json(await this.memberships.changeRole(
        actor.businessId, actor.userId, rid(req), granted, id, parsed.data.role,
      ));
    } catch (e) {
      failFromError(res, e, "Role update failed", req);
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
