import { parseMajorCurrencyToMinor } from "./pos-sale-model";

interface RefundSelectableSale {
  items: Array<{ id: string; qty: number; lineTotalMinor: number }>;
  giftCardLoads: Array<{ id: string }>;
}

/**
 * The same selection powers the refund form preview and the eventual request.
 * Server-side refund quantity/amount validation remains authoritative.
 */
export function selectSaleRefund(
  sale: RefundSelectableSale | null | undefined,
  qtyByLine: Record<string, string>,
  loadAmountById: Record<string, string>,
  threshold: unknown,
): {
  items: Array<{ saleItemId: string; qty: number }>;
  loadRefunds: Array<{ loadId: string; amountMinor: number }>;
  refundTotalMinor: number;
  refundLoadTotalMinor: number;
  selectedRefundTotalMinor: number;
  permission: "refund.override" | "sale.refund";
} {
  const items = sale?.items
    .filter((line) => Number(qtyByLine[line.id] ?? 0) > 0)
    .map((line) => ({ saleItemId: line.id, qty: Number(qtyByLine[line.id]) })) ?? [];
  const loadRefunds = sale?.giftCardLoads
    .filter((load) => (parseMajorCurrencyToMinor(loadAmountById[load.id] ?? "") ?? 0) > 0)
    .map((load) => ({ loadId: load.id, amountMinor: parseMajorCurrencyToMinor(loadAmountById[load.id] ?? "") ?? 0 })) ?? [];
  const refundTotalMinor = items.reduce((total, item) => {
    const line = sale?.items.find((candidate) => candidate.id === item.saleItemId);
    return total + (line ? Math.round((line.lineTotalMinor / line.qty) * item.qty) : 0);
  }, 0);
  const refundLoadTotalMinor = loadRefunds.reduce((total, load) => total + load.amountMinor, 0);
  const selectedRefundTotalMinor = refundTotalMinor + refundLoadTotalMinor;
  const permission = typeof threshold === "number" && selectedRefundTotalMinor > threshold
    ? "refund.override"
    : "sale.refund";
  return { items, loadRefunds, refundTotalMinor, refundLoadTotalMinor, selectedRefundTotalMinor, permission };
}
