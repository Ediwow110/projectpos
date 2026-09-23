import { Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbExpense, DbPort } from "../../common/db.port";

const VOID_ROLES = new Set(["owner", "manager"]);
const METHODS = new Set(["cash", "card", "gcash", "maya", "bank_transfer", "other"]);
const BACKDATE_WINDOW_MS = 90 * 24 * 3600 * 1000;

export interface ExpenseInput {
  category: string;
  amountMinor: number;
  description?: string;
  method: string;
  expenseDate?: string;
  attachmentUrl?: string;
  shiftId?: string;
}

function parseExpenseDate(raw: string | undefined, now: Date): Date {
  if (raw === undefined) return now;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("VALIDATION");
  if (d.getTime() > now.getTime()) throw new Error("VALIDATION");
  if (now.getTime() - d.getTime() > BACKDATE_WINDOW_MS) throw new Error("VALIDATION");
  return d;
}

@Injectable()
export class ExpenseService {
  constructor(private readonly db: DbPort) {}

  async createExpense(
    businessId: string,
    actorId: string,
    requestId: string,
    input: ExpenseInput,
    now: Date = new Date(),
  ): Promise<DbExpense> {
    withScope(businessId, {});
    const category = input.category.trim();
    if (!category || category.length > 80) throw new Error("VALIDATION");
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("VALIDATION");
    if (!METHODS.has(input.method)) throw new Error("VALIDATION");
    const expenseDate = parseExpenseDate(input.expenseDate, now);
    if (input.attachmentUrl !== undefined) {
      try {
        const u = new URL(input.attachmentUrl.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("VALIDATION");
        if (input.attachmentUrl.trim().length > 500) throw new Error("VALIDATION");
      } catch (e) {
        throw new Error("VALIDATION");
      }
    }
    let shiftId: string | null = null;
    if (input.method === "cash" && input.shiftId !== undefined) {
      const shift = await this.db.findShiftById(input.shiftId, businessId);
      if (!shift) throw new Error("NOT_FOUND");
      if (shift.status !== "OPEN") throw new Error("SHIFT_CLOSED_IMMUTABLE");
      shiftId = shift.id;
    }
    const expense = await this.db.createExpense({
      businessId,
      category,
      amountMinor: input.amountMinor,
      description: input.description?.trim() ? input.description.trim() : null,
      method: input.method,
      shiftId,
      expenseDate,
      actorId,
      requestId,
      attachmentUrl: input.attachmentUrl?.trim() ? input.attachmentUrl.trim() : null,
      voidedAt: null,
      voidReason: null,
      cashAdjusted: true,
    });
    if (shiftId) {
      const shift = (await this.db.findShiftById(shiftId, businessId))!;
      await this.db.createCashMovement({
        businessId,
        shiftId: shift.id,
        registerId: shift.registerId,
        type: "paid_out",
        amountMinor: -input.amountMinor,
        reason: category,
        referenceType: "Expense",
        referenceId: expense.id,
        actorId,
        requestId,
      });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "expense.create",
      entityType: "Expense",
      entityId: expense.id,
      requestId,
    });
    return expense;
  }

  async listExpenses(
    businessId: string,
    opts: {
      category?: string;
      method?: string;
      dateFrom?: string;
      dateTo?: string;
      voided: "all" | "active" | "voided";
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: DbExpense[]; total: number; page: number; pageSize: number }> {
    withScope(businessId, {});
    let rows = await this.db.listExpensesByBusiness(businessId);
    if (opts.category) rows = rows.filter((e) => e.category === opts.category);
    if (opts.method) rows = rows.filter((e) => e.method === opts.method);
    if (opts.dateFrom !== undefined) {
      const from = new Date(opts.dateFrom);
      if (Number.isNaN(from.getTime())) throw new Error("VALIDATION");
      rows = rows.filter((e) => e.expenseDate.getTime() >= from.getTime());
    }
    if (opts.dateTo !== undefined) {
      const to = new Date(opts.dateTo);
      if (Number.isNaN(to.getTime())) throw new Error("VALIDATION");
      rows = rows.filter((e) => e.expenseDate.getTime() <= to.getTime());
    }
    if (opts.voided === "active") rows = rows.filter((e) => e.voidedAt === null);
    else if (opts.voided === "voided") rows = rows.filter((e) => e.voidedAt !== null);
    rows = [...rows].sort((a, b) =>
      a.expenseDate.getTime() === b.expenseDate.getTime()
        ? (a.id < b.id ? 1 : -1)
        : b.expenseDate.getTime() - a.expenseDate.getTime(),
    );
    const total = rows.length;
    const start = (opts.page - 1) * opts.pageSize;
    return { items: rows.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
  }

  async getExpense(businessId: string, id: string): Promise<DbExpense> {
    withScope(businessId, {});
    const expense = await this.db.findExpenseById(id, businessId);
    if (!expense) throw new Error("NOT_FOUND");
    return expense;
  }

  async voidExpense(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    reason: string,
    role: string,
  ): Promise<{ expense: DbExpense; cashAdjusted: boolean }> {
    withScope(businessId, {});
    if (!VOID_ROLES.has(role)) throw new Error("FORBIDDEN");
    if (!reason || reason.trim().length < 3) throw new Error("VALIDATION");
    const expense = await this.db.findExpenseById(id, businessId);
    if (!expense) throw new Error("NOT_FOUND");
    if (expense.voidedAt !== null) throw new Error("VALIDATION");
    let cashAdjusted = true;
    if (expense.method === "cash" && expense.shiftId) {
      const linked = await this.db.findShiftById(expense.shiftId, businessId);
      const open = linked
        ? await this.db.findOpenShiftByRegister(businessId, linked.registerId)
        : null;
      if (open) {
        await this.db.createCashMovement({
          businessId,
          shiftId: open.id,
          registerId: open.registerId,
          type: "adjustment",
          amountMinor: expense.amountMinor,
          reason: `void:${reason.trim()}`,
          referenceType: "Expense",
          referenceId: expense.id,
          actorId,
          requestId,
        });
      } else {
        cashAdjusted = false;
      }
    }
    const updated = await this.db.updateExpense(id, businessId, {
      voidedAt: new Date(),
      voidReason: reason.trim(),
      cashAdjusted,
    });
    if (!updated) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "expense.void",
      entityType: "Expense",
      entityId: id,
      requestId,
    });
    return { expense: updated, cashAdjusted };
  }
}
