import { z } from "zod";

export const paymentMethodConfigSchema = z
  .object({
    key: z.string().trim().min(1, "VALIDATION").max(32, "VALIDATION").regex(/^[a-z0-9_]+$/, "VALIDATION"),
    label: z.string().trim().min(1, "VALIDATION").max(40, "VALIDATION"),
  })
  .array()
  .min(1, "VALIDATION")
  .max(20, "VALIDATION");

export const refundThresholdSchema = z.object({
  thresholdMinor: z.number().int("MONEY_NOT_INTEGER").min(0, "VALIDATION"),
});

export const emailVerificationSchema = z.object({
  requireEmailVerification: z.boolean(),
});

export const correctionSchema = z.object({
  amountMinor: z.number().int("MONEY_NOT_INTEGER").refine((v) => v !== 0, "VALIDATION"),
  reason: z.string().trim().min(3, "VALIDATION").max(200, "VALIDATION"),
});

export const supportGrantSchema = z.object({
  purpose: z.string().trim().min(3, "VALIDATION").max(200, "VALIDATION"),
  ttlMinutes: z.number().int("VALIDATION").min(1, "VALIDATION").max(60, "VALIDATION"),
  actorId: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
});

export const membershipCreateSchema = z.object({
  email: z.string().trim().email("VALIDATION").max(160, "VALIDATION"),
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  role: z.enum(["manager", "cashier", "inventory"]),
});

export const roleAssignmentSchema = z.object({
  role: z.enum(["manager", "cashier", "inventory"]),
  assignmentType: z.enum(["PERMANENT", "TEMPORARY"]),
  branchId: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").nullable().optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  reason: z.string().trim().max(240, "VALIDATION").nullable().optional(),
  idempotencyKey: z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION").nullable().optional(),
});

export const roleRevocationSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(240, "VALIDATION"),
});

export const approvalPinSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "VALIDATION"),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(10, "VALIDATION").max(128, "VALIDATION"),
});
