import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION"),
  description: z.string().trim().max(500, "VALIDATION").optional(),
  isActive: z.boolean().optional(),
});

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(80, "VALIDATION").optional(),
    description: z.string().trim().max(500, "VALIDATION").nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

const skuField = z.string().trim().max(64, "VALIDATION").optional();
const barcodeField = z.string().trim().max(64, "VALIDATION").optional();

const httpUrlField = z
  .string()
  .trim()
  .url("VALIDATION")
  .max(500, "VALIDATION")
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), { message: "VALIDATION" });

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION"),
  categoryId: z.string().min(1, "VALIDATION").optional(),
  sku: skuField,
  barcode: barcodeField,
  brand: z.string().trim().max(80, "VALIDATION").optional(),
  unit: z.string().trim().min(1).max(16, "VALIDATION").default("pc"),
  costMinor: moneyMinorSchema.default(0),
  priceMinor: moneyMinorSchema,
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  reorderLevel: z.number().int().min(0).default(0),
  trackInventory: z.boolean().default(true),
  isActive: z.boolean().default(true),
  imageUrl: httpUrlField.optional(),
});

export const productUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION").optional(),
    categoryId: z.string().min(1, "VALIDATION").nullable().optional(),
    sku: skuField.nullable(),
    barcode: barcodeField.nullable(),
    brand: z.string().trim().max(80, "VALIDATION").nullable().optional(),
    unit: z.string().trim().min(1).max(16, "VALIDATION").optional(),
    costMinor: moneyMinorSchema.optional(),
    priceMinor: moneyMinorSchema.optional(),
    taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
    reorderLevel: z.number().int().min(0).optional(),
    trackInventory: z.boolean().optional(),
    isActive: z.boolean().optional(),
    imageUrl: httpUrlField.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const productSearchSchema = z.object({
  q: z.string().trim().max(120, "VALIDATION").optional(),
  categoryId: z.string().min(1, "VALIDATION").optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});

export const productImportSchema = z.object({
  items: productCreateSchema.array().min(1, "VALIDATION").max(200, "CATALOG_IMPORT_TOO_LARGE"),
});
