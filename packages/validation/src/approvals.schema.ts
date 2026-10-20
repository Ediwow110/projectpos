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
  "stored_value.adjust",
  "loyalty.adjust",
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

const giftCardLoadRefundSchema = z.object({
  loadId: z.string().min(1, "VALIDATION"),
  amountMinor: moneyMinorSchema.refine((value) => value > 0, { message: "VALIDATION" }),
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
    items: refundItemSchema.array().max(100, "VALIDATION").default([]),
    loadRefunds: giftCardLoadRefundSchema.array().max(100, "VALIDATION").optional(),
    deliveryRefundMinor: moneyMinorSchema.optional(),
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
    kind: z.literal("inventory_count"),
    countId: z.string().min(1, "VALIDATION"),
  }).strict(),
  z.object({
    kind: z.literal("shift_close"),
    shiftId: z.string().min(1, "VALIDATION"),
    countedCashMinor: moneyMinorSchema,
    closeNotes: optionalReasonSchema,
  }).strict(),
  z.object({
    kind: z.literal("value_adjustment"),
    valueType: z.enum(["gift_card", "store_credit", "loyalty"]),
    targetId: z.string().min(1, "VALIDATION"),
    amountDelta: z.number().int().refine((value) => value !== 0, "VALIDATION"),
    reason: z.string().trim().min(3, "VALIDATION").max(500, "VALIDATION"),
  }).strict(),
]);

export const managerApprovalActionWithValidationSchema = managerApprovalActionSchema.superRefine((value, context) => {
  if (
    value.kind === "refund"
    && value.items.length === 0
    && (value.loadRefunds?.length ?? 0) === 0
    && (value.deliveryRefundMinor ?? 0) <= 0
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["items"] });
  }
});

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
  inventory_count: ["inventory.adjust"],
  shift_close: ["shift.close.override"],
  value_adjustment: ["stored_value.adjust", "loyalty.adjust"],
};

export const managerApprovalRequestSchema = credentialsSchema.extend({
  permission: managerApprovalPermissionSchema,
  action: managerApprovalActionWithValidationSchema,
}).strict().superRefine((value, context) => {
  if ((value.password ? 1 : 0) + (value.pin ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["password"] });
  }
  if (!allowedPermissionByAction[value.action.kind].includes(value.permission)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["permission"] });
  }
});

export const managerApprovalQueueRequestSchema = z.object({
  action: managerApprovalActionSchema,
  registerId: z.string().min(1, "VALIDATION").nullable().optional(),
  idempotencyKey: z.string().trim().min(8, "VALIDATION").max(128, "VALIDATION"),
}).strict().superRefine(({ action, registerId }, context) => {
  if (["discount", "shift_close", "refund", "sale_void"].includes(action.kind) && !registerId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["registerId"] });
  }
  if (["inventory_movement", "inventory_count", "value_adjustment"].includes(action.kind) && registerId != null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["registerId"] });
  }
});

export const managerApprovalQueueDecisionSchema = z.discriminatedUnion("decision", [
  credentialsSchema.extend({ decision: z.literal("APPROVED") }),
  z.object({ decision: z.literal("REJECTED"), reason: z.string().trim().min(3, "VALIDATION").max(300, "VALIDATION") }).strict(),
]).superRefine((value, context) => {
  if (value.decision === "APPROVED" && (value.password ? 1 : 0) + (value.pin ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "VALIDATION", path: ["password"] });
  }
});
