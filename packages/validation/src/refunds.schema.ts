import { z } from "zod";

export const refundItemSchema = z.object({
  saleItemId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
});

export const refundApproveSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  items: refundItemSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
});

export const refundRejectSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
