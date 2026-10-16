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

export const verificationResendSchema = z.object({
  email: z.string().email(),
  captchaToken: z.string().trim().min(1).max(2048).optional(),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32),
  newPassword: passwordSchema,
});

export const activeBusinessSchema = z.object({
  businessId: z.string().min(1),
});

export const activeBranchSchema = z.object({
  branchId: z.string().min(1).nullable(),
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
  standardReceiptConfirmed: z.boolean().optional(),
  businessAddress: z.string().trim().min(5).max(240).optional(),
  businessPhone: z.string().trim().max(40).optional(),
  businessTimezone: z.string().trim().min(3).max(80).refine(
    (value) => {
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
      catch { return false; }
    },
    "VALIDATION",
  ).optional(),
  taxName: z.string().max(80).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  receiptHeader: z.string().max(200).optional(),
  receiptFooter: z.string().max(200).optional(),
  onlineOrderingEnabled: z.boolean().optional(),
  onlinePickupBranchIds: z.array(z.string().min(1, "VALIDATION")).max(100, "VALIDATION").optional(),
  onlineFulfillmentBranchId: z.string().min(1, "VALIDATION").nullable().optional(),
  deliveryFlatFeeMinor: z.number().int().min(0, "VALIDATION").max(Number.MAX_SAFE_INTEGER, "VALIDATION").optional(),
  refundApprovalThresholdMinor: z.number().int().min(0, "VALIDATION").max(100_000_000, "VALIDATION").optional(),
  orderDiscountApprovalPercent: z.number().int().min(0, "VALIDATION").max(100, "VALIDATION").optional(),
  lineDiscountApprovalPercent: z.number().int().min(0, "VALIDATION").max(100, "VALIDATION").optional(),
});
