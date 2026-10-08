import type {
  DbPort,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplier,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../db.port";

type MemoryProcurementContext = {
  suppliers: Map<string, DbSupplier>;
  productSuppliers: Map<string, DbProductSupplier>;
  purchaseOrders: Map<string, DbPurchaseOrder>;
  purchaseOrderLines: Map<string, DbPurchaseOrderLine>;
  poSeq: Map<string, number>;
  purchaseReceipts: Map<string, DbPurchaseReceipt>;
  purchaseReceiptLines: Map<string, DbPurchaseReceiptLine>;
  receiptSeq: Map<string, number>;
  supplierReturns: Map<string, DbSupplierReturn>;
  supplierReturnLines: Map<string, DbSupplierReturnLine>;
  supplierReturnSeq: Map<string, number>;
  nextId: (prefix: string) => string;
};

export function createMemoryProcurement(context: MemoryProcurementContext): Pick<DbPort, "createSupplier" | "listSuppliersByBusiness" | "findSupplierById" | "updateSupplier" | "createProductSupplier" | "listProductSuppliersBySupplier" | "listProductSuppliersByBusiness" | "findProductSupplierById" | "updateProductSupplier" | "clearPreferredProductSuppliers" | "deleteProductSupplier" | "createPurchaseOrder" | "findPurchaseOrderById" | "listPurchaseOrdersByBusiness" | "updatePurchaseOrder" | "nextPoNo" | "createPurchaseOrderLine" | "listPurchaseOrderLines" | "deletePurchaseOrderLines"> {
  const {
    suppliers,
    productSuppliers,
    purchaseOrders,
    purchaseOrderLines,
    poSeq,
    purchaseReceipts,
    purchaseReceiptLines,
    receiptSeq,
    supplierReturns,
    supplierReturnLines,
    supplierReturnSeq,
    nextId: nid,
  } = context;

  return {
    async createSupplier(s) {
      const now = new Date();
      const row = { ...s, id: nid("spr"), createdAt: now, updatedAt: now };
      suppliers.set(row.id, row);
      return row;
    },
    async listSuppliersByBusiness(businessId) {
      return [...suppliers.values()].filter((s) => s.businessId === businessId);
    },
    async findSupplierById(id, businessId) {
      const s = suppliers.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      return s;
    },
    async updateSupplier(id, businessId, patch) {
      const s = suppliers.get(id) ?? null;
      if (!s || s.businessId !== businessId) return null;
      const next = { ...s, ...patch, updatedAt: new Date() };
      suppliers.set(id, next);
      return next;
    },

    async createProductSupplier(r) {
      const now = new Date();
      const row = { ...r, id: nid("psup"), createdAt: now, updatedAt: now };
      productSuppliers.set(row.id, row);
      return row;
    },
    async listProductSuppliersBySupplier(supplierId, businessId) {
      return [...productSuppliers.values()].filter(
        (r) => r.supplierId === supplierId && r.businessId === businessId,
      );
    },
    async listProductSuppliersByBusiness(businessId) {
      return [...productSuppliers.values()].filter((r) => r.businessId === businessId);
    },
    async findProductSupplierById(id, businessId) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      return r;
    },
    async updateProductSupplier(id, businessId, patch) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return null;
      const next = { ...r, ...patch, updatedAt: new Date() };
      productSuppliers.set(id, next);
      return next;
    },
    async clearPreferredProductSuppliers(businessId, productId, exceptId) {
      for (const [id, r] of productSuppliers) {
        if (r.businessId === businessId && r.productId === productId && r.isPreferred && id !== exceptId) {
          productSuppliers.set(id, { ...r, isPreferred: false, updatedAt: new Date() });
        }
      }
    },
    async deleteProductSupplier(id, businessId) {
      const r = productSuppliers.get(id) ?? null;
      if (!r || r.businessId !== businessId) return false;
      productSuppliers.delete(id);
      return true;
    },

    async createPurchaseOrder(p) {
      const now = new Date();
      const row = {
        ...p,
        id: nid("po"),
        version: p.version ?? 1,
        createdAt: now,
        updatedAt: now,
      };
      purchaseOrders.set(row.id, row);
      return row;
    },
    async findPurchaseOrderById(id, businessId) {
      const p = purchaseOrders.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async listPurchaseOrdersByBusiness(businessId) {
      return [...purchaseOrders.values()].filter((p) => p.businessId === businessId);
    },
    async updatePurchaseOrder(id, businessId, patch, expectedVersion) {
      const p = purchaseOrders.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      // Optimistic-concurrency CAS: a stale expectedVersion never writes.
      if (p.version !== expectedVersion) return null;
      const next = { ...p, ...patch, version: expectedVersion + 1, updatedAt: new Date() };
      purchaseOrders.set(id, next);
      return next;
    },
    async nextPoNo(businessId) {
      const year = new Date().getUTCFullYear();
      const seq = (poSeq.get(businessId) ?? 0) + 1;
      poSeq.set(businessId, seq);
      return `PO-${year}-${String(seq).padStart(6, "0")}`;
    },

    async createPurchaseOrderLine(l) {
      const now = new Date();
      const row = {
        ...l,
        id: nid("pol"),
        createdAt: now,
        updatedAt: now,
      };
      purchaseOrderLines.set(row.id, row);
      return row;
    },
    async listPurchaseOrderLines(purchaseOrderId, businessId) {
      return [...purchaseOrderLines.values()].filter(
        (l) => l.purchaseOrderId === purchaseOrderId && l.businessId === businessId,
      );
    },
    async deletePurchaseOrderLines(purchaseOrderId, businessId) {
      for (const [id, l] of purchaseOrderLines) {
        if (l.purchaseOrderId === purchaseOrderId && l.businessId === businessId) {
          purchaseOrderLines.delete(id);
        }
      }
    },
  };
}
