import { Body, Controller, Get, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { accountingAccountCreateSchema, accountingAccountUpdateSchema } from "@pos/validation";
import { AuthService } from "../auth/nest/auth.service";
import { CsrfGuard } from "../common/csrf.guard";
import { fail, failFromError } from "../common/http-helpers";
import { SessionGuard } from "../common/session.guard";
import { getCorrelationId } from "../correlation";
import { JournalPostingService } from "./journal-posting.service";

function requestId(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) headers[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return getCorrelationId(headers);
}

@Controller("api/v1/accounting")
@UseGuards(SessionGuard)
export class AccountingController {
  constructor(
    @Inject(JournalPostingService) private readonly journals: JournalPostingService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private allowed(req: Request, permission: string): boolean {
    return this.auth.rolePermissions(req.auth!.role).includes(permission);
  }

  @Get("accounts")
  async accounts(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.allowed(req, "accounting.read")) return fail(res, 403, "FORBIDDEN", "Accounting read permission required", req);
    try {
      const rows = await this.journals.seedChart(req.auth!.businessId);
      res.status(200).json(rows);
    } catch (error) { failFromError(res, error, "Accounting accounts could not be loaded", req); }
  }

  @Post("accounts")
  @UseGuards(CsrfGuard)
  async createAccount(@Req() req: Request, @Res() res: Response, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingAccountCreateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid accounting account", req);
    try {
      const created = await this.journals.createAccount({ ...parsed.data, businessId: req.auth!.businessId, actorId: req.auth!.userId, requestId: requestId(req) });
      res.status(201).json(created);
    } catch (error) { failFromError(res, error, "Accounting account could not be created", req); }
  }

  @Patch("accounts/:id")
  @UseGuards(CsrfGuard)
  async updateAccount(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Body() body: unknown): Promise<void> {
    if (!this.allowed(req, "accounting.manage")) return fail(res, 403, "FORBIDDEN", "Accounting manage permission required", req);
    const parsed = accountingAccountUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(res, 400, "VALIDATION", "Invalid accounting account update", req);
    try {
      const updated = await this.journals.updateAccount({ ...parsed.data, businessId: req.auth!.businessId, accountId: id, actorId: req.auth!.userId, requestId: requestId(req) });
      res.status(200).json(updated);
    } catch (error) { failFromError(res, error, "Accounting account could not be updated", req); }
  }
}
