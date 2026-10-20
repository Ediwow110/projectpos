import { z } from "zod";

export const stockExceptionReportSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1).nullable().optional(),
  kind: z.enum(["DAMAGE", "EXPIRY"]),
  quantity: z.number().int().min(1).max(1_000_000),
  expiresOn: z.string().nullable().optional(),
  reason: z.string().trim().min(3).max(300),
}).strict();
export type StockExceptionReportInput = z.infer<typeof stockExceptionReportSchema>;
