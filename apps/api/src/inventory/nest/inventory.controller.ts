import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  balancesQuerySchema,
  movementCreateSchema,
  movementHistoryQuerySchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, statusFor } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { InventoryService } from "./inventory.service";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { Scopes } from "../../apitokens/scopes.decorator";
import type { MovementType } from "../signs";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

@Controller("api/v1")
@UseGuards(ApiTokenGuard, SessionGuard)
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private canAdjust(req: Request): boolean {
    return this.auth.rolePermissions(req.auth!.role).includes("inventory.adjust");
  }

  private adjustGuard(req: Request, res: Response): boolean {
    if (!this.canAdjust(req)) {
      fail(res, 403, "FORBIDDEN", "Inventory write requires inventory.adjust", req);
      return false;
    }
    return true;
  }

  @Post("inventory/movements")
  @UseGuards(CsrfGuard)
  async recordMovement(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.adjustGuard(req, res)) return;
    const parsed = movementCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid movement payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const row = await this.inventory.recordMovement(auth.businessId, auth.userId, rid(req), {
        productId: parsed.data.productId,
        type: parsed.data.type as MovementType,
        qtyDelta: parsed.data.qtyDelta,
        reason: parsed.data.reason,
        referenceType: parsed.data.referenceType,
        referenceId: parsed.data.referenceId,
        branchId: parsed.data.branchId ?? auth.activeBranchId ?? undefined,
      });
      res.status(201).json(row);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Movement record failed", req);
    }
  }

  @Get("inventory/balances")
  @Scopes("inventory:read")
  async getBalances(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = balancesQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid balances query", req);
      return;
    }
    try {
      const page = await this.inventory.getBalances(req.auth!.businessId, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        view: parsed.data.view,
        branchId: parsed.data.branchId ?? req.auth!.activeBranchId ?? undefined,
      });
      res.json(page);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Balances fetch failed", req);
    }
  }

  @Get("inventory/products/:id/movements")
  async getHistory(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = movementHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid history query", req);
      return;
    }
    try {
      const page = await this.inventory.getMovementHistory(req.auth!.businessId, id, {
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        branchId: parsed.data.branchId ?? req.auth!.activeBranchId ?? undefined,
      });
      res.json(page);
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Movement history fetch failed", req);
    }
  }

  @Post("inventory/rebuild")
  @UseGuards(CsrfGuard)
  async rebuild(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.adjustGuard(req, res)) return;
    try {
      const auth = req.auth!;
      res.status(200).json(await this.inventory.rebuild(auth.businessId, auth.userId, rid(req)));
    } catch (e) {
      const code = e instanceof Error ? e.message : "VALIDATION";
      fail(res, statusFor(code), code, "Rebuild failed", req);
    }
  }
}
