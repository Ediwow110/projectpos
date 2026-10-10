import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { inventoryCountApprovalSchema, inventoryCountCreateSchema, inventoryCountLineUpdateSchema, inventoryCountListSchema, inventoryCountVersionSchema, replenishmentDraftPoSchema, replenishmentListSchema } from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { failFromError, fail } from "../../common/http-helpers";
import { getCorrelationId } from "../../correlation";
import { AuthService } from "../../auth/nest/auth.service";
import { ManagerApprovalPolicyService } from "../../auth/nest/manager-approval-policy.service";
import { InventoryCountService } from "./inventory-count.service";

function rid(req: Request): string { const headers: Record<string, string | undefined> = {}; for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? ""); return getCorrelationId(headers); }
function idemKey(req: Request): string | null { const raw = req.headers["idempotency-key"]; const key = Array.isArray(raw) ? raw[0] : raw; return key?.trim() || null; }

@Controller("api/v1/inventory")
@UseGuards(SessionGuard)
export class InventoryCountController {
  constructor(
    @Inject(InventoryCountService) private readonly counts: InventoryCountService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ManagerApprovalPolicyService) private readonly approvalPolicy: ManagerApprovalPolicyService,
  ) {}
  private perms(req: Request): string[] { return req.rolePermissions ?? this.auth.rolePermissions(req.auth!.role); }
  private key(req: Request, res: Response): string | null { const key = idemKey(req); if (!key) { fail(res, 400, "VALIDATION", "Idempotency-Key header required", req); return null; } return key; }

  @Get("counts")
  async list(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = inventoryCountListSchema.safeParse(query); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count query", req); return; }
    try { res.json(await this.counts.listCounts(req.auth!.businessId, parsed.data)); } catch (e) { failFromError(res, e, "Count fetch failed", req); }
  }

  @Post("counts")
  @UseGuards(CsrfGuard)
  async create(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountCreateSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count payload", req); return; }
    try { const auth = req.auth!; const branchId = parsed.data.branchId === undefined ? (auth.activeBranchId ?? null) : parsed.data.branchId; res.status(201).json(await this.counts.createCount(auth.businessId, auth.userId, rid(req), { ...parsed.data, branchId }, this.perms(req))); } catch (e) { failFromError(res, e, "Count creation failed", req); }
  }

  @Get("counts/:id")
  async get(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> { try { res.json(await this.counts.getCount(req.auth!.businessId, id)); } catch (e) { failFromError(res, e, "Count fetch failed", req); } }

  @Post("counts/:id/start")
  @UseGuards(CsrfGuard)
  async start(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountVersionSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count version", req); return; }
    try { const auth = req.auth!; res.json(await this.counts.startCount(auth.businessId, auth.userId, rid(req), id, parsed.data.expectedVersion, this.perms(req))); } catch (e) { failFromError(res, e, "Count start failed", req); }
  }

  @Patch("counts/:id/lines")
  @UseGuards(CsrfGuard)
  async updateLines(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountLineUpdateSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count lines", req); return; }
    try { const auth = req.auth!; res.json(await this.counts.updateLines(auth.businessId, auth.userId, rid(req), id, parsed.data, this.perms(req))); } catch (e) { failFromError(res, e, "Count line update failed", req); }
  }

  @Post("counts/:id/submit")
  @UseGuards(CsrfGuard)
  async submit(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountVersionSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count version", req); return; }
    try { const auth = req.auth!; res.json(await this.counts.submitCount(auth.businessId, auth.userId, rid(req), id, parsed.data.expectedVersion, this.perms(req))); } catch (e) { failFromError(res, e, "Count submission failed", req); }
  }

  @Post("counts/:id/approve")
  @UseGuards(CsrfGuard)
  async approve(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountApprovalSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count approval", req); return; }
    try {
      const auth = req.auth!; const perms = this.perms(req); let applied;
      const fingerprint = await this.counts.getApprovalFingerprint(auth.businessId, id);
      if (!perms.includes("inventory.adjust")) {
        if (!parsed.data.approvalToken) throw new Error("FORBIDDEN");
        const requirement = await this.approvalPolicy.resolveRequirement(auth.businessId, auth.userId, { kind: "inventory_count", countId: id });
        if (!requirement || requirement.fingerprint !== fingerprint) throw new Error("APPROVAL_STALE");
        const consumed = await this.auth.consumeManagerApproval(auth.businessId, auth.userId, requirement.permission, requirement.fingerprint, parsed.data.approvalToken, requirement.requireDistinctApprover, auth.activeBranchId ?? null);
        applied = { approverId: consumed.approverId, permission: requirement.permission, stateFingerprint: requirement.fingerprint };
      }
      res.json(await this.counts.approveCount(auth.businessId, auth.userId, rid(req), id, parsed.data.expectedVersion, perms, applied));
    } catch (e) { failFromError(res, e, "Count approval failed", req); }
  }

  @Post("counts/:id/post")
  @UseGuards(CsrfGuard)
  async post(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountVersionSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count version", req); return; }
    const key = this.key(req, res); if (!key) return;
    try { const auth = req.auth!; const result = await this.counts.postCount(auth.businessId, auth.userId, rid(req), id, key, parsed.data.expectedVersion, this.perms(req)); res.status(result.replayed ? 200 : 201).json(result); } catch (e) { failFromError(res, e, "Count post failed", req); }
  }

  @Post("counts/:id/cancel")
  @UseGuards(CsrfGuard)
  async cancel(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const parsed = inventoryCountVersionSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid count version", req); return; }
    try { const auth = req.auth!; res.json(await this.counts.cancelCount(auth.businessId, auth.userId, rid(req), id, parsed.data.expectedVersion, this.perms(req))); } catch (e) { failFromError(res, e, "Count cancellation failed", req); }
  }

  @Get("replenishment")
  async replenishment(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string>): Promise<void> {
    const parsed = replenishmentListSchema.safeParse(query); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid replenishment query", req); return; }
    try { const auth = req.auth!; const rows = await this.counts.listReplenishment(auth.businessId, parsed.data.branchId ?? auth.activeBranchId ?? null, parsed.data.supplierId); res.json({ items: parsed.data.missingSupplier === "true" ? rows.filter((row) => row.supplierId === null) : rows }); } catch (e) { failFromError(res, e, "Replenishment fetch failed", req); }
  }

  @Post("replenishment/draft-po")
  @UseGuards(CsrfGuard)
  async draftPo(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const parsed = replenishmentDraftPoSchema.safeParse(body); if (!parsed.success) { fail(res, 400, "VALIDATION", "Invalid replenishment draft", req); return; }
    const key = this.key(req, res); if (!key) return;
    try { const auth = req.auth!; res.status(201).json(await this.counts.createDraftPoFromReplenishment(auth.businessId, auth.userId, rid(req), key, parsed.data, this.perms(req))); } catch (e) { failFromError(res, e, "Draft purchase order failed", req); }
  }
}
