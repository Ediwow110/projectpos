import { z } from "zod";
import { moneyMinorSchema } from "./money.schema";

export const managerApprovalTokenSchema = z.string().trim().min(20, "VALIDATION").max(160, "VALIDATION");

export const managerApprovalPermissionSchema = z.enum([
  "discount.override",
  "sale.refund",
  "refund.override",
  "sale.void",
  "inventory.adjust",
  "shift.close.override",
]);

export type ManagerApprovalPermission = z.infer<typeof managerApprovalPermissionSchema>;

export const APPROVAL_MOVEMENT_TYPES = [
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

const discountLineSchema = z.object({
  productId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
  lineDiscountMinor: moneyMinorSchema.default(0),
}).strict();

const refundItemSchema = z.object({
  saleItemId: z.string().min(1, "VALIDATION"),
  qty: z.number().int("QTY_NOT_INTEGER").positive("QTY_NOT_POSITIVE"),
}).strict();

const optionalReasonSchema = z.string().trim().max(500, "VALIDATION").optional();

export const managerApprovalActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discount"),
    lines: discountLineSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
    orderDiscountMinor: moneyMinorSchema.default(0),
  }).strict(),
  z.object({
    kind: z.literal("refund"),
    saleId: z.string().min(1, "VALIDATION"),
    items: refundItemSchema.array().min(1, "VALIDATION").max(100, "VALIDATION"),
    reason: optionalReasonSchema,
  }).strict(),
  z.object({
    kind: z.literal("sale_void"),
    saleId: z.string().min(1, "VALIDATION"),
    reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
  }).strict(),
  z.object({
    kind: z.literal("inventory_movement"),
    productId: z.string().min(1, "VALIDATION"),
    movementType: z.enum(APPROVAL_MOVEMENT_TYPES),
    qtyDelta: z.number().int("QTY_NOT_INTEGER").refine((value) => value !== 0, { message: "VALIDATION" }),
    reason: optionalReasonSchema,
    branchId: z.string().min(1, "VALIDATION").optional(),
  }).strict(),
  z.object({
    kind: z.literal("shift_close"),
    shiftId: z.string().min(1, "VALIDATION"),
    countedCashMinor: moneyMinorSchema,
    closeNotes: optionalReasonSchema,
  }).strict(),
]);

export type ManagerApprovalAction = z.infer<typeof managerApprovalActionSchema>;

const credentialsSchema = z.object({
  email: z.string().trim().email("VALIDATION").max(254, "VALIDATION"),
  password: z.string().min(1, "VALIDATION").max(256, "VALIDATION").optional(),
  pin: z.string().regex(/^\d{6}$/, "VALIDATION").optional(),
}).strict();

const allowedPermissionByAction: Record<ManagerApprovalAction["kind"], readonly ManagerApprovalPermission[]> = {
  discount: ["discount.override"],
  refund: ["sale.refund", "refund.override"],
  sale_void: ["sale.void"],
  inventory_movement: ["inventory.adjust"],
  shift_close: ["shift.close.override"],
};

export const managerApprovalRequestSchema = credentialsSchema.extend({
  permission: managerApprovalPermissionSchema,
  action: managerApprovalActionSchema,
}).strict().superRefine((value, context) => {
  if ((value.password ? 1 : 0) + (value.pin ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["password"] });
  }
  if (!allowedPermissionByAction[value.action.kind].includes(value.permission)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["permission"] });
  }
});
