export interface ExchangePreviewLine {
  id: string;
  qty: number;
  lineTotalMinor: number;
}

export interface ExchangePreviewProduct {
  id: string;
  priceMinor: number;
  taxRateBps: number | null;
}

export type ExchangeDirection = "COLLECT" | "REFUND" | "EVEN";

export function exchangePreview(input: {
  lines: ExchangePreviewLine[];
  products: ExchangePreviewProduct[];
  returnQty: Record<string, number>;
  replacementQty: Record<string, number>;
  businessTaxRateBps: number | null;
}): {
  returnMinor: number;
  replacementMinor: number;
  netMinor: number;
  direction: ExchangeDirection;
} {
  const returnMinor = input.lines.reduce((sum, line) => {
    const qty = Math.max(0, Math.floor(input.returnQty[line.id] ?? 0));
    if (qty <= 0 || line.qty <= 0) return sum;
    return sum + Math.round((line.lineTotalMinor * qty) / line.qty);
  }, 0);

  const replacementMinor = input.products.reduce((sum, product) => {
    const qty = Math.max(0, Math.floor(input.replacementQty[product.id] ?? 0));
    if (qty <= 0) return sum;
    const gross = product.priceMinor * qty;
    const rate = product.taxRateBps ?? input.businessTaxRateBps;
    const tax = rate == null || rate === 0 ? 0 : Math.round((gross * rate) / 10000);
    return sum + gross + tax;
  }, 0);

  const netMinor = replacementMinor - returnMinor;
  return {
    returnMinor,
    replacementMinor,
    netMinor,
    direction: netMinor > 0 ? "COLLECT" : netMinor < 0 ? "REFUND" : "EVEN",
  };
}
