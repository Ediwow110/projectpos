export function applyMovementToBalance(onHand: number, movement: { qtyDelta: number }): number {
  return onHand + movement.qtyDelta;
}

export function computeBalanceFromLedger(movements: Array<{ qtyDelta: number }>): number {
  return movements.reduce((sum, m) => sum + m.qtyDelta, 0);
}

export type StockStatus = "ok" | "low" | "out" | "untracked";

export function deriveStockStatus(input: {
  qtyOnHand: number;
  reorderLevel: number;
  trackInventory: boolean;
}): StockStatus {
  if (!input.trackInventory) return "untracked";
  if (input.qtyOnHand <= 0) return "out";
  if (input.qtyOnHand <= input.reorderLevel) return "low";
  return "ok";
}
