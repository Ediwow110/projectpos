import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";
import { managerApprovalTokenSchema } from "./approvals.schema";

export const PAYMENT_METHODS = [
  "cash",
  "card",
  "gcash",
  "maya",
  "qrph",
  "bank_transfer",
  "gift_card",
  "store_credit",
  "loyalty",
  "other",
] as const;

export const draftLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
  lineDiscountMinor: moneyMinorSchema.default(0),
});

export const draftCreateSchema = z.object({
  lines: draftLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  customerId: z.string().min(1, "VALIDATION").optional(),
  customerName: z.string().trim().max(120, "VALIDATION").optional(),
  notes: z.string().trim().max(500, "VALIDATION").optional(),
  orderDiscountMinor: moneyMinorSchema.default(0),
  registerId: z.string().min(1, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
  giftCardLoad: z.object({
    amountMinor: moneyMinorSchema,
    kind: z.enum(["NEW", "RELOAD"]).default("NEW"),
    giftCardId: z.string().min(1, "VALIDATION").optional(),
  }).optional(),
  approvalToken: managerApprovalTokenSchema.optional(),
});

export const discountApprovalSchema = z.object({
  email: z.string().trim().email("VALIDATION").max(254, "VALIDATION"),
  password: z.string().min(1, "VALIDATION").max(256, "VALIDATION").optional(),
  pin: z.string().regex(/^\d{6}$/, "VALIDATION").optional(),
  lines: draftLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  orderDiscountMinor: moneyMinorSchema.default(0),
}).superRefine((value, ctx) => {
  if ((value.password ? 1 : 0) + (value.pin ? 1 : 0) !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["password"] });
  }
});

export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  providerRef: z.string().trim().max(128, "VALIDATION").optional(),
  internalInstrumentId: z.string().trim().min(1, "VALIDATION").max(128, "VALIDATION").optional(),
});

export const completeSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  payments: paymentInputSchema.array().min(1, "VALIDATION").max(10, "VALIDATION"),
  idempotencyKey: z.string().min(8, "VALIDATION").max(128, "VALIDATION"),
  registerId: z.string().min(1, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
});

export const reconcileSchema = z.object({
  outcome: z.enum(["SUCCEEDED", "FAILED"]),
});

export const paymongoCheckoutSchema = z.object({
  method: z.enum(["card", "gcash", "maya", "qrph"]),
});

export const refundRequestSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});

export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
  approvalToken: managerApprovalTokenSchema.optional(),
}).strict();

export const receiptEmailSchema = z.object({
  to: z.string().trim().email("VALIDATION").max(254, "VALIDATION"),
}).strict();

export const salesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(50),
  status: z.string().trim().max(32, "VALIDATION").optional(),
  customerId: z.string().min(1, "VALIDATION").optional(),
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
});
