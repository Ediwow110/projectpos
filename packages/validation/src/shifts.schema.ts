import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const CASH_KINDS = ["paid_out", "cash_deposit", "cash_withdrawal", "adjustment"] as const;

export const registerCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  isActive: z.boolean().optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
});

export const registerUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    isActive: z.boolean().optional(),
    branchId: z.string().min(1, "VALIDATION").nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const openShiftSchema = z.object({
  registerId: z.string().min(1, "VALIDATION"),
  openingFloatMinor: moneyMinorSchema.default(0),
});

export const cashInputSchema = z.object({
  kind: z.enum(CASH_KINDS),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
});

export const closeShiftSchema = z.object({
  countedCashMinor: moneyMinorSchema,
  closeNotes: z.string().trim().max(500, "VALIDATION").optional(),
});

export const shiftsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(50),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
  registerId: z.string().min(1, "VALIDATION").optional(),
});
