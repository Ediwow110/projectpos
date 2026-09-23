import { z } from "zod";

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  phone: z.string().trim().max(32, "VALIDATION").optional(),
  email: z.string().trim().email("VALIDATION").max(160, "VALIDATION").optional(),
  address: z.string().trim().max(300, "VALIDATION").optional(),
  notes: z.string().trim().max(500, "VALIDATION").optional(),
});

export const customerUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION").optional(),
    phone: z.string().trim().max(32, "VALIDATION").nullable().optional(),
    email: z.string().trim().email("VALIDATION").max(160, "VALIDATION").nullable().optional(),
    address: z.string().trim().max(300, "VALIDATION").nullable().optional(),
    notes: z.string().trim().max(500, "VALIDATION").nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "VALIDATION" });

export const customerSearchSchema = z.object({
  q: z.string().trim().max(120, "VALIDATION").optional(),
  active: z.enum(["true", "false", "all"]).default("true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "VALIDATION").default(20),
});
