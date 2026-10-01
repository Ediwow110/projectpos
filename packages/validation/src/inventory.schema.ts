import { z } from "zod";
import { APPROVAL_MOVEMENT_TYPES, managerApprovalTokenSchema } from "./approvals.schema";

export const MOVEMENT_TYPES = APPROVAL_MOVEMENT_TYPES;

export const movementTypeSchema = z.enum(MOVEMENT_TYPES);

export const movementCreateSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  type: movementTypeSchema,
  qtyDelta: z.number().int("QTY_NOT_INTEGER").refine((n) => n !== 0, { message: "VALIDATION" }),
  reason: z.string().trim().max(500, "VALIDATION").optional(),
  referenceType: z.string().trim().max(64, "VALIDATION").optional(),
  referenceId: z.string().min(1, "VALIDATION").max(128, "VALIDATION").optional(),
  branchId: z.string().min(1, "VALIDATION").optional(),
  approvalToken: managerApprovalTokenSchema.optional(),
});

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const balancesQuerySchema = pageQuery.extend({
  view: z.enum(["all", "low", "out"]).default("all"),
  branchId: z.string().min(1, "VALIDATION").optional(),
});

export const movementHistoryQuerySchema = pageQuery.extend({
  branchId: z.string().min(1, "VALIDATION").optional(),
});
