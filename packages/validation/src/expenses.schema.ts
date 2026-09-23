import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const EXPENSE_METHODS = ["cash", "card", "gcash", "maya", "bank_transfer", "other"] as const;

export const expenseCreateSchema = z.object({
  category: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  description: z.string().trim().max(500, "VALIDATION").optional(),
  method: z.enum(EXPENSE_METHODS),
  expenseDate: z.string().max(64, "VALIDATION").optional(),
  attachmentUrl: z.string().trim().url("VALIDATION").max(500, "VALIDATION")
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), { message: "VALIDATION" })
    .optional(),
  shiftId: z.string().min(1, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
});

export const expenseListSchema = z.object({
  category: z.string().trim().max(80, "VALIDATION").optional(),
  method: z.enum(EXPENSE_METHODS).optional(),
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
  voided: z.enum(["all", "active", "voided"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const expenseVoidSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
