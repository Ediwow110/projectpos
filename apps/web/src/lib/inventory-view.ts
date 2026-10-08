import { formatPesoMinor } from "./money";

export type InventoryHealth = "healthy" | "low" | "out";

export function inventoryStatus(qtyOnHand: number, reorderLevel: number): InventoryHealth {
  if (qtyOnHand <= 0) return "out";
  if (qtyOnHand <= reorderLevel) return "low";
  return "healthy";
}

export function optionalMoney(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined) return null;
  return formatPesoMinor(minor);
}
