import { z } from "zod";

export const COMPARE_MODES = ["previous_period", "previous_year", "none"] as const;

export const reportsQuerySchema = z.object({
  dateFrom: z.string().max(64, "VALIDATION").optional(),
  dateTo: z.string().max(64, "VALIDATION").optional(),
  compare: z.enum(COMPARE_MODES).default("previous_period"),
  registerId: z.string().min(1, "VALIDATION").optional(),
});

export const salesReportQuerySchema = reportsQuerySchema.extend({
  granularity: z.enum(["day", "hour"]).default("day"),
});

export const productsReportQuerySchema = reportsQuerySchema.extend({
  tab: z.enum(["top", "slow", "dead"]).default("top"),
  limit: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
