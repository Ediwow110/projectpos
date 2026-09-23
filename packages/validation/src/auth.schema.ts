import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(12, "AUTH_WEAK_PASSWORD")
  .max(128, "AUTH_WEAK_PASSWORD");

export const registerSchema = z.object({
  ownerName: z.string().min(1).max(120),
  email: z.string().email(),
  password: passwordSchema,
  businessName: z.string().min(1).max(160),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().min(1, "VALIDATION").max(128, "VALIDATION").optional(),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  newPassword: passwordSchema,
});

export const activeBusinessSchema = z.object({
  businessId: z.string().min(1),
});

export const confirmPasswordSchema = z.object({
  password: z.string().min(1),
});

const ONBOARDING_STEPS = [
  "businessDetails",
  "taxCurrency",
  "receiptSetup",
  "products",
  "employees",
] as const;

export const onboardingPatchSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  state: z.enum(["done", "skipped"]),
});

export const businessSettingsSchema = z.object({
  currency: z.string().length(3).optional(),
  taxName: z.string().max(80).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  receiptHeader: z.string().max(200).optional(),
  receiptFooter: z.string().max(200).optional(),
});
