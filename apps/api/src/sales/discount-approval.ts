import { fingerprintPayload } from "./idempotency";

export function discountApprovalFingerprint(input: {
  lines: Array<{ productId: string; qty: number; lineDiscountMinor?: number }>;
  orderDiscountMinor?: number;
}): string {
  const lines = input.lines
    .map((line) => ({
      productId: line.productId,
      qty: line.qty,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
    }))
    .sort((a, b) =>
      a.productId.localeCompare(b.productId) ||
      a.qty - b.qty ||
      a.lineDiscountMinor - b.lineDiscountMinor,
    );
  return fingerprintPayload({
    lines,
    orderDiscountMinor: input.orderDiscountMinor ?? 0,
  });
}
