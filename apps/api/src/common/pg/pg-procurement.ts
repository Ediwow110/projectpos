import type {
  AuditEntry,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplier,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// Phase 16: the procurement family — suppliers, product-supplier mappings,
// purchase orders and their lines. Commercial records only; this file never
// writes InventoryBalance/InventoryMovement (the load-bearing Phase 16 rule).
// Mapping notes (branches/inventory conventions apply):
// - Tenant scoping is every query's second predicate; a foreign id reads as
//   no-row and callers surface NOT_FOUND.
// - update* builds the SET clause from provided patch keys only and stamps
//   "updatedAt" = CURRENT_TIMESTAMP; updatePurchaseOrder is additionally the
//   optimistic-concurrency CAS (version must equal expectedVersion, and the
//   write bumps it). A stale CAS simply returns no row.
// - nextPoNo mirrors nextReceiptNo: atomic upsert-increment on POCounter,
//   formatted PO-<UTC year>-<6-digit seq>; services call it inside the
//   per-order/per-business advisory locks, and the unique poNumber index is
//   the final arbiter against cross-process races.
// - Reads return exactly the port shapes (timestamps included, since the
//   procurement port interfaces carry them).
const SUPPLIER_COLUMNS =
  '"id", "businessId", "name", "code", "contactName", "email", "phone", "addressLine1", ' +
  '"addressLine2", "city", "province", "postalCode", "country", "paymentTerms", "notes", ' +
  '"isActive", "createdAt", "updatedAt"';
const PRODUCT_SUPPLIER_COLUMNS =
  '"id", "businessId", "productId", "supplierId", "supplierSku", "unitCostMinor", ' +
  '"leadTimeDays", "isPreferred", "createdAt", "updatedAt"';
const PURCHASE_ORDER_COLUMNS =
  '"id", "businessId", "supplierId", "branchId", "poNumber", "status", "expectedDate", "notes", ' +
  '"subtotalMinor", "taxMinor", "totalMinor", "version", "createdBy", "orderedBy", "orderedAt", ' +
  '"cancelledBy", "cancelledAt", "cancelReason", "createdAt", "updatedAt"';
const PURCHASE_ORDER_LINE_COLUMNS =
  '"id", "businessId", "purchaseOrderId", "productId", "position", "supplierSkuSnapshot", ' +
  '"productNameSnapshot", "quantity", "unitCostMinor", "lineTotalMinor", "notes", ' +
  '"createdAt", "updatedAt"';
const PURCHASE_RECEIPT_COLUMNS = '"id", "businessId", "purchaseOrderId", "branchId", "receiptNumber", "status", "receivedBy", "receivedAt", "notes", "createdAt"';
const PURCHASE_RECEIPT_LINE_COLUMNS = '"id", "businessId", "purchaseReceiptId", "purchaseOrderLineId", "productId", "quantityReceived", "unitCostMinorSnapshot", "productNameSnapshot", "supplierSkuSnapshot", "createdAt"';
const SUPPLIER_RETURN_COLUMNS = '"id", "businessId", "supplierId", "purchaseOrderId", "branchId", "returnNumber", "status", "reason", "createdBy", "postedBy", "postedAt", "cancelledBy", "cancelledAt", "version", "createdAt", "updatedAt"';
const SUPPLIER_RETURN_LINE_COLUMNS = '"id", "businessId", "supplierReturnId", "purchaseOrderLineId", "productId", "quantity", "unitCostMinorSnapshot", "productNameSnapshot", "supplierSkuSnapshot", "createdAt", "updatedAt"';

function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`"${key}" = $${values.length}`);
  }
  return { sets, values };
}

