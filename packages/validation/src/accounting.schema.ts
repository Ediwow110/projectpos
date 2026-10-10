import { z } from "zod";

export const accountingAccountCreateSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Z_-]{2,16}$/, "VALIDATION"),
  name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  normalSide: z.enum(["debit", "credit"]),
}).strict();

export const accountingAccountUpdateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION").optional(),
  isActive: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, { message: "VALIDATION" });

export const accountingOpeningBalanceSchema = z.object({
  accountingStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ACCOUNTING_INVALID_DATE"),
  lines: z.array(z.object({
    accountCode: z.string().regex(/^[0-9A-Z_-]{2,16}$/, "ACCOUNTING_INVALID_ACCOUNT"),
    debitMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    creditMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict()).min(1).max(100),
}).strict();

export const accountingBackfillIssueResolutionSchema = z.object({
  evidence: z.string().trim().min(10, "VALIDATION").max(1000, "VALIDATION"),
  unitCostMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  lineCosts: z.array(z.object({ lineId: z.string().min(1).max(128), unitCostMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).max(500).optional(),
}).strict().refine((input) => input.unitCostMinor !== undefined || (input.lineCosts?.length ?? 0) > 0, { message: "VALIDATION" });
