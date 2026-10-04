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

export interface PurchaseReceiptLine {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  quantityReceived: number;
  unitCostMinorSnapshot: number;
  productNameSnapshot: string;
  supplierSkuSnapshot: string | null;
}

export interface PurchaseReceipt {
  id: string;
  receiptNumber: string;
  purchaseOrderId: string;
  branchId: string | null;
  status: string;
  receivedBy: string;
  receivedAt: string;
  notes: string | null;
  lines: PurchaseReceiptLine[];
}

export interface SupplierReturnLine {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  quantity: number;
  unitCostMinorSnapshot: number;
  productNameSnapshot: string;
  supplierSkuSnapshot: string | null;
}

export interface SupplierReturn {
  id: string;
  returnNumber: string;
  supplierId: string;
  purchaseOrderId: string;
  branchId: string | null;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  reason: string;
  version: number;
  createdAt: string;
  lines: SupplierReturnLine[];
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  branchId: string | null;
  poNumber: string;
  status: "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  expectedDate: string | null;
  notes: string | null;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  version: number;
  createdAt: string;
  lines: PurchaseOrderLine[];
  receipts?: PurchaseReceipt[];
  supplierReturns?: SupplierReturn[];
}

export function purchaseOrdersPath(opts: { q?: string; status?: string; supplierId?: string; branchId?: string; page?: number; pageSize?: number } = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(opts)) if (value !== undefined && value !== "") params.set(key, String(value));
  const query = params.toString();
  return `/api/v1/purchase-orders${query ? `?${query}` : ""}`;
}

export const PROCUREMENT_ONLINE_ONLY_MESSAGE = "Receiving and supplier returns require an internet connection.";
export function purchaseReceiptsPath(purchaseOrderId: string): string { return `/api/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/receipts`; }
export function purchaseReceiptPath(receiptId: string): string { return `/api/v1/purchase-receipts/${encodeURIComponent(receiptId)}`; }
export function supplierReturnsPath(): string { return "/api/v1/supplier-returns"; }
export function supplierReturnPath(returnId: string): string { return `/api/v1/supplier-returns/${encodeURIComponent(returnId)}`; }

export function purchaseOrderStatusLabel(status: string): string {
  if (status === "DRAFT") return "Draft";
  if (status === "ORDERED") return "Ordered";
  if (status === "PARTIALLY_RECEIVED") return "Partially received";
  if (status === "RECEIVED") return "Received";
  if (status === "CANCELLED") return "Cancelled";
  return status;
}

export function purchaseOrderStatusTone(status: string): "ok" | "warn" | "bad" | "info" {
  if (status === "ORDERED" || status === "RECEIVED") return "ok";
  if (status === "CANCELLED") return "bad";
  return "warn";
}

export function supplierReturnActions(status: SupplierReturn["status"], canWrite: boolean): { canPost: boolean; canCancel: boolean } {
  const writableDraft = canWrite && status === "DRAFT";
  return { canPost: writableDraft, canCancel: writableDraft };
}

export { formatMinor, requestKey };
