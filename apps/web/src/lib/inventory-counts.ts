export type CountStatus = "DRAFT" | "COUNTING" | "SUBMITTED" | "APPROVED" | "POSTED" | "CANCELLED";

export interface InventoryCountLine {
  id: string;
  productId: string;
  expectedQtySnapshot: number;
  balanceUpdatedAtSnapshot: string | null;
  countedQty: number | null;
  varianceQty: number | null;
  productNameSnapshot: string;
  skuSnapshot: string | null;
  notes: string | null;
}

export interface InventoryCount {
  id: string;
  countNumber: string;
  branchId: string | null;
  status: CountStatus;
  scopeType: "FULL" | "PARTIAL";
  name: string;
  notes: string | null;
  version: number;
  createdAt: string;
  startedAt: string | null;
  lines: InventoryCountLine[];
}

export interface ReplenishmentRow {
  productId: string;
  productName: string;
  sku: string | null;
  branchId: string | null;
  onHand: number;
  onOrderQty: number;
  effectiveQty: number;
  reorderLevel: number;
  targetQty: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  unitCostMinor: number;
}

export function countTone(status: CountStatus): "ok" | "warn" | "bad" | "info" {
  if (status === "POSTED") return "ok";
  if (status === "CANCELLED") return "bad";
  if (status === "SUBMITTED" || status === "APPROVED") return "warn";
  return "info";
}

export function varianceSummary(lines: InventoryCountLine[]): { positive: number; negative: number; net: number; products: number } {
  return lines.reduce((summary, line) => {
    const variance = line.varianceQty ?? 0;
    return { positive: summary.positive + Math.max(0, variance), negative: summary.negative + Math.min(0, variance), net: summary.net + variance, products: summary.products + (variance === 0 ? 0 : 1) };
  }, { positive: 0, negative: 0, net: 0, products: 0 });
}
