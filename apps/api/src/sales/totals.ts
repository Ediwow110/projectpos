export interface TotalsLine {
  qty: number;
  priceMinor: number;
  costMinor: number;
  taxRateBps: number | null;
  lineDiscountMinor: number;
}

export interface TotalsResult {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

function lineGross(line: TotalsLine): number {
  return line.qty * line.priceMinor;
}

export function computeTaxMinor(netMinor: number, rateBps: number | null): number {
  const rate = rateBps;
  if (rate === null || rate === 0) return 0;
  return Math.round((Math.max(0, netMinor) * rate) / 10000);
}

function lineTax(line: TotalsLine, businessTaxRateBps: number | null): number {
  const rate = line.taxRateBps ?? businessTaxRateBps;
  const net = Math.max(0, lineGross(line) - line.lineDiscountMinor);
  return computeTaxMinor(net, rate);
}

export function computeSaleTotals(input: {
  lines: TotalsLine[];
  orderDiscountMinor: number;
  businessTaxRateBps: number | null;
}): TotalsResult {
  let subtotal = 0;
  let tax = 0;
  for (const line of input.lines) {
    subtotal += Math.max(0, lineGross(line) - line.lineDiscountMinor);
    tax += lineTax(line, input.businessTaxRateBps);
  }
  const discount = Math.min(Math.max(0, input.orderDiscountMinor), subtotal);
  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: tax,
    totalMinor: Math.max(0, subtotal - discount + tax),
  };
}

export function requiresDiscountOverride(input: {
  orderDiscountMinor: number;
  subtotalMinor: number;
  lines: Array<{ lineDiscountMinor: number; qty: number; priceMinor: number }>;
}): boolean {
  if (input.subtotalMinor > 0 && input.orderDiscountMinor * 10 > input.subtotalMinor) return true;
  return input.lines.some((l) => l.lineDiscountMinor * 5 > l.qty * l.priceMinor);
}
