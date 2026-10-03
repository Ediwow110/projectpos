import { z } from "zod";
import { moneyMinorSchema, quantitySchema } from "./money.schema";

// Phase 16 procurement foundation. Bodies rely on zod's default key-stripping:
// a client-sent "totals" or "version" field is ignored, never trusted — the
// server recomputes subtotalMinor/totalMinor and owns version transitions.

export const SUPPLIER_NAME_MAX = 120;
export const SUPPLIER_CODE_MAX = 30;

const trimmed = (max: number) => z.string().trim().max(max, "VALIDATION");

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(SUPPLIER_NAME_MAX, "VALIDATION"),
  code: trimmed(SUPPLIER_CODE_MAX).optional(),
  contactName: trimmed(120).optional(),
  email: z.string().trim().email("VALIDATION").max(254, "VALIDATION").optional(),
  phone: trimmed(40).optional(),
  addressLine1: trimmed(200).optional(),
  addressLine2: trimmed(200).optional(),
  city: trimmed(80).optional(),
  province: trimmed(80).optional(),
  postalCode: trimmed(20).optional(),
  country: trimmed(2).length(2, "VALIDATION").optional(),
  paymentTerms: trimmed(80).optional(),
  notes: trimmed(500).optional(),
}).strict();

export const supplierUpdateSchema = supplierCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const supplierListSchema = z.object({
  q: z.string().trim().max(SUPPLIER_NAME_MAX, "VALIDATION").optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const productSupplierCreateSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  supplierSku: trimmed(60).optional(),
  unitCostMinor: moneyMinorSchema.optional(),
  leadTimeDays: z.number().int("VALIDATION").min(0, "VALIDATION").max(3650, "VALIDATION").optional(),
  isPreferred: z.boolean().optional(),
}).strict();

export const productSupplierUpdateSchema = z
  .object({
    supplierSku: trimmed(60).nullable().optional(),
    unitCostMinor: moneyMinorSchema.nullable().optional(),
    leadTimeDays: z.number().int("VALIDATION").min(0, "VALIDATION").max(3650, "VALIDATION").nullable().optional(),
    isPreferred: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

const poLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  quantity: quantitySchema,
  // Optional: when omitted the service defaults from the ProductSupplier
  // mapping, then Product.costMinor. Snapshots are always server-derived.
  unitCostMinor: moneyMinorSchema.optional(),
  notes: trimmed(200).optional(),
}).strict();

const poLinesSchema = z
  .array(poLineSchema)
  .min(0)
  .max(100, "VALIDATION")
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    lines.forEach((line, i) => {
      if (seen.has(line.productId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: [i, "productId"] });
      }
      seen.add(line.productId);
    });
  });

// ISO date (YYYY-MM-DD) shape only; the service bounds the calendar window.
const expectedDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "VALIDATION");

export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().min(1, "VALIDATION"),
  branchId: z.string().min(1, "VALIDATION").nullish(),
  expectedDate: expectedDateSchema.optional(),
  notes: trimmed(500).optional(),
  lines: poLinesSchema,
}).strict();

export const purchaseOrderUpdateSchema = z
  .object({
    expectedVersion: z.number().int("VALIDATION").min(1, "VALIDATION"),
    supplierId: z.string().min(1, "VALIDATION").optional(),
    branchId: z.string().min(1, "VALIDATION").nullish(),
    expectedDate: expectedDateSchema.nullable().optional(),
    notes: trimmed(500).nullable().optional(),
    lines: poLinesSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.supplierId === undefined &&
      v.branchId === undefined &&
      v.expectedDate === undefined &&
      v.notes === undefined &&
      v.lines === undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION" });
    }
  });

export const purchaseOrderListSchema = z.object({
  q: z.string().trim().max(80, "VALIDATION").optional(),
  supplierId: z.string().min(1, "VALIDATION").optional(),
  status: z.enum(["DRAFT", "ORDERED", "CANCELLED", "all"]).default("all"),
  branchId: z.string().min(1, "VALIDATION").optional(),
  dateFrom: expectedDateSchema.optional(),
  dateTo: expectedDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const purchaseOrderCancelSchema = z.object({
  reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
  expectedVersion: z.number().int("VALIDATION").min(1, "VALIDATION"),
}).strict();

// order carries no body fields beyond concurrency; expectedVersion arrives in
// the JSON body so fetch callers without a body still get schema enforcement.
export const purchaseOrderOrderSchema = z.object({
  expectedVersion: z.number().int("VALIDATION").min(1, "VALIDATION"),
}).strict();

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type ProductSupplierCreateInput = z.infer<typeof productSupplierCreateSchema>;
export type ProductSupplierUpdateInput = z.infer<typeof productSupplierUpdateSchema>;
export type PurchaseOrderCreateInput = z.infer<typeof purchaseOrderCreateSchema>;
export type PurchaseOrderUpdateInput = z.infer<typeof purchaseOrderUpdateSchema>;
export type PurchaseOrderCancelInput = z.infer<typeof purchaseOrderCancelSchema>;
