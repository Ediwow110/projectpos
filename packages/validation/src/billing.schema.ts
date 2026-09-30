import { z } from "zod";

export const PLAN_KEYS = ["free", "basic", "pro", "enterprise"] as const;

export const TOKEN_SCOPES = ["sales:read", "catalog:read", "catalog:write", "reports:read", "inventory:read"] as const;

export const webhookEventSchema = z.object({
  eventId: z.string().min(1, "VALIDATION").max(128, "VALIDATION"),
  type: z.string().min(1, "VALIDATION").max(64, "VALIDATION"),
  amountMinor: z.number().int("MONEY_NOT_INTEGER").nonnegative("VALIDATION").optional(),
}).passthrough();

export const invoiceIssueSchema = z.object({
  periodStart: z.string().datetime({ message: "VALIDATION" }),
  periodEnd: z.string().datetime({ message: "VALIDATION" }),
});

export const platformPlanSchema = z.object({
  planKey: z.enum(PLAN_KEYS),
});

export const flagOverrideSchema = z.object({
  key: z.string().min(1, "VALIDATION").max(64, "VALIDATION"),
  enabled: z.boolean(),
});

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  scopes: z.enum(TOKEN_SCOPES).array().min(1, "VALIDATION").max(10, "VALIDATION"),
  expiresAt: z.string().datetime({ message: "VALIDATION" }).optional(),
});

export const printerEnrollSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  branchId: z.string().min(1, "VALIDATION").optional(),
  width: z.enum(["58", "80"]).default("80"),
  connection: z.enum(["test-double", "manual"]).default("test-double"),
});

export const printerUpdateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").nullable().optional(),
  width: z.enum(["58", "80"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "VALIDATION");

export const printJobSchema = z.object({
  printerId: z.string().min(1, "VALIDATION"),
  receiptNo: z.string().min(1, "VALIDATION").max(32, "VALIDATION").optional(),
  layout: z.enum(["58", "80"]).default("80"),
});

export const displayTokenSchema = z.object({
  registerId: z.string().min(1, "VALIDATION"),
});
