import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const PAYMENT_METHODS = [
  "cash",
  "card",
  "gcash",
  "maya",
  "bank_transfer",
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
});

export const paymentInputSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").positive("VALIDATION"),
  providerRef: z.string().trim().max(128, "VALIDATION").optional(),
});

export const completeSchema = z.object({
  saleId: z.string().min(1, "VALIDATION"),
  payments: paymentInputSchema.array().min(1, "VALIDATION").max(10, "VALIDATION"),
  idempotencyKey: z.string().min(8, "VALIDATION").max(128, "VALIDATION"),
  registerId: z.string().min(1, "VALIDATION").optional(),
});

export const reconcileSchema = z.object({
  outcome: z.enum(["SUCCEEDED", "FAILED"]),
});

export const refundRequestSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
});

export const salesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(50),
  status: z.string().trim().max(32, "VALIDATION").optional(),
});