function supplierRow(r: Record<string, unknown>): DbSupplier {
  return {
    id: r["id"] as string,
    businessId: r["businessId"] as string,
    name: r["name"] as string,
    code: (r["code"] as string | null) ?? null,
    contactName: (r["contactName"] as string | null) ?? null,
    email: (r["email"] as string | null) ?? null,
    phone: (r["phone"] as string | null) ?? null,
    addressLine1: (r["addressLine1"] as string | null) ?? null,
    addressLine2: (r["addressLine2"] as string | null) ?? null,
    city: (r["city"] as string | null) ?? null,
    province: (r["province"] as string | null) ?? null,
    postalCode: (r["postalCode"] as string | null) ?? null,
    country: r["country"] as string,
    paymentTerms: (r["paymentTerms"] as string | null) ?? null,
    notes: (r["notes"] as string | null) ?? null,
    isActive: r["isActive"] as boolean,
    createdAt: r["createdAt"] as Date,
    updatedAt: r["updatedAt"] as Date,
  };
}

function productSupplierRow(r: Record<string, unknown>): DbProductSupplier {
  return {
    id: r["id"] as string,
    businessId: r["businessId"] as string,
    productId: r["productId"] as string,
    supplierId: r["supplierId"] as string,
    supplierSku: (r["supplierSku"] as string | null) ?? null,
    unitCostMinor: (r["unitCostMinor"] as number | null) ?? null,
    leadTimeDays: (r["leadTimeDays"] as number | null) ?? null,
    isPreferred: r["isPreferred"] as boolean,
    createdAt: r["createdAt"] as Date,
    updatedAt: r["updatedAt"] as Date,
  };
}

function purchaseOrderRow(r: Record<string, unknown>): DbPurchaseOrder {
  return {
    id: r["id"] as string,
    businessId: r["businessId"] as string,
    supplierId: r["supplierId"] as string,
    branchId: (r["branchId"] as string | null) ?? null,
    poNumber: r["poNumber"] as string,
    status: r["status"] as string,
    expectedDate: (r["expectedDate"] as Date | null) ?? null,
    notes: (r["notes"] as string | null) ?? null,
    subtotalMinor: r["subtotalMinor"] as number,
    taxMinor: r["taxMinor"] as number,
    totalMinor: r["totalMinor"] as number,
    version: r["version"] as number,
    createdBy: r["createdBy"] as string,
    orderedBy: (r["orderedBy"] as string | null) ?? null,
    orderedAt: (r["orderedAt"] as Date | null) ?? null,
    cancelledBy: (r["cancelledBy"] as string | null) ?? null,
    cancelledAt: (r["cancelledAt"] as Date | null) ?? null,
    cancelReason: (r["cancelReason"] as string | null) ?? null,
    createdAt: r["createdAt"] as Date,
    updatedAt: r["updatedAt"] as Date,
  };
}

function purchaseOrderLineRow(r: Record<string, unknown>): DbPurchaseOrderLine {
  return {
    id: r["id"] as string,
    businessId: r["businessId"] as string,
    purchaseOrderId: r["purchaseOrderId"] as string,
    productId: r["productId"] as string,
    position: r["position"] as number,
    supplierSkuSnapshot: (r["supplierSkuSnapshot"] as string | null) ?? null,
    productNameSnapshot: r["productNameSnapshot"] as string,
    quantity: r["quantity"] as number,
    unitCostMinor: r["unitCostMinor"] as number,
    lineTotalMinor: r["lineTotalMinor"] as number,
    notes: (r["notes"] as string | null) ?? null,
    createdAt: r["createdAt"] as Date,
    updatedAt: r["updatedAt"] as Date,
  };
}

function purchaseReceiptRow(r: Record<string, unknown>): DbPurchaseReceipt {
  return { id: r["id"] as string, businessId: r["businessId"] as string, purchaseOrderId: r["purchaseOrderId"] as string, branchId: (r["branchId"] as string | null) ?? null, receiptNumber: r["receiptNumber"] as string, status: r["status"] as string, receivedBy: r["receivedBy"] as string, receivedAt: r["receivedAt"] as Date, notes: (r["notes"] as string | null) ?? null, createdAt: r["createdAt"] as Date };
}

function purchaseReceiptLineRow(r: Record<string, unknown>): DbPurchaseReceiptLine {
  return { id: r["id"] as string, businessId: r["businessId"] as string, purchaseReceiptId: r["purchaseReceiptId"] as string, purchaseOrderLineId: r["purchaseOrderLineId"] as string, productId: r["productId"] as string, quantityReceived: r["quantityReceived"] as number, unitCostMinorSnapshot: r["unitCostMinorSnapshot"] as number, productNameSnapshot: r["productNameSnapshot"] as string, supplierSkuSnapshot: (r["supplierSkuSnapshot"] as string | null) ?? null, createdAt: r["createdAt"] as Date };
}

