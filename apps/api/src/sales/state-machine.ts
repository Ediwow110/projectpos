export const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_PAYMENT", "VOIDED"],
  PENDING_PAYMENT: ["PAID", "PAYMENT_FAILED", "PAYMENT_UNKNOWN", "VOIDED"],
  PAYMENT_FAILED: ["PENDING_PAYMENT", "VOIDED"],
  PAYMENT_UNKNOWN: ["RECONCILED", "VOIDED"],
  RECONCILED: ["PENDING_PAYMENT"],
  PAID: ["COMPLETED"],
  COMPLETED: ["REFUND_REQUESTED"],
  REFUND_REQUESTED: [],
  VOIDED: [],
};

export function transitionSale(from: string, to: string): string {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new Error("SALE_INVALID_TRANSITION");
  return to;
}
