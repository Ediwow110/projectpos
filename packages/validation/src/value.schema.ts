import { z } from "zod";

export const storedValueAdjustSchema = z.object({
  amountMinor: z.number().int().refine((value) => value !== 0),
  counterAccountCode: z.string().regex(/^[0-9A-Z_-]{2,16}$/),
  reason: z.string().trim().min(3).max(500),
  approvalToken: z.string().trim().min(20).max(160).optional(),
});

export const giftCardIssueSchema = z.object({ idempotencyKey: z.string().min(8).max(128) });
export const giftCardStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().min(3).max(500) });

export const loyaltyProgramSchema = z.object({
  enabled: z.boolean(),
  earnAmountMinor: z.number().int().positive(),
  earnPoints: z.number().int().positive(),
  redeemPoints: z.number().int().positive(),
  redeemValueMinor: z.number().int().positive(),
  minimumRedeemPoints: z.number().int().positive().nullable().optional(),
});
