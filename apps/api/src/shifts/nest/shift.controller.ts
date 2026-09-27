import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  cashInputSchema,
  closeShiftSchema,
  correctionSchema,
  openShiftSchema,
  registerCreateSchema,
  registerUpdateSchema,
  shiftsQuerySchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
import { AuthService } from "../../auth/nest/auth.service";
import { ShiftService } from "./shift.service";
import type { CashKind } from "../cash";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

const REGISTER_MANAGERS = new Set(["owner", "manager"]);

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ShiftController {
  constructor(
    @Inject(ShiftService) private readonly shifts: ShiftService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private perms(req: Request): string[] {
    return this.auth.rolePermissions(req.auth!.role);
  }

  private manageGuard(req: Request, res: Response): boolean {
    if (!REGISTER_MANAGERS.has(req.auth!.role)) {
      fail(res, 403, "FORBIDDEN", "Register management requires owner or manager role", req);
      return false;
    }
    return true;
  }

  @Get("registers")
  async listRegisters(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      res.status(200).json({ items: await this.shifts.listRegisters(req.auth!.businessId) });
    } catch (e) {
      failFromError(res, e, "Register fetch failed", req);
    }
  }

  @Post("registers")
  @UseGuards(CsrfGuard)
  async createRegister(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    const parsed = registerCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid register payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.shifts.createRegister(auth.businessId, auth.userId, rid(req), {
          name: parsed.data.name,
          branchId: parsed.data.branchId,
        }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Register creation failed", req);
    }
  }

  @Patch("registers/:id")
  @UseGuards(CsrfGuard)
  async updateRegister(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!this.manageGuard(req, res)) return;
    const parsed = registerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid register payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.shifts.updateRegister(auth.businessId, auth.userId, rid(req), id, {
          name: parsed.data.name,
          isActive: parsed.data.isActive,
          branchId: parsed.data.branchId,
        }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Register update failed", req);
    }
  }

  @Post("registers/:id/open")
  @UseGuards(CsrfGuard)
  async openShift(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = openShiftSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid open-shift payload", req);
      return;
    }
    if (parsed.data.registerId !== id) {
      fail(res, 400, "VALIDATION", "Register id mismatch", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.shifts.openShift(auth.businessId, auth.userId, rid(req), id, {
          openingFloatMinor: parsed.data.openingFloatMinor,
        }, auth.role),
      );
    } catch (e) {
      failFromError(res, e, "Shift open failed", req);
    }
  }

  @Get("shifts")
  async listShifts(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = shiftsQuerySchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid shifts query", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.shifts.listShifts(auth.businessId, {
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
          status: parsed.data.status,
          registerId: parsed.data.registerId,
        }, auth.role, auth.userId),
      );
    } catch (e) {
      failFromError(res, e, "Shift fetch failed", req);
    }
  }

  @Get("shifts/:id")
  async getShift(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      const auth = req.auth!;
      const { shift, components, movements } = await this.shifts.getShift(
        auth.businessId, id, auth.role, auth.userId,
      );
      res.status(200).json({ shift, components, movements });
    } catch (e) {
      failFromError(res, e, "Shift fetch failed", req);
    }
  }

  @Post("shifts/:id/cash")
  @UseGuards(CsrfGuard)
  async recordCash(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = cashInputSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid cash payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(200).json(
        await this.shifts.recordCash(auth.businessId, auth.userId, rid(req), id, {
          kind: parsed.data.kind as CashKind,
          amountMinor: parsed.data.amountMinor,
          reason: parsed.data.reason,
        }, this.perms(req)),
      );
    } catch (e) {
      failFromError(res, e, "Cash record failed", req);
    }
  }

  @Post("shifts/:id/close")
  @UseGuards(CsrfGuard)
  async closeShift(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = closeShiftSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid close payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const { shift, report } = await this.shifts.closeShift(
        auth.businessId, auth.userId, rid(req), id, {
          countedCashMinor: parsed.data.countedCashMinor,
          closeNotes: parsed.data.closeNotes,
        }, this.perms(req),
      );
      res.status(200).json({ shift, report });
    } catch (e) {
      failFromError(res, e, "Shift close failed", req);
    }
  }

  // Phase 11 (FR-CASH-04): audited corrections for closed shifts; the closed
  // shift record itself stays immutable.
  @Post("shifts/:id/corrections")
  @UseGuards(CsrfGuard)
  async addCorrection(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = correctionSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid correction payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const correction = await this.shifts.addCorrection(
        auth.businessId, auth.userId, rid(req), this.perms(req), id, parsed.data,
      );
      res.status(201).json({ correction });
    } catch (e) {
      failFromError(res, e, "Shift correction failed", req);
    }
  }
}
