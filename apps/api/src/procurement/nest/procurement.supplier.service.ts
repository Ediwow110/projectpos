import { withScope } from "@pos/database";
import type {
  DbProductSupplier,
  DbSupplier,
} from "../../common/db.port";

import { fingerprintPayload } from "../../sales/idempotency";
import { normalizeSupplierCode, normalizeSupplierPayload } from "../normalize";
import type { ProductSupplierInput, PurchaseOrderWithLines, SupplierPage } from "./procurement.contracts";
import { SUPPLIER_WRITE, snapshot } from "./procurement.contracts";
import { ProcurementSupport } from "./procurement.support";

export class ProcurementSupplierService extends ProcurementSupport {
  async listSuppliers(
    businessId: string,
    opts: { q?: string; status: "active" | "inactive" | "all"; page: number; pageSize: number },
  ): Promise<SupplierPage> {
    withScope(businessId, {});
    const q = opts.q?.trim().toLowerCase();
    const rows = (await this.db.listSuppliersByBusiness(businessId))
      .filter((supplier) => opts.status === "all" || (opts.status === "active" ? supplier.isActive : !supplier.isActive))
      .filter((supplier) => !q || supplier.name.toLowerCase().includes(q) || supplier.code?.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const start = (opts.page - 1) * opts.pageSize;
    return { items: rows.slice(start, start + opts.pageSize), total: rows.length, page: opts.page, pageSize: opts.pageSize };
  }

  async getSupplier(businessId: string, id: string): Promise<{
    supplier: DbSupplier;
    productSuppliers: DbProductSupplier[];
    purchaseOrders: PurchaseOrderWithLines[];
  }> {
    withScope(businessId, {});
    const supplier = await this.requireSupplier(businessId, id);
    const productSuppliers = await this.db.listProductSuppliersBySupplier(id, businessId);
    const purchaseOrders = (await this.db.listPurchaseOrdersByBusiness(businessId))
      .filter((order) => order.supplierId === id)
      .map((order) => this.embed(order));
    return { supplier, productSuppliers, purchaseOrders: await Promise.all(purchaseOrders) };
  }

  async listSupplierProducts(businessId: string, id: string): Promise<DbProductSupplier[]> {
    withScope(businessId, {});
    await this.requireSupplier(businessId, id);
    return this.db.listProductSuppliersBySupplier(id, businessId);
  }

  async createSupplier(
    businessId: string,
    actorId: string,
    requestId: string,
    key: string,
    input: Record<string, unknown>,
    granted: string[],
  ): Promise<{ supplier: DbSupplier; replayed: boolean }> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    const fingerprint = fingerprintPayload(input);
    return this.db.withLock(`supplier:${businessId}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "supplier.create");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const supplier = await this.requireSupplier(businessId, existing.resultId);
        return { supplier, replayed: true };
      }
      const normalized = normalizeSupplierPayload(input as never);
      const name = typeof normalized.name === "string" ? normalized.name : "";
      if (!name) throw new Error("VALIDATION");
      const code = normalizeSupplierCode(normalized.code);
      await this.assertSupplierCodeAvailable(businessId, code);
      const supplier = await this.db.createSupplier({
        businessId,
        name,
        code,
        contactName: normalized.contactName ?? null,
        email: normalized.email ?? null,
        phone: normalized.phone ?? null,
        addressLine1: normalized.addressLine1 ?? null,
        addressLine2: normalized.addressLine2 ?? null,
        city: normalized.city ?? null,
        province: normalized.province ?? null,
        postalCode: normalized.postalCode ?? null,
        country: normalized.country ?? "PH",
        paymentTerms: normalized.paymentTerms ?? null,
        notes: normalized.notes ?? null,
        isActive: true,
      });
      await this.db.claimIdempotency({ businessId, key, commandType: "supplier.create", fingerprint, resultId: supplier.id });
      await this.db.appendAudit({ businessId, actorId, action: "supplier.create", entityType: "Supplier", entityId: supplier.id, requestId, after: snapshot(supplier) });
      return { supplier, replayed: false };
    });
  }

  async updateSupplier(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    input: Record<string, unknown>,
    granted: string[],
  ): Promise<DbSupplier> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    return this.db.withLock(`supplier:${businessId}:${id}`, async () => {
      const current = await this.requireSupplier(businessId, id);
      if ("isActive" in input) throw new Error("VALIDATION");
      const normalized = normalizeSupplierPayload(input as never);
      const code = normalized.code !== undefined ? normalizeSupplierCode(normalized.code) : undefined;
      await this.assertSupplierCodeAvailable(businessId, code ?? current.code, id);
      const next = await this.db.updateSupplier(id, businessId, { ...normalized, ...(code !== undefined ? { code } : {}) } as never);
      if (!next) throw new Error("NOT_FOUND");
      await this.db.appendAudit({ businessId, actorId, action: "supplier.update", entityType: "Supplier", entityId: id, requestId, before: snapshot(current), after: snapshot(next) });
      return next;
    });
  }

  async setSupplierActive(businessId: string, actorId: string, requestId: string, id: string, isActive: boolean, granted: string[]): Promise<DbSupplier> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    return this.db.withLock(`supplier:${businessId}:${id}`, async () => {
      const current = await this.requireSupplier(businessId, id);
      if (current.isActive === isActive) return current;
      const next = await this.db.updateSupplier(id, businessId, { isActive });
      if (!next) throw new Error("NOT_FOUND");
      await this.db.appendAudit({ businessId, actorId, action: isActive ? "supplier.reactivate" : "supplier.deactivate", entityType: "Supplier", entityId: id, requestId, before: snapshot(current), after: snapshot(next) });
      return next;
    });
  }

  async createProductSupplier(businessId: string, actorId: string, requestId: string, supplierId: string, input: ProductSupplierInput, granted: string[]): Promise<DbProductSupplier> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    if (input.unitCostMinor !== undefined && input.unitCostMinor !== null && (!Number.isSafeInteger(input.unitCostMinor) || input.unitCostMinor < 0)) throw new Error("VALIDATION");
    if (input.leadTimeDays !== undefined && input.leadTimeDays !== null && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 3650)) throw new Error("VALIDATION");
    return this.db.withLock(`product-supplier:${businessId}:${input.productId}`, async () => {
      const supplier = await this.requireSupplier(businessId, supplierId);
      if (!supplier.isActive) throw new Error("SUPPLIER_INACTIVE");
      const product = await this.requireProduct(businessId, input.productId);
      if (product.productType === "BUNDLE") throw new Error("PRODUCT_NOT_TRACKED");
      const existing = (await this.db.listProductSuppliersBySupplier(supplierId, businessId)).find((row) => row.productId === product.id);
      if (existing) throw new Error("PRODUCT_SUPPLIER_DUPLICATE");
      if (input.isPreferred) await this.db.clearPreferredProductSuppliers(businessId, product.id);
      const row = await this.db.createProductSupplier({
        businessId, productId: product.id, supplierId,
        supplierSku: input.supplierSku?.trim() || null,
        unitCostMinor: input.unitCostMinor ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
        isPreferred: input.isPreferred ?? false,
      });
      await this.db.appendAudit({ businessId, actorId, action: "product_supplier.create", entityType: "ProductSupplier", entityId: row.id, requestId, after: snapshot(row) });
      return row;
    });
  }

  async updateProductSupplier(businessId: string, actorId: string, requestId: string, id: string, input: Partial<ProductSupplierInput>, granted: string[], supplierId?: string): Promise<DbProductSupplier> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    if (input.unitCostMinor !== undefined && input.unitCostMinor !== null && (!Number.isSafeInteger(input.unitCostMinor) || input.unitCostMinor < 0)) throw new Error("VALIDATION");
    if (input.leadTimeDays !== undefined && input.leadTimeDays !== null && (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 3650)) throw new Error("VALIDATION");
    const current = await this.db.findProductSupplierById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    if (supplierId !== undefined && current.supplierId !== supplierId) throw new Error("NOT_FOUND");
    return this.db.withLock(`product-supplier:${businessId}:${current.productId}`, async () => {
      if (input.isPreferred) await this.db.clearPreferredProductSuppliers(businessId, current.productId, id);
      const next = await this.db.updateProductSupplier(id, businessId, {
        ...(input.supplierSku !== undefined ? { supplierSku: input.supplierSku?.trim() || null } : {}),
        ...(input.unitCostMinor !== undefined ? { unitCostMinor: input.unitCostMinor } : {}),
        ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
        ...(input.isPreferred !== undefined ? { isPreferred: input.isPreferred } : {}),
      });
      if (!next) throw new Error("NOT_FOUND");
      await this.db.appendAudit({ businessId, actorId, action: "product_supplier.update", entityType: "ProductSupplier", entityId: id, requestId, before: snapshot(current), after: snapshot(next) });
      return next;
    });
  }

  async deleteProductSupplier(businessId: string, actorId: string, requestId: string, id: string, granted: string[], supplierId?: string): Promise<void> {
    withScope(businessId, {});
    this.requireGrant(granted, SUPPLIER_WRITE);
    const current = await this.db.findProductSupplierById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    if (supplierId !== undefined && current.supplierId !== supplierId) throw new Error("NOT_FOUND");
    const deleted = await this.db.deleteProductSupplier(id, businessId);
    if (!deleted) throw new Error("NOT_FOUND");
    await this.db.appendAudit({ businessId, actorId, action: "product_supplier.remove", entityType: "ProductSupplier", entityId: id, requestId, before: snapshot(current) });
  }
}
