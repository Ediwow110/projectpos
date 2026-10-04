export const PO_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

const transitions: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function canTransitionPurchaseOrder(
  current: string,
  next: PurchaseOrderStatus,
): boolean {
  return (transitions[current as PurchaseOrderStatus] ?? []).includes(next);
}

export function assertPurchaseOrderTransition(current: string, next: PurchaseOrderStatus): void {
  if (!canTransitionPurchaseOrder(current, next)) throw new Error("PURCHASE_ORDER_INVALID_STATE");
}

export interface PurchaseOrderTotalLine {
  quantity: number;
  unitCostMinor: number;
}

export function computePurchaseOrderTotals(lines: PurchaseOrderTotalLine[]): {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
} {
  let subtotalMinor = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("VALIDATION");
    if (!Number.isSafeInteger(line.unitCostMinor) || line.unitCostMinor < 0) throw new Error("VALIDATION");
    const lineTotal = line.quantity * line.unitCostMinor;
    if (!Number.isSafeInteger(lineTotal)) throw new Error("VALIDATION");
    subtotalMinor += lineTotal;
    if (!Number.isSafeInteger(subtotalMinor)) throw new Error("VALIDATION");
  }
  return { subtotalMinor, taxMinor: 0, totalMinor: subtotalMinor };
}