function supplierReturnRow(r: Record<string, unknown>): DbSupplierReturn {
  return { id: r["id"] as string, businessId: r["businessId"] as string, supplierId: r["supplierId"] as string, purchaseOrderId: r["purchaseOrderId"] as string, branchId: (r["branchId"] as string | null) ?? null, returnNumber: r["returnNumber"] as string, status: r["status"] as string, reason: r["reason"] as string, createdBy: r["createdBy"] as string, postedBy: (r["postedBy"] as string | null) ?? null, postedAt: (r["postedAt"] as Date | null) ?? null, cancelledBy: (r["cancelledBy"] as string | null) ?? null, cancelledAt: (r["cancelledAt"] as Date | null) ?? null, version: r["version"] as number, createdAt: r["createdAt"] as Date, updatedAt: r["updatedAt"] as Date };
}

function supplierReturnLineRow(r: Record<string, unknown>): DbSupplierReturnLine {
  return { id: r["id"] as string, businessId: r["businessId"] as string, supplierReturnId: r["supplierReturnId"] as string, purchaseOrderLineId: r["purchaseOrderLineId"] as string, productId: r["productId"] as string, quantity: r["quantity"] as number, unitCostMinorSnapshot: r["unitCostMinorSnapshot"] as number, productNameSnapshot: r["productNameSnapshot"] as string, supplierSkuSnapshot: (r["supplierSkuSnapshot"] as string | null) ?? null, createdAt: r["createdAt"] as Date, updatedAt: r["updatedAt"] as Date };
}

