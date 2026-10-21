import { z } from "zod";

export const storedValueAdjustSchema = z.object({
  amountMinor: z.number().int().refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(500),
  approvalToken: z.string().trim().min(20).max(160).optional(),
});

export const giftCardIssueSchema = z.object({ idempotencyKey: z.string().min(8).max(128) });
export const giftCardStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string().trim().min(3).max(500) });
// A gift-card code is a bearer secret, so it arrives in a POST body and never
// in a URL that proxies, access logs, browser history and APM would capture.
export const giftCardLookupSchema = z.object({ code: z.string().trim().min(8).max(200) });

export const loyaltyProgramSchema = z.object({
  enabled: z.boolean(),
  earnAmountMinor: z.number().int().positive(),
  earnPoints: z.number().int().positive(),
  redeemPoints: z.number().int().positive(),
  redeemValueMinor: z.number().int().positive(),
  minimumRedeemPoints: z.number().int().positive().nullable().optional(),
});
