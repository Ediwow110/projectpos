export function refundableQty(soldQty: number, alreadyRefundedQty: number): number {
  return Math.max(0, soldQty - alreadyRefundedQty);
}

export function lineRefundAmount(lineTotalMinor: number, soldQty: number, refundQty: number): number {
  if (soldQty <= 0) throw new Error("VALIDATION");
  return Math.round((lineTotalMinor * refundQty) / soldQty);
}