export function procurementFamily(ctx: PgContext) {
  return {
    async createSupplier(s: Omit<DbSupplier, "id" | "createdAt" | "updatedAt">): Promise<DbSupplier> {
      const c = await ctx.client();
      try {
        const row: DbSupplier = { ...s, id: nid("spr"), createdAt: new Date(), updatedAt: new Date() };
        await c.query(
          'INSERT INTO "Supplier" ("id", "businessId", "name", "code", "contactName", "email", "phone", ' +
            '"addressLine1", "addressLine2", "city", "province", "postalCode", "country", "paymentTerms", ' +
            '"notes", "isActive", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.name, row.code, row.contactName, row.email, row.phone,
            row.addressLine1, row.addressLine2, row.city, row.province, row.postalCode, row.country,
            row.paymentTerms, row.notes, row.isActive,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listSuppliersByBusiness(businessId: string): Promise<DbSupplier[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SUPPLIER_COLUMNS} FROM "Supplier" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows.map((row) => supplierRow(row as Record<string, unknown>));
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findSupplierById(id: string, businessId: string): Promise<DbSupplier | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${SUPPLIER_COLUMNS} FROM "Supplier" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? supplierRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateSupplier(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbSupplier, "id" | "businessId" | "createdAt">>,
    ): Promise<DbSupplier | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Supplier" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${SUPPLIER_COLUMNS}`,
          [...values, id, businessId],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? supplierRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createProductSupplier(
      r0: Omit<DbProductSupplier, "id" | "createdAt" | "updatedAt">,
    ): Promise<DbProductSupplier> {
      const c = await ctx.client();
      try {
        const row: DbProductSupplier = { ...r0, id: nid("psup"), createdAt: new Date(), updatedAt: new Date() };
        await c.query(
          'INSERT INTO "ProductSupplier" ("id", "businessId", "productId", "supplierId", "supplierSku", ' +
            '"unitCostMinor", "leadTimeDays", "isPreferred", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.productId, row.supplierId, row.supplierSku,
            row.unitCostMinor, row.leadTimeDays, row.isPreferred,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listProductSuppliersBySupplier(supplierId: string, businessId: string): Promise<DbProductSupplier[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRODUCT_SUPPLIER_COLUMNS} FROM "ProductSupplier" WHERE "supplierId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC`,
          [supplierId, businessId],
        );
        return r.rows.map((row) => productSupplierRow(row as Record<string, unknown>));
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listProductSuppliersByBusiness(businessId: string): Promise<DbProductSupplier[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRODUCT_SUPPLIER_COLUMNS} FROM "ProductSupplier" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows.map((row) => productSupplierRow(row as Record<string, unknown>));
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findProductSupplierById(id: string, businessId: string): Promise<DbProductSupplier | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRODUCT_SUPPLIER_COLUMNS} FROM "ProductSupplier" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? productSupplierRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateProductSupplier(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbProductSupplier, "id" | "businessId" | "productId" | "supplierId" | "createdAt">>,
    ): Promise<DbProductSupplier | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "ProductSupplier" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${PRODUCT_SUPPLIER_COLUMNS}`,
          [...values, id, businessId],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? productSupplierRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async clearPreferredProductSuppliers(
      businessId: string,
      productId: string,
      exceptId?: string,
    ): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'UPDATE "ProductSupplier" SET "isPreferred" = false, "updatedAt" = CURRENT_TIMESTAMP' +
            ' WHERE "businessId" = $1 AND "productId" = $2 AND "isPreferred"' +
            ' AND "id" <> COALESCE($3::text, \'\')',
          [businessId, productId, exceptId ?? null],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async deleteProductSupplier(id: string, businessId: string): Promise<boolean> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'DELETE FROM "ProductSupplier" WHERE "id" = $1 AND "businessId" = $2',
          [id, businessId],
        );
        return (r.rowCount ?? 0) > 0;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createPurchaseOrder(
      p: Omit<DbPurchaseOrder, "id" | "createdAt" | "updatedAt" | "version"> & { version?: number },
    ): Promise<DbPurchaseOrder> {
      const c = await ctx.client();
      try {
        const row: DbPurchaseOrder = {
          ...p,
          id: nid("po"),
          version: p.version ?? 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await c.query(
          'INSERT INTO "PurchaseOrder" ("id", "businessId", "supplierId", "branchId", "poNumber", "status", ' +
            '"expectedDate", "notes", "subtotalMinor", "taxMinor", "totalMinor", "version", "createdBy", ' +
            '"orderedBy", "orderedAt", "cancelledBy", "cancelledAt", "cancelReason", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.supplierId, row.branchId, row.poNumber, row.status,
            row.expectedDate, row.notes, row.subtotalMinor, row.taxMinor, row.totalMinor,
            row.version, row.createdBy, row.orderedBy, row.orderedAt, row.cancelledBy,
            row.cancelledAt, row.cancelReason,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findPurchaseOrderById(id: string, businessId: string): Promise<DbPurchaseOrder | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PURCHASE_ORDER_COLUMNS} FROM "PurchaseOrder" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? purchaseOrderRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listPurchaseOrdersByBusiness(businessId: string): Promise<DbPurchaseOrder[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PURCHASE_ORDER_COLUMNS} FROM "PurchaseOrder" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows.map((row) => purchaseOrderRow(row as Record<string, unknown>));
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updatePurchaseOrder(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbPurchaseOrder, "id" | "businessId" | "createdAt" | "version">>,
      expectedVersion: number,
    ): Promise<DbPurchaseOrder | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "PurchaseOrder" SET ${sets.length ? sets.join(", ") + ", " : ""}` +
            `"version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` AND "version" = $${values.length + 3}` +
            ` RETURNING ${PURCHASE_ORDER_COLUMNS}`,
          [...values, id, businessId, expectedVersion],
        );
        const row = r.rows[0] as Record<string, unknown> | undefined;
        return row ? purchaseOrderRow(row) : null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async nextPoNo(businessId: string): Promise<string> {
      const year = new Date().getUTCFullYear();
      const c = await ctx.client();
      try {
        const r = await c.query(
          'INSERT INTO "POCounter" ("id", "businessId", "seq") VALUES ($1, $2, 1)' +
            ' ON CONFLICT ("businessId") DO UPDATE SET "seq" = "POCounter"."seq" + 1 RETURNING "seq"',
          [nid("poctr"), businessId],
        );
        return `PO-${year}-${String(r.rows[0]!["seq"] as number).padStart(6, "0")}`;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createPurchaseOrderLine(
      l: Omit<DbPurchaseOrderLine, "id" | "createdAt" | "updatedAt">,
    ): Promise<DbPurchaseOrderLine> {
      const c = await ctx.client();
      try {
        const row: DbPurchaseOrderLine = {
          ...l,
          id: nid("pol"),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await c.query(
          'INSERT INTO "PurchaseOrderLine" ("id", "businessId", "purchaseOrderId", "productId", "position", ' +
            '"supplierSkuSnapshot", "productNameSnapshot", "quantity", "unitCostMinor", "lineTotalMinor", ' +
            '"notes", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.purchaseOrderId, row.productId, row.position,
            row.supplierSkuSnapshot, row.productNameSnapshot, row.quantity, row.unitCostMinor,
            row.lineTotalMinor, row.notes,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listPurchaseOrderLines(purchaseOrderId: string, businessId: string): Promise<DbPurchaseOrderLine[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PURCHASE_ORDER_LINE_COLUMNS} FROM "PurchaseOrderLine" WHERE "purchaseOrderId" = $1 AND "businessId" = $2 ORDER BY "position" ASC, "id" ASC`,
          [purchaseOrderId, businessId],
        );
        return r.rows.map((row) => purchaseOrderLineRow(row as Record<string, unknown>));
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async deletePurchaseOrderLines(purchaseOrderId: string, businessId: string): Promise<void> {
      const c = await ctx.client();
      try {
        await c.query(
          'DELETE FROM "PurchaseOrderLine" WHERE "purchaseOrderId" = $1 AND "businessId" = $2',
          [purchaseOrderId, businessId],
        );
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async nextPurchaseReceiptNo(businessId: string): Promise<string> {
      const year = new Date().getUTCFullYear();
      const c = await ctx.client();
      try {
        const r = await c.query('INSERT INTO "PurchaseReceiptCounter" ("id", "businessId", "seq") VALUES ($1, $2, 1) ON CONFLICT ("businessId") DO UPDATE SET "seq" = "PurchaseReceiptCounter"."seq" + 1 RETURNING "seq"', [nid("grnctr"), businessId]);
        return `GRN-${year}-${String(r.rows[0]!["seq"] as number).padStart(6, "0")}`;
      } finally { if (ctx.owns()) c.release(); }
    },
    async createPurchaseReceipt(r0: Omit<DbPurchaseReceipt, "id" | "createdAt">): Promise<DbPurchaseReceipt> {
      const c = await ctx.client();
      try {
        const row = { ...r0, id: nid("grn"), createdAt: new Date() };
        await c.query('INSERT INTO "PurchaseReceipt" ("id", "businessId", "purchaseOrderId", "branchId", "receiptNumber", "status", "receivedBy", "receivedAt", "notes", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)', [row.id,row.businessId,row.purchaseOrderId,row.branchId,row.receiptNumber,row.status,row.receivedBy,row.receivedAt,row.notes]);
        return row;
      } finally { if (ctx.owns()) c.release(); }
    },
    async findPurchaseReceiptById(id: string, businessId: string): Promise<DbPurchaseReceipt | null> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${PURCHASE_RECEIPT_COLUMNS} FROM "PurchaseReceipt" WHERE "id" = $1 AND "businessId" = $2`, [id,businessId]); const row = r.rows[0] as Record<string, unknown> | undefined; return row ? purchaseReceiptRow(row) : null; }
      finally { if (ctx.owns()) c.release(); }
    },
    async listPurchaseReceiptsByOrder(purchaseOrderId: string, businessId: string): Promise<DbPurchaseReceipt[]> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${PURCHASE_RECEIPT_COLUMNS} FROM "PurchaseReceipt" WHERE "purchaseOrderId" = $1 AND "businessId" = $2 ORDER BY "createdAt" ASC, "id" ASC`, [purchaseOrderId,businessId]); return r.rows.map((row) => purchaseReceiptRow(row as Record<string, unknown>)); }
      finally { if (ctx.owns()) c.release(); }
    },
    async createPurchaseReceiptLine(l0: Omit<DbPurchaseReceiptLine, "id" | "createdAt">): Promise<DbPurchaseReceiptLine> {
      const c = await ctx.client();
      try { const row = { ...l0, id: nid("grnl"), createdAt: new Date() }; await c.query('INSERT INTO "PurchaseReceiptLine" ("id","businessId","purchaseReceiptId","purchaseOrderLineId","productId","quantityReceived","unitCostMinorSnapshot","productNameSnapshot","supplierSkuSnapshot","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)', [row.id,row.businessId,row.purchaseReceiptId,row.purchaseOrderLineId,row.productId,row.quantityReceived,row.unitCostMinorSnapshot,row.productNameSnapshot,row.supplierSkuSnapshot]); return row; }
      finally { if (ctx.owns()) c.release(); }
    },
    async listPurchaseReceiptLines(receiptId: string, businessId: string): Promise<DbPurchaseReceiptLine[]> {
      const c = await ctx.client();
      try { const r = await c.query(`SELECT ${PURCHASE_RECEIPT_LINE_COLUMNS} FROM "PurchaseReceiptLine" WHERE "purchaseReceiptId" = $1 AND "businessId" = $2 ORDER BY "id" ASC`, [receiptId,businessId]); return r.rows.map((row) => purchaseReceiptLineRow(row as Record<string, unknown>)); }
      finally { if (ctx.owns()) c.release(); }
    },
    async nextSupplierReturnNo(businessId: string): Promise<string> {
      const year = new Date().getUTCFullYear(); const c = await ctx.client();
      try { const r = await c.query('INSERT INTO "SupplierReturnCounter" ("id", "businessId", "seq") VALUES ($1,$2,1) ON CONFLICT ("businessId") DO UPDATE SET "seq" = "SupplierReturnCounter"."seq" + 1 RETURNING "seq"', [nid("sretctr"),businessId]); return `SRT-${year}-${String(r.rows[0]!["seq"] as number).padStart(6, "0")}`; }
      finally { if (ctx.owns()) c.release(); }
    },
    async createSupplierReturn(r0: Omit<DbSupplierReturn, "id" | "createdAt" | "updatedAt">): Promise<DbSupplierReturn> {
      const c = await ctx.client();
      try { const now = new Date(); const row = { ...r0, id: nid("sret"), createdAt: now, updatedAt: now }; await c.query('INSERT INTO "SupplierReturn" ("id","businessId","supplierId","purchaseOrderId","branchId","returnNumber","status","reason","createdBy","postedBy","postedAt","cancelledBy","cancelledAt","version","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [row.id,row.businessId,row.supplierId,row.purchaseOrderId,row.branchId,row.returnNumber,row.status,row.reason,row.createdBy,row.postedBy,row.postedAt,row.cancelledBy,row.cancelledAt,row.version]); return row; }
      finally { if (ctx.owns()) c.release(); }
    },
    async findSupplierReturnById(id: string, businessId: string): Promise<DbSupplierReturn | null> {
      const c = await ctx.client(); try { const r = await c.query(`SELECT ${SUPPLIER_RETURN_COLUMNS} FROM "SupplierReturn" WHERE "id"=$1 AND "businessId"=$2`, [id,businessId]); const row = r.rows[0] as Record<string, unknown> | undefined; return row ? supplierReturnRow(row) : null; } finally { if (ctx.owns()) c.release(); }
    },
    async listSupplierReturnsByBusiness(businessId: string): Promise<DbSupplierReturn[]> {
      const c = await ctx.client(); try { const r = await c.query(`SELECT ${SUPPLIER_RETURN_COLUMNS} FROM "SupplierReturn" WHERE "businessId"=$1 ORDER BY "createdAt" ASC, "id" ASC`, [businessId]); return r.rows.map((row) => supplierReturnRow(row as Record<string, unknown>)); } finally { if (ctx.owns()) c.release(); }
    },
    async listSupplierReturnsByOrder(purchaseOrderId: string, businessId: string): Promise<DbSupplierReturn[]> {
      const c = await ctx.client(); try { const r = await c.query(`SELECT ${SUPPLIER_RETURN_COLUMNS} FROM "SupplierReturn" WHERE "purchaseOrderId"=$1 AND "businessId"=$2 ORDER BY "createdAt" ASC, "id" ASC`, [purchaseOrderId,businessId]); return r.rows.map((row) => supplierReturnRow(row as Record<string, unknown>)); } finally { if (ctx.owns()) c.release(); }
    },
    async updateSupplierReturn(id: string, businessId: string, patch: Partial<Omit<DbSupplierReturn, "id" | "businessId" | "createdAt" | "version">>, expectedVersion: number): Promise<DbSupplierReturn | null> {
      const c = await ctx.client(); try { const { sets, values } = buildSet(patch); const r = await c.query(`UPDATE "SupplierReturn" SET ${sets.length ? sets.join(", ") + ", " : ""}"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} AND "version"=$${values.length+3} RETURNING ${SUPPLIER_RETURN_COLUMNS}`, [...values,id,businessId,expectedVersion]); const row = r.rows[0] as Record<string, unknown> | undefined; return row ? supplierReturnRow(row) : null; } finally { if (ctx.owns()) c.release(); }
    },
    async createSupplierReturnLine(l0: Omit<DbSupplierReturnLine, "id" | "createdAt" | "updatedAt">): Promise<DbSupplierReturnLine> {
      const c = await ctx.client(); try { const row = { ...l0, id: nid("sretl"), createdAt: new Date(), updatedAt: new Date() }; await c.query('INSERT INTO "SupplierReturnLine" ("id","businessId","supplierReturnId","purchaseOrderLineId","productId","quantity","unitCostMinorSnapshot","productNameSnapshot","supplierSkuSnapshot","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [row.id,row.businessId,row.supplierReturnId,row.purchaseOrderLineId,row.productId,row.quantity,row.unitCostMinorSnapshot,row.productNameSnapshot,row.supplierSkuSnapshot]); return row; } finally { if (ctx.owns()) c.release(); }
    },
    async listSupplierReturnLines(returnId: string, businessId: string): Promise<DbSupplierReturnLine[]> {
      const c = await ctx.client(); try { const r = await c.query(`SELECT ${SUPPLIER_RETURN_LINE_COLUMNS} FROM "SupplierReturnLine" WHERE "supplierReturnId"=$1 AND "businessId"=$2 ORDER BY "id" ASC`, [returnId,businessId]); return r.rows.map((row) => supplierReturnLineRow(row as Record<string, unknown>)); } finally { if (ctx.owns()) c.release(); }
    },
    async deleteSupplierReturnLines(returnId: string, businessId: string): Promise<void> {
      const c = await ctx.client(); try { await c.query('DELETE FROM "SupplierReturnLine" WHERE "supplierReturnId"=$1 AND "businessId"=$2', [returnId,businessId]); } finally { if (ctx.owns()) c.release(); }
    },

    async listAuditFor(businessId: string, entityType: string, entityId: string): Promise<AuditEntry[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          'SELECT "businessId", "actorId", "action", "entityType", "entityId", "requestId", ' +
            '"beforeSnapshot", "afterSnapshot", "reason", "createdAt" FROM "AuditLog"' +
            ' WHERE "businessId" = $1 AND "entityType" = $2 AND "entityId" = $3' +
            ' ORDER BY "createdAt" ASC, "id" ASC',
          [businessId, entityType, entityId],
        );
        return r.rows.map((row) => {
          const e = row as Record<string, unknown>;
          return {
            businessId: e["businessId"] as string | null,
            actorId: e["actorId"] as string,
            action: e["action"] as string,
            entityType: e["entityType"] as string,
            entityId: e["entityId"] as string,
            requestId: e["requestId"] as string,
            at: e["createdAt"] as Date,
            ...(e["reason"] !== null ? { reason: e["reason"] as string } : {}),
            ...(e["beforeSnapshot"] !== null ? { before: e["beforeSnapshot"] } : {}),
            ...(e["afterSnapshot"] !== null ? { after: e["afterSnapshot"] } : {}),
          } satisfies AuditEntry;
        });
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type ProcurementFamily = ReturnType<typeof procurementFamily>;
