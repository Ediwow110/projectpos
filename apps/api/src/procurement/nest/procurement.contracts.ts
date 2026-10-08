import type {
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplier,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../../common/db.port";

export interface SupplierPage {
  items: DbSupplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductSupplierInput {
  productId: string;
  supplierSku?: string | null;
  unitCostMinor?: number | null;
  leadTimeDays?: number | null;
  isPreferred?: boolean;
}

export interface PurchaseOrderLineInput {
  productId: string;
  quantity: number;
  unitCostMinor?: number;
  notes?: string | null;
}

export interface PurchaseOrderInput {
  supplierId: string;
  branchId?: string | null;
  expectedDate?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLineInput[];
}

export interface PurchaseOrderWithLines extends DbPurchaseOrder {
  lines: DbPurchaseOrderLine[];
  receipts?: PurchaseReceiptWithLines[];
  supplierReturns?: SupplierReturnWithLines[];
}

export interface PurchaseReceiptWithLines extends DbPurchaseReceipt {
  lines: DbPurchaseReceiptLine[];
}

export interface SupplierReturnWithLines extends DbSupplierReturn {
  lines: DbSupplierReturnLine[];
}

export interface PurchaseOrderPage {
  items: PurchaseOrderWithLines[];
  total: number;
  page: number;
  pageSize: number;
}

export const SUPPLIER_WRITE = "supplier.write";
export const PO_WRITE = "purchase_order.write";
export const PO_ORDER = "purchase_order.order";
export const PO_CANCEL = "purchase_order.cancel";

export function snapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
