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
