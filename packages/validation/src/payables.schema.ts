import { z } from "zod";

export const supplierBillCreateSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  supplierId: z.string().min(1), branchId: z.string().min(1).nullable(),
  invoiceNumber: z.string().trim().min(1).max(120),
  invoiceDate: z.string().datetime(), dueDate: z.string().datetime().nullable().optional(),
  invoiceAmountMinor: z.number().int().nonnegative(), nonStockChargeMinor: z.number().int().nonnegative().optional(),
  notes: z.string().max(1000).nullable().optional(),
  allocations: z.array(z.object({ receiptLineId: z.string().min(1), quantity: z.number().int().positive(), unitInvoiceCostMinor: z.number().int().nonnegative() }).strict()).min(1).max(500),
}).strict();

export const supplierBillPostSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const supplierCreditApplySchema = z.object({ billId: z.string().min(1) }).strict();

export const supplierPaymentCreateSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200), amountMinor: z.number().int().positive(),
  method: z.enum(["cash", "card", "bank_transfer", "gcash", "maya", "qrph", "other"]),
  paidAt: z.string().datetime(), reference: z.string().max(120).nullable().optional(), shiftId: z.string().min(1).nullable().optional(),
}).strict();
