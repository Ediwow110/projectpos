export const SENSITIVE_ACTIONS = [
  "price.edit",
  "cost.view",
  "discount.override",
  "sale.void",
  "sale.refund",
  "inventory.adjust",
  "user.manage",
  "settings.write",
  "export.run",
  "shift.close.override",
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
