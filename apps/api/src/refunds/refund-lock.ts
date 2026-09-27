export function refundLockKey(
  businessId: string,
  saleId: string,
): string {
  return `refunds:${businessId}:${saleId}`;
}
