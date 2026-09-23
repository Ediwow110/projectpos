import { z } from "zod";

export const BRANCH_TYPES = ["store", "warehouse"] as const;

export const branchCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  type: z.enum(BRANCH_TYPES).default("store"),
  isActive: z.boolean().optional(),
});

export const branchUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const transferLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
});

export const transferCreateSchema = z
  .object({
    fromBranchId: z.string().min(1, "VALIDATION"),
    toBranchId: z.string().min(1, "VALIDATION"),
    lines: transferLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, { message: "VALIDATION" });

export const transferListSchema = z.object({
  status: z.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
