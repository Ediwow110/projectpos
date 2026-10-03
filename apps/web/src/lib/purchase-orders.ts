import { formatMinor, requestKey } from "./suppliers";

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  position: number;
  supplierSkuSnapshot: string | null;
  productNameSnapshot: string;
  quantity: number;
  unitCostMinor: number;
  lineTotalMinor: number;
  notes: string | null;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  branchId: string | null;
  poNumber: string;
  status: "DRAFT" | "ORDERED" | "CANCELLED";
  expectedDate: string | null;
  notes: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  version: number;
  createdAt: string;
  lines: PurchaseOrderLine[];
}

export function purchaseOrdersPath(opts: { q?: string; status?: string; supplierId?: string; branchId?: string; page?: number; pageSize?: number } = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return `/api/v1/purchase-orders${query ? `?${query}` : ""}`;
}

export function purchaseOrderStatusLabel(status: string): string {
  if (status === "DRAFT") return "Draft";
  if (status === "ORDERED") return "Ordered";
  if (status === "CANCELLED") return "Cancelled";
  return status;
}

export function purchaseOrderStatusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "ORDERED") return "ok";
  if (status === "CANCELLED") return "bad";
  return "warn";
}

export { formatMinor, requestKey };
