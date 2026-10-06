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
  phone: z.string().trim().min(7, "VALIDATION").max(40, "VALIDATION"),
  deliveryAddress: orderDeliveryAddressSchema.nullable().optional(),
  fulfillmentInstructions: z.string().trim().max(500, "VALIDATION").nullable().optional(),
});

export const ORDER_STATUSES = [
  "DRAFT", "CHECKOUT", "SUBMITTED", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED", "REJECTED",
] as const;
export const ORDER_PAYMENT_STATUSES = [
  "UNPAID", "PENDING", "UNKNOWN", "FAILED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED",
] as const;

export const orderListSchema = z.object({
  cursor: z.string().trim().min(1, "VALIDATION").max(2048, "VALIDATION").optional(),
  limit: z.coerce.number().int().min(1, "VALIDATION").max(100, "VALIDATION").default(50),
  status: z.enum(ORDER_STATUSES).optional(),
  channel: z.enum(["POS", "WEB"]).optional(),
  fulfillmentMode: z.enum(["NONE", "PICKUP", "DELIVERY"]).optional(),
  branchId: z.string().trim().min(1, "VALIDATION").optional(),
  paymentStatus: z.enum(ORDER_PAYMENT_STATUSES).optional(),
  dateFrom: z.string().trim().min(1, "VALIDATION").optional(),
  dateTo: z.string().trim().min(1, "VALIDATION").optional(),
});

export const publicStorefrontQuerySchema = z.object({
  key: storefrontKeySchema,
});

export const publicCatalogQuerySchema = z.object({
  key: storefrontKeySchema,
  branchId: z.string().trim().min(1, "VALIDATION"),
  q: z.string().trim().max(120, "VALIDATION").optional(),
  categoryId: z.string().trim().min(1, "VALIDATION").optional(),
  page: z.coerce.number().int().min(1, "VALIDATION").default(1),
  pageSize: z.coerce.number().int().min(1, "VALIDATION").max(100, "VALIDATION").default(20),
});

export const publicOrderCreateSchema = z.object({
  storefrontKey: storefrontKeySchema,
  captchaToken: z.string().trim().min(1).max(2048).optional(),
}).strict();

export const publicOrderLineSchema = z.object({
  productId: z.string().trim().min(1, "VALIDATION"),
  qty: z.number().int("AMOUNT_NOT_INTEGER").min(1, "VALIDATION").max(9999, "VALIDATION"),
}).strict();

export const publicOrderDraftSchema = z.object({
  branchId: z.string().trim().min(1, "VALIDATION"),
  fulfillmentMode: z.enum(["PICKUP", "DELIVERY"]),
  lines: publicOrderLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
}).strict();

export const publicOrderSubmitSchema = orderContactSchema.extend({
  branchId: z.string().trim().min(1, "VALIDATION"),
  fulfillmentMode: z.enum(["PICKUP", "DELIVERY"]),
  paymentMode: z.enum(["PREPAID", "PAY_AT_PICKUP"]),
  paymentMethod: z.enum(["card", "gcash", "maya", "qrph"]).optional(),
  captchaToken: z.string().trim().min(1).max(2048).optional(),
}).strict();

export const publicOrderStatusSchema = z.object({
  token: orderAccessTokenSchema,
}).strict();

export const publicOrderPaymentRetrySchema = z.object({
  paymentMethod: z.enum(["card", "gcash", "maya", "qrph"]),
}).strict();
