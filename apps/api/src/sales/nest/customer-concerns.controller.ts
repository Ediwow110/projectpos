import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "../../auth/nest/auth.service";
import { CsrfGuard } from "../../common/csrf.guard";
import { SessionGuard } from "../../common/session.guard";
import { fail, statusFor } from "../../common/http-helpers";
import { ApiTokenGuard } from "../../apitokens/api-token.guard";
import { CustomerConcernService } from "./customer-concern.service";
import { idemKey, rid } from "./sales.controller.shared";
import type { DbCustomerConcern, DbPort } from "../../common/db.port";

@Controller("api/v1/customer-concerns")
@UseGuards(ApiTokenGuard, SessionGuard)
export class CustomerConcernsController {
  constructor(
    @Inject(CustomerConcernService) private readonly concerns: CustomerConcernService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject("DbPort") private readonly db: DbPort,
  ) {}

  private permissions(req: Request): string[] { return this.auth.permissionsForRequest(req.auth!); }
  private visible(req: Request, row: { requesterId: string; branchId: string | null; registerId: string | null }): boolean {
    const auth = req.auth!;
    const permissions = this.permissions(req);
    if (permissions.includes("customer_concern.review")) {
      if (auth.activeBranchId && row.branchId !== auth.activeBranchId) return false;
      if (auth.allowedBranchIds && (!auth.activeBranchId || row.branchId !== auth.activeBranchId || !auth.allowedBranchIds.includes(row.branchId))) return false;
      if (auth.allowedRegisterIds && (!row.registerId || !auth.allowedRegisterIds.includes(row.registerId))) return false;
      return true;
    }
    return permissions.includes("customer_concern.request") && row.requesterId === auth.userId &&
      (!auth.allowedBranchIds || (Boolean(auth.activeBranchId && row.branchId === auth.activeBranchId && auth.allowedBranchIds.includes(row.branchId)))) &&
      (!auth.allowedRegisterIds || Boolean(row.registerId && auth.allowedRegisterIds.includes(row.registerId)));
  }

  private async present(rows: DbCustomerConcern | DbCustomerConcern[], businessId: string): Promise<unknown> {
    const many = Array.isArray(rows) ? rows : [rows];
    const [registers, branches, people] = await Promise.all([
      this.db.listRegisters(businessId),
      Promise.all([...new Set(many.flatMap((row) => row.branchId ? [row.branchId] : []))].map((id) => this.db.findBranchById(id, businessId))),
      Promise.all([...new Set(many.map((row) => row.requesterId))].map(async (id) => {
        const membership = await this.db.findMembership(id, businessId);
        const user = membership ? await this.db.findUserById(id) : null;
        return { id, name: user?.name ?? "Former staff member" };
      })),
    ]);
    const branchNames = new Map(branches.filter((row): row is NonNullable<typeof row> => row !== null).map((row) => [row.id, row.name]));
    const requesterNames = new Map(people.map((row) => [row.id, row.name]));
    const enriched = many.map((row) => ({
      ...row,
      requesterName: requesterNames.get(row.requesterId) ?? "Former staff member",
      branchName: row.branchId ? branchNames.get(row.branchId) ?? null : null,
      registerName: registers.find((register) => register.id === row.registerId)?.name ?? null,
    }));
    return Array.isArray(rows) ? enriched : enriched[0];
  }

  @Get()
  async list(@Req() req: Request, @Res() res: Response): Promise<void> {
    const permissions = this.permissions(req);
    if (!permissions.includes("customer_concern.request") && !permissions.includes("customer_concern.review")) { fail(res, 403, "FORBIDDEN", "Customer concern access is not available", req); return; }
    const rows = await this.concerns.list(req.auth!.businessId);
    res.status(200).json(await this.present(rows.filter((row) => this.visible(req, row)), req.auth!.businessId));
  }

  @Get(":id")
  async detail(@Req() req: Request, @Res() res: Response, @Param("id") id: string): Promise<void> {
    try {
      const row = await this.concerns.find(req.auth!.businessId, id);
      if (!this.visible(req, row)) throw new Error("NOT_FOUND");
      res.status(200).json(await this.present(row, req.auth!.businessId));
    } catch (e) { const code = e instanceof Error ? e.message : "VALIDATION"; fail(res, statusFor(code), code, "Customer concern not found", req); }
  }

  @Post()
  @UseGuards(CsrfGuard)
  async submit(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const permissions = this.permissions(req);
    if (!permissions.includes("customer_concern.request") || !["owner", "manager", "cashier"].includes(req.auth!.role)) { fail(res, 403, "FORBIDDEN", "Customer concern requests are not available", req); return; }
    const key = idemKey(req);
    if (!key) { fail(res, 400, "VALIDATION", "Idempotency-Key header required", req); return; }
    try {
      const auth = req.auth!;
      const out = await this.concerns.submit(auth.businessId, auth.userId, rid(req), key, body as Parameters<CustomerConcernService["submit"]>[4], {
        activeBranchId: auth.activeBranchId,
        allowedBranchIds: auth.allowedBranchIds,
        allowedRegisterIds: auth.allowedRegisterIds,
      });
      res.status(out.replayed ? 200 : 201).json({ ...out, concern: await this.present(out.concern, req.auth!.businessId) });
    } catch (e) { const code = e instanceof Error ? e.message : "VALIDATION"; fail(res, statusFor(code), code, "Customer concern could not be submitted", req); }
  }

  @Post(":id/decision")
  @UseGuards(CsrfGuard)
  async decide(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    const auth = req.auth!;
    if (!this.permissions(req).includes("customer_concern.review") || !["owner", "manager"].includes(auth.role)) { fail(res, 403, "FORBIDDEN", "Customer concern review is not available", req); return; }
    const input = body as { decision?: unknown; reason?: unknown };
    if ((input?.decision !== "APPROVED" && input?.decision !== "REJECTED") || typeof input.reason !== "string") { fail(res, 400, "VALIDATION", "Invalid review decision", req); return; }
    try {
      const row = await this.concerns.find(auth.businessId, id);
      if (!this.visible(req, row)) throw new Error("NOT_FOUND");
      if (row.status === "OWNER_REVIEW" && auth.role === "owner") this.auth.checkReAuth(auth.authenticatedAt);
      const out = await this.concerns.decide(auth.businessId, auth.userId, rid(req), id, input.decision, input.reason, auth.role === "owner");
      res.status(200).json(await this.present(out, auth.businessId));
    } catch (e) { const code = e instanceof Error ? e.message : "VALIDATION"; fail(res, statusFor(code), code, "Customer concern decision failed", req); }
  }
}
