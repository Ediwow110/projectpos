export interface CartLine {
  qty: number;
  priceMinor: number;
  lineDiscountMinor: number;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, l.qty * l.priceMinor - l.lineDiscountMinor), 0);
}

export function canVoidSale(granted: string[]): boolean {
  return granted.includes("sale.void");
}

export function canRequestRefund(granted: string[]): boolean {
  return granted.includes("sale.refund");
}

export function buildCompletePayload(
  saleId: string,
  payments: Array<{ method: string; amountMinor: number; internalInstrumentId?: string }>,
  idempotencyKey: string,
): { saleId: string; payments: Array<{ method: string; amountMinor: number; internalInstrumentId?: string }>; idempotencyKey: string } {
  return { saleId, payments, idempotencyKey };
}
