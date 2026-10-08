import type {
  AuditEntry,
  DbSupplier,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../types";

export interface ProcurementPort {
  // Phase 16: procurement. Every method is tenant-scoped by businessId; a
  // lookup miss (including a foreign tenant's id) returns null so callers map
  // it to NOT_FOUND. updatePurchaseOrder is the optimistic-concurrency CAS:
  // expectedVersion mismatch returns null without writing.
  createSupplier(s: Omit<DbSupplier, "id" | "createdAt" | "updatedAt">): Promise<DbSupplier>;
  listSuppliersByBusiness(businessId: string): Promise<DbSupplier[]>;
  findSupplierById(id: string, businessId: string): Promise<DbSupplier | null>;
  updateSupplier(
    id: string,
    businessId: string,
    patch: Partial<Omit<DbSupplier, "id" | "businessId" | "createdAt">>,
  ): Promise<DbSupplier | null>;

  createProductSupplier(r: Omit<DbProductSupplier, "id" | "createdAt" | "updatedAt">): Promise<DbProductSupplier>;
  listProductSuppliersBySupplier(supplierId: string, businessId: string): Promise<DbProductSupplier[]>;
  listProductSuppliersByBusiness(businessId: string): Promise<DbProductSupplier[]>;
  findProductSupplierById(id: string, businessId: string): Promise<DbProductSupplier | null>;
  updateProductSupplier(
    id: string,
    businessId: string,
    patch: Partial<Omit<DbProductSupplier, "id" | "businessId" | "productId" | "supplierId" | "createdAt">>,
  ): Promise<DbProductSupplier | null>;
  clearPreferredProductSuppliers(businessId: string, productId: string, exceptId?: string): Promise<void>;
  deleteProductSupplier(id: string, businessId: string): Promise<boolean>;

  createPurchaseOrder(p: Omit<DbPurchaseOrder, "id" | "createdAt" | "updatedAt" | "version"> & { version?: number }): Promise<DbPurchaseOrder>;
  findPurchaseOrderById(id: string, businessId: string): Promise<DbPurchaseOrder | null>;
  listPurchaseOrdersByBusiness(businessId: string): Promise<DbPurchaseOrder[]>;
  updatePurchaseOrder(
    id: string,
    businessId: string,
    patch: Partial<Omit<DbPurchaseOrder, "id" | "businessId" | "createdAt" | "version">>,
    expectedVersion: number,
  ): Promise<DbPurchaseOrder | null>;
  nextPoNo(businessId: string): Promise<string>;

  createPurchaseOrderLine(l: Omit<DbPurchaseOrderLine, "id" | "createdAt" | "updatedAt">): Promise<DbPurchaseOrderLine>;
  listPurchaseOrderLines(purchaseOrderId: string, businessId: string): Promise<DbPurchaseOrderLine[]>;
  deletePurchaseOrderLines(purchaseOrderId: string, businessId: string): Promise<void>;

  listAuditFor(businessId: string, entityType: string, entityId: string): Promise<AuditEntry[]>;

  // Phase 17: immutable receipt ledger and draft/post supplier returns.
  nextPurchaseReceiptNo(businessId: string): Promise<string>;
  createPurchaseReceipt(r: Omit<DbPurchaseReceipt, "id" | "createdAt">): Promise<DbPurchaseReceipt>;
  findPurchaseReceiptById(id: string, businessId: string): Promise<DbPurchaseReceipt | null>;
  listPurchaseReceiptsByOrder(purchaseOrderId: string, businessId: string): Promise<DbPurchaseReceipt[]>;
  createPurchaseReceiptLine(l: Omit<DbPurchaseReceiptLine, "id" | "createdAt">): Promise<DbPurchaseReceiptLine>;
  listPurchaseReceiptLines(receiptId: string, businessId: string): Promise<DbPurchaseReceiptLine[]>;
  nextSupplierReturnNo(businessId: string): Promise<string>;
  createSupplierReturn(r: Omit<DbSupplierReturn, "id" | "createdAt" | "updatedAt">): Promise<DbSupplierReturn>;
  findSupplierReturnById(id: string, businessId: string): Promise<DbSupplierReturn | null>;
  listSupplierReturnsByBusiness(businessId: string): Promise<DbSupplierReturn[]>;
  listSupplierReturnsByOrder(purchaseOrderId: string, businessId: string): Promise<DbSupplierReturn[]>;
  updateSupplierReturn(id: string, businessId: string, patch: Partial<Omit<DbSupplierReturn, "id" | "businessId" | "createdAt" | "version">>, expectedVersion: number): Promise<DbSupplierReturn | null>;
  createSupplierReturnLine(l: Omit<DbSupplierReturnLine, "id" | "createdAt" | "updatedAt">): Promise<DbSupplierReturnLine>;
  listSupplierReturnLines(returnId: string, businessId: string): Promise<DbSupplierReturnLine[]>;
  deleteSupplierReturnLines(returnId: string, businessId: string): Promise<void>;
}
