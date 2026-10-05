import { z } from "zod";

export const storefrontKeySchema = z.string().regex(/^[a-f0-9]{32}$/i, "VALIDATION");
export const orderAccessTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i, "VALIDATION");

export const orderDeliveryAddressSchema = z.object({
  line1: z.string().trim().min(1, "VALIDATION").max(200, "VALIDATION"),
  line2: z.string().trim().max(200, "VALIDATION").optional(),
  city: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  region: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  postalCode: z.string().trim().min(1, "VALIDATION").max(24, "VALIDATION"),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "VALIDATION"),
});

export const orderContactSchema = z.object({
  contactName: z.string().trim().min(1, "VALIDATION").max(120, "VALIDATION"),
  email: z.string().trim().email("VALIDATION").max(254, "VALIDATION"),
  phone: z.string().trim().regex(/^\+?\d{7,15}$/, "VALIDATION"),
  deliveryAddress: orderDeliveryAddressSchema.nullable().optional(),
  fulfillmentInstructions: z.string().trim().max(500, "VALIDATION").nullable().optional(),
});
