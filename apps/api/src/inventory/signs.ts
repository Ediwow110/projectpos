export type MovementType =
  | "opening_stock" | "receive" | "sale" | "return" | "damage"
  | "adjustment" | "transfer_in" | "transfer_out" | "stock_count"
  | "supplier_return";

const POSITIVE = new Set(["opening_stock", "receive", "return", "transfer_in"]);
const NEGATIVE = new Set(["sale", "damage", "transfer_out", "supplier_return"]);

export function signFor(type: MovementType): 1 | -1 | 0 {
  if (POSITIVE.has(type)) return 1;
  if (NEGATIVE.has(type)) return -1;
  return 0;
}

export function validateQtyDelta(type: MovementType, qtyDelta: number): void {
  if (!Number.isInteger(qtyDelta) || qtyDelta === 0) throw new Error("VALIDATION");
  const sign = signFor(type);
  if (sign === 1 && qtyDelta < 0) throw new Error("VALIDATION");
  if (sign === -1 && qtyDelta > 0) throw new Error("VALIDATION");
}
