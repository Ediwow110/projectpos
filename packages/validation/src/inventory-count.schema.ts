import { z } from "zod";
import { managerApprovalTokenSchema } from "./approvals.schema";
import { quantitySchema } from "./money.schema";

const text = (max: number) => z.string().trim().max(max, "VALIDATION");

export const inventoryCountScopeSchema = z.enum(["FULL", "PARTIAL"]);
export const inventoryCountStatusSchema = z.enum(["DRAFT", "COUNTING", "SUBMITTED", "APPROVED", "POSTED", "CANCELLED", "all"]);

export const inventoryCountCreateSchema = z.object({
  branchId: z.string().min(1, "VALIDATION").nullish(),
  scopeType: inventoryCountScopeSchema,
  name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  notes: text(500).optional(),
  productIds: z.array(z.string().min(1, "VALIDATION")).max(500, "VALIDATION").optional(),
}).strict().superRefine((value, ctx) => {
  const ids = value.productIds ?? [];
  if (value.scopeType === "PARTIAL" && ids.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["productIds"] });
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["productIds"] });
});

export const inventoryCountListSchema = z.object({
  status: inventoryCountStatusSchema.default("all"),
  branchId: z.string().min(1, "VALIDATION").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const inventoryCountVersionSchema = z.object({ expectedVersion: z.number().int().min(1, "VALIDATION") }).strict();

export const inventoryCountLineUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1, "VALIDATION"),
  lines: z.array(z.object({
    lineId: z.string().min(1, "VALIDATION"),
    countedQty: quantitySchema.nullable(),
    notes: text(500).optional(),
  }).strict()).min(1, "VALIDATION").max(500, "VALIDATION"),
}).strict();

export const inventoryCountApprovalSchema = inventoryCountVersionSchema.extend({ approvalToken: managerApprovalTokenSchema.optional() }).strict();

export const replenishmentListSchema = z.object({
  branchId: z.string().min(1, "VALIDATION").optional(),
  supplierId: z.string().min(1, "VALIDATION").optional(),
  missingSupplier: z.enum(["true", "false"]).optional(),
}).strict();

export const replenishmentDraftPoSchema = z.object({
  branchId: z.string().min(1, "VALIDATION").nullish(),
  supplierId: z.string().min(1, "VALIDATION"),
  lines: z.array(z.object({ productId: z.string().min(1, "VALIDATION"), quantity: quantitySchema }).strict()).min(1, "VALIDATION").max(100, "VALIDATION"),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.lines.map((line) => line.productId)).size !== value.lines.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["lines"] });
});

export type InventoryCountCreateInput = z.infer<typeof inventoryCountCreateSchema>;
export type InventoryCountLineUpdateInput = z.infer<typeof inventoryCountLineUpdateSchema>;
export type ReplenishmentDraftPoInput = z.infer<typeof replenishmentDraftPoSchema>;
