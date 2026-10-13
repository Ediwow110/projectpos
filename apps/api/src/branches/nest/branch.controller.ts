import { Body, Controller, Get, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { branchCreateSchema, branchUpdateSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { BranchService } from "./branch.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

const BRANCH_MANAGERS = new Set(["owner", "manager"]);

@Controller("api/v1")
@UseGuards(SessionGuard)
export class BranchController {
  constructor(
    @Inject(BranchService) private readonly branches: BranchService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private manageGuard(req: Request, res: Response): boolean {
    if (!BRANCH_MANAGERS.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Branch management requires owner or manager role", req);
      return false;
    }
    return true;
  }

  @Get("branches")
  async listBranches(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const items = await this.branches.listBranches(req.auth!.businessId);
      const allowed = req.auth!.allowedBranchIds;
      res.status(200).json({ items: allowed ? items.filter((branch) => allowed.includes(branch.id)) : items });
    } catch (e) {
      failFromError(res, e, "Branch fetch failed", req);
    }
  }

  @Post("branches")
  @UseGuards(CsrfGuard)
  async createBranch(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    const parsed = branchCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid branch payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.branches.createBranch(auth.businessId, auth.userId, rid(req), {
          name: parsed.data.name,
          type: parsed.data.type,
        }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Branch creation failed", req);
    }
  }

  @Patch("branches/:id")
  @UseGuards(CsrfGuard)
  async updateBranch(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    const parsed = branchUpdateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid branch payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.branches.updateBranch(auth.businessId, auth.userId, rid(req), id, {
          name: parsed.data.name,
          isActive: parsed.data.isActive,
        }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Branch update failed", req);
    }
  }
}
