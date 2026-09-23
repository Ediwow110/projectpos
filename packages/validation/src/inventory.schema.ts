import { z } from "zod";

export const MOVEMENT_TYPES = [
  "opening_stock",
  "receive",
  "sale",
  "return",
  "damage",
  "adjustment",
  "transfer_in",
  "transfer_out",
  "stock_count",
] as const;

export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

export const movementCreateSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  type: movementTypeSchema,
  qtyDelta: z.number().int("QTY_NOT_INTEGER").refine((n) => n !== 0, { message: "VALIDATION" }),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
  referenceType: z.string().trim().max(64, "VALIDATION").optional(),
  referenceId: z.string().min(1, "VALIDATION").max(128, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const balancesQuerySchema = pageQuery.extend({
  view: z.enum(["all", "low", "out"]).default("all"),
});

export const movementHistoryQuerySchema = pageQuery;
