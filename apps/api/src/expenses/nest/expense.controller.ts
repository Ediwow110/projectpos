import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  expenseCreateSchema,
  expenseExportSchema,
  expenseListSchema,
  expenseVoidSchema,
} from "@pos/validation";
import { SessionGuard } from "../../common/session.guard";
import { CsrfGuard } from "../../common/csrf.guard";
import { getCorrelationId } from "../../correlation";
import { fail, failFromError } from "../../common/http-helpers";
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

const EXPORT_HEADERS = ["id", "category", "amountMinor", "method", "expenseDate", "actorId", "voided", "description"];

/**
 * Rows one expense export may contain. This is the stated ceiling, not an
 * accident: filters are honoured, and when the filtered matches still exceed
 * it the CSV says so instead of silently dropping rows - the same way the
 * ledger export states LEDGER_EXPORT_ROW_WINDOW truncation.
 */
export const EXPENSE_EXPORT_ROW_LIMIT = 1000;

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
    if (!this.auth.permissionsForRequest(req.auth!).includes("export.run")) {
      fail(res, 403, "FORBIDDEN", "Export requires export.run", req);
      return;
    }
    if (query["format"] !== "csv") {
      fail(res, 400, "VALIDATION", "Only format=csv is supported", req);
      return;
    }
    // Validate the filters before any row goes out: an unknown method or voided
    // value is a 400 with the controller's error envelope, not a header-only
    // CSV. Unparseable dates are rejected inside listExpenses the same way the
    // list endpoint rejects them, and the response has not started yet, so
    // they too become a 400 VALIDATION rather than an empty export.
    const parsed = expenseExportSchema.safeParse(query);
    if (!parsed.success) {
      fail(res, 400, "VALIDATION", "Invalid expense export query", req);
      return;
    }
    try {
      const { items, total } = await this.expenses.listExpenses(req.auth!.businessId, {
        category: parsed.data.category,
        method: parsed.data.method,
        dateFrom: parsed.data.dateFrom,
        dateTo: parsed.data.dateTo,
        voided: parsed.data.voided,
        page: 1,
        pageSize: EXPENSE_EXPORT_ROW_LIMIT,
      });
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
          e.description,
        ]),
      );
      const body = total > EXPENSE_EXPORT_ROW_LIMIT
        ? `${csv}\n# Export truncated at ${EXPENSE_EXPORT_ROW_LIMIT.toLocaleString("en-US")} rows. Narrow the filters and export again.\n`
        : csv;
      res.status(200).set("Content-Type", "text/csv; charset=utf-8").send(body);
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
