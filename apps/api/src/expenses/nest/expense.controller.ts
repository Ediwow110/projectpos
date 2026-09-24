import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  expenseCreateSchema,
  expenseListSchema,
  expenseVoidSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError, statusFor } from "../../common/http-helpers";
import { toCsv } from "../../common/csv";
import { AuthService } from "../../auth/nest/auth.service";
import { ExpenseService } from "./expense.service";

function rid(req: Request): string {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v ?? "");
  }
  return getCorrelationId(headers);
}

const EXPORT_HEADERS = ["id", "category", "amountMinor", "method", "expenseDate", "actorId", "voided"];

@Controller("api/v1")
@UseGuards(SessionGuard)
export class ExpenseController {
  constructor(
    @Inject(ExpenseService) private readonly expenses: ExpenseService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get("expenses/export")
  async export(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    if (!this.auth.rolePermissions(req.auth!.role).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    try {
      const items = (await this.expenses.listExpenses(req.auth!.businessId, {
        category: undefined,
        method: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        voided: "all",
        page: 1,
        pageSize: 1000,
      })).items;
      const csv = toCsv(
        EXPORT_HEADERS,
        items.map((e) => [
          e.id,
          e.category,
          e.amountMinor,
          e.method,
          e.expenseDate.toISOString(),
          e.actorId,
          e.voidedAt === null ? "" : "voided",
        ]),
      );
      res.status(200).set("Content-Type", "text/csv; charset=utf-8").send(csv);
    } catch (e) {
      failFromError(res, e, "Expense export failed", req);
    }
  }

  @Get("expenses")
  async list(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ): Promise<void> {
    const parsed = expenseListSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid expense query", req);
      return;
    }
    try {
      res.status(200).json(
        await this.expenses.listExpenses(req.auth!.businessId, {
          category: parsed.data.category,
          method: parsed.data.method,
          dateFrom: parsed.data.dateFrom,
          dateTo: parsed.data.dateTo,
          voided: parsed.data.voided,
          page: parsed.data.page,
          pageSize: parsed.data.pageSize,
        }),
      );
    } catch (e) {
      failFromError(res, e, "Expense fetch failed", req);
    }
  }

  @Post("expenses")
  @UseGuards(CsrfGuard)
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = expenseCreateSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid expense payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      res.status(201).json(
        await this.expenses.createExpense(auth.businessId, auth.userId, rid(req), {
          category: parsed.data.category,
          amountMinor: parsed.data.amountMinor,
          description: parsed.data.description,
          method: parsed.data.method,
          expenseDate: parsed.data.expenseDate,
          attachmentUrl: parsed.data.attachmentUrl,
          shiftId: parsed.data.shiftId,
          branchId: parsed.data.branchId,
        }),
      );
    } catch (e) {
      failFromError(res, e, "Expense creation failed", req);
    }
  }

  @Get("expenses/:id")
  async detail(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ): Promise<void> {
    try {
      res.status(200).json(await this.expenses.getExpense(req.auth!.businessId, id));
    } catch (e) {
      failFromError(res, e, "Expense fetch failed", req);
    }
  }

  @Post("expenses/:id/void")
  @UseGuards(CsrfGuard)
  async void(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = expenseVoidSchema.safeParse(body);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid void payload", req);
      return;
    }
    try {
      const auth = req.auth!;
      const { expense, cashAdjusted } = await this.expenses.voidExpense(
        auth.businessId, auth.userId, rid(req), id, parsed.data.reason, auth.role,
      );
      res.status(200).json({ expense, cashAdjusted });
    } catch (e) {
      failFromError(res, e, "Expense void failed", req);
    }
  }
}
