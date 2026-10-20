import { z } from "zod";

export const guestSupportCaseSchema = z.object({
  statusToken: z.string().min(32).max(200),
  category: z.enum(["ORDER", "PAYMENT", "FULFILLMENT", "OTHER"]),
  description: z.string().trim().min(10).max(1000),
}).strict();

export const guestSupportStatusSchema = z.object({
  statusToken: z.string().min(32).max(200),
}).strict();

export const platformOwnerConsentSchema = z.object({
  purpose: z.string().trim().min(10).max(200),
  ttlMinutes: z.number().int().min(1).max(60),
  password: z.string().min(1),
}).strict();
