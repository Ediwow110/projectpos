export const SENSITIVE_ACTIONS = [
  "price.edit",
  "cost.view",
  "discount.override",
  "sale.void",
  "sale.refund",
  // Phase 11 (FR-REFUND-02): refunds above the configured threshold are
  // approver-restricted; the role seed grants this to owners only.
  "refund.override",
  "inventory.adjust",
  "user.manage",
  "settings.write",
  "export.run",
  "shift.close.override",
  // Phase 16 procurement foundation. These permissions intentionally do not
  // grant any receiving or inventory mutation capability.
  "supplier.write",
  "purchase_order.write",
  "purchase_order.order",
  "purchase_order.cancel",
  "purchase_order.receive",
  "supplier_return.write",
  "supplier_return.post",
  "supplier_return.cancel",
] as const;

export function hasPermission(
  granted: string[],
  required: string,
  grantedBusinessId: string,
  requestBusinessId: string,
): boolean {
  if (grantedBusinessId !== requestBusinessId) return false;
  return granted.includes(required);
}
