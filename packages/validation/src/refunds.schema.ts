import { z } from "zod";
import { managerApprovalTokenSchema } from "./approvals.schema";

export const refundItemSchema = z.object({
  saleItemId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
});

export const giftCardLoadRefundSchema = z.object({
  loadId: z.string().min(1, "VALIDATION"),
  amountMinor: z.number().int("AMOUNT_NOT_INTEGER").positive("AMOUNT_NOT_POSITIVE"),
});

export const refundApproveSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  concernId: z.string().min(1, "VALIDATION").optional(),
  items: refundItemSchema.array().max(100, "VALIDATION").default([]),
  loadRefunds: giftCardLoadRefundSchema.array().max(100, "VALIDATION").default([]),
  deliveryRefundMinor: z.number().int("AMOUNT_NOT_INTEGER").min(0, "VALIDATION").optional(),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
  destination: z.enum(["ORIGINAL_TENDER", "STORE_CREDIT"]).default("ORIGINAL_TENDER"),
  approvalToken: managerApprovalTokenSchema.optional(),
}).superRefine((value, context) => {
  if (value.items.length === 0 && value.loadRefunds.length === 0 && (value.deliveryRefundMinor ?? 0) <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["items"] });
  }
});

export const refundRejectSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});

export const exchangeCreateSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  concernId: z.string().min(1, "VALIDATION").optional(),
  returns: refundItemSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  replacements: z.object({
    productId: z.string().min(1, "VALIDATION"),
    qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
  }).array().min(1, "VALIDATION").max(100, "VALIDATION"),
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});
