/**
 * Stable request normalization for refund approval.
 *
 * Keep this pure: validation that requires a sale, its prior refunds, or
 * payment/ledger state belongs inside RefundService's locked transaction.
 */
export function normalizeRefundRequests(input: {
  items: ReadonlyArray<{ saleItemId: string; qty: number }>;
  loadRefunds?: ReadonlyArray<{ loadId: string; amountMinor: number }>;
}): {
  items: Array<{ saleItemId: string; qty: number }>;
  loadRefunds: Array<{ loadId: string; amountMinor: number }>;
} {
  const requestedByLine = new Map<string, number>();
  for (const item of input.items) {
    requestedByLine.set(item.saleItemId, (requestedByLine.get(item.saleItemId) ?? 0) + item.qty);
  }
  const items = [...requestedByLine.entries()]
    .map(([saleItemId, qty]) => ({ saleItemId, qty }))
    .sort((left, right) => left.saleItemId.localeCompare(right.saleItemId));

  const requestedLoads = new Map<string, number>();
  for (const load of input.loadRefunds ?? []) {
    if (!Number.isInteger(load.amountMinor) || load.amountMinor <= 0) throw new Error("VALIDATION");
    requestedLoads.set(load.loadId, (requestedLoads.get(load.loadId) ?? 0) + load.amountMinor);
  }
  const loadRefunds = [...requestedLoads.entries()]
    .map(([loadId, amountMinor]) => ({ loadId, amountMinor }))
    .sort((left, right) => left.loadId.localeCompare(right.loadId));

  return { items, loadRefunds };
}
