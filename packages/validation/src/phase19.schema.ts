import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

const name = z.string().trim().min(1, "VALIDATION").max(160, "VALIDATION");
const slug = z.string().trim().min(1, "VALIDATION").max(64, "VALIDATION");

export const productFamilyCreateSchema = z.object({
  name,
  categoryId: z.string().min(1).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  options: z.array(z.object({ name: slug, values: z.array(slug).min(1).max(20) })).min(1).max(3),
});

export const productFamilyUpdateSchema = z.object({
  name: name.optional(),
  categoryId: z.string().min(1).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const productVariantCreateSchema = z.object({
  name: name.optional(),
  sku: slug,
  barcode: z.string().trim().max(64).nullable().optional(),
  priceMinor: moneyMinorSchema,
  costMinor: moneyMinorSchema.default(0),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  reorderLevel: z.number().int().min(0).default(0),
  trackInventory: z.boolean().default(true),
  optionValueIds: z.array(z.string().min(1)).min(1).max(3),
});

export const bundleCreateSchema = z.object({
  name,
  sku: slug,
  barcode: z.string().trim().max(64).nullable().optional(),
  priceMinor: moneyMinorSchema,
  costMinor: moneyMinorSchema.default(0),
  categoryId: z.string().min(1).nullable().optional(),
  components: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(50),
});

export const bundleUpdateSchema = z.object({
  components: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(50),
});

export const labelQuerySchema = z.object({
  productIds: z.string().trim().min(1),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
});
