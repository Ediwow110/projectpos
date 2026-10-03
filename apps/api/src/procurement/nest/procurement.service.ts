import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbBranch,
  DbPort,
  DbProduct,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbSupplier,
} from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import {
  assertPurchaseOrderTransition,
  computePurchaseOrderTotals,
} from "../purchase-order-math";
import { normalizeSupplierCode, normalizeSupplierPayload, parseExpectedDate, parsePurchaseOrderFilterDate } from "../normalize";

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
}

export interface PurchaseOrderPage {
  items: PurchaseOrderWithLines[];
  total: number;
  page: number;
  pageSize: number;
}

const SUPPLIER_WRITE = "supplier.write";
const PO_WRITE = "purchase_order.write";
const PO_ORDER = "purchase_order.order";
const PO_CANCEL = "purchase_order.cancel";

function snapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

@Injectable()
export class ProcurementService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private requireGrant(granted: string[], permission: string): void {
    if (!granted.includes(permission)) throw new Error("FORBIDDEN");
  }

  private async requireSupplier(businessId: string, supplierId: string): Promise<DbSupplier> {
    const supplier = await this.db.findSupplierById(supplierId, businessId);
    if (!supplier) throw new Error("NOT_FOUND");
    return supplier;
  }

  private async requireProduct(businessId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId);
    if (!product) throw new Error("NOT_FOUND");
    return product;
  }

  private async requireBranch(businessId: string, branchId: string | null): Promise<DbBranch | null> {
    if (branchId === null) return null;
    const branch = await this.db.findBranchById(branchId, businessId);
    if (!branch || !branch.isActive) throw new Error("VALIDATION");
    return branch;
  }

  private async embed(order: DbPurchaseOrder): Promise<PurchaseOrderWithLines> {
    return { ...order, lines: await this.db.listPurchaseOrderLines(order.id, order.businessId) };
  }

  private async requireOrder(businessId: string, id: string): Promise<DbPurchaseOrder> {
    const order = await this.db.findPurchaseOrderById(id, businessId);
    if (!order) throw new Error("NOT_FOUND");
    return order;
  }

  private async assertSupplierCodeAvailable(businessId: string, code: string | null, ignoreId?: string): Promise<void> {
    if (!code) return;
    const duplicate = (await this.db.listSuppliersByBusiness(businessId)).find(
      (supplier) => supplier.id !== ignoreId && supplier.code?.toUpperCase() === code,
    );
    if (duplicate) throw new Error("SUPPLIER_CODE_DUPLICATE");
  }

  private async resolveOrderLines(
    businessId: string,
    supplierId: string,
    input: PurchaseOrderLineInput[],
  ): Promise<DbPurchaseOrderLine[]> {
    const mappings = await this.db.listProductSuppliersByBusiness(businessId);
    const lines: DbPurchaseOrderLine[] = [];
    const seen = new Set<string>();
    for (let position = 0; position < input.length; position += 1) {
      const item = input[position]!;
      if (seen.has(item.productId)) throw new Error("VALIDATION");
      seen.add(item.productId);
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error("VALIDATION");
      if (item.unitCostMinor !== undefined && (!Number.isInteger(item.unitCostMinor) || item.unitCostMinor < 0)) {
        throw new Error("VALIDATION");
      }
      const product = await this.requireProduct(businessId, item.productId);
      const mapping = mappings.find((row) => row.productId === product.id && row.supplierId === supplierId);
      const unitCostMinor = item.unitCostMinor ?? mapping?.unitCostMinor ?? product.costMinor ?? 0;
      const lineTotalMinor = item.quantity * unitCostMinor;
      if (!Number.isSafeInteger(lineTotalMinor)) throw new Error("VALIDATION");
      lines.push({
        id: "",
        businessId,
        purchaseOrderId: "",
        productId: product.id,
        position,
        supplierSkuSnapshot: mapping?.supplierSku ?? null,
        productNameSnapshot: product.name,
        quantity: item.quantity,
        unitCostMinor,
        lineTotalMinor,
        notes: item.notes?.trim() || null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    }
    return lines;
  }

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

  async listPurchaseOrders(businessId: string, opts: { q?: string; supplierId?: string; status: string; branchId?: string; dateFrom?: string; dateTo?: string; page: number; pageSize: number }): Promise<PurchaseOrderPage> {
    withScope(businessId, {});
    const q = opts.q?.trim().toLowerCase();
    const from = opts.dateFrom ? parsePurchaseOrderFilterDate(opts.dateFrom) : null;
    const to = opts.dateTo ? parsePurchaseOrderFilterDate(opts.dateTo) : null;
    const rows = (await this.db.listPurchaseOrdersByBusiness(businessId))
      .filter((order) => opts.status === "all" || order.status === opts.status)
      .filter((order) => !opts.supplierId || order.supplierId === opts.supplierId)
      .filter((order) => opts.branchId === undefined || order.branchId === opts.branchId)
      .filter((order) => !q || order.poNumber.toLowerCase().includes(q))
      .filter((order) => !from || (order.expectedDate?.getTime() ?? 0) >= from.getTime())
      .filter((order) => !to || (order.expectedDate?.getTime() ?? Number.MAX_SAFE_INTEGER) <= to.getTime())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const total = rows.length;
    const start = (opts.page - 1) * opts.pageSize;
    return { items: await Promise.all(rows.slice(start, start + opts.pageSize).map((order) => this.embed(order))), total, page: opts.page, pageSize: opts.pageSize };
  }

  async getPurchaseOrder(businessId: string, id: string): Promise<PurchaseOrderWithLines> {
    withScope(businessId, {});
    return this.embed(await this.requireOrder(businessId, id));
  }

  async createPurchaseOrder(businessId: string, actorId: string, requestId: string, key: string, input: PurchaseOrderInput, granted: string[]): Promise<{ purchaseOrder: PurchaseOrderWithLines; replayed: boolean }> {
    withScope(businessId, {});
    this.requireGrant(granted, PO_WRITE);
    const fingerprint = fingerprintPayload(input);
    return this.db.withLock(`purchase-order:${businessId}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "purchase_order.create");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { purchaseOrder: await this.getPurchaseOrder(businessId, existing.resultId), replayed: true };
      }
      const supplier = await this.requireSupplier(businessId, input.supplierId);
      if (!supplier.isActive) throw new Error("SUPPLIER_INACTIVE");
      const branchId = input.branchId ?? null;
      await this.requireBranch(businessId, branchId);
      const expectedDate = parseExpectedDate(input.expectedDate);
      const lines = await this.resolveOrderLines(businessId, supplier.id, input.lines);
      const totals = computePurchaseOrderTotals(lines);
      const poNumber = await this.db.withLock(`po-number:${businessId}`, () => this.db.nextPoNo(businessId));
      const order = await this.db.createPurchaseOrder({
        businessId, supplierId: supplier.id, branchId, poNumber, status: "DRAFT", expectedDate,
        notes: input.notes?.trim() || null, ...totals, createdBy: actorId, orderedBy: null, orderedAt: null,
        cancelledBy: null, cancelledAt: null, cancelReason: null,
      });
      for (const line of lines) {
        const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...lineInput } = line;
        void _id; void _createdAt; void _updatedAt;
        await this.db.createPurchaseOrderLine({ ...lineInput, purchaseOrderId: order.id });
      }
      await this.db.claimIdempotency({ businessId, key, commandType: "purchase_order.create", fingerprint, resultId: order.id });
      await this.db.appendAudit({ businessId, actorId, action: "purchase_order.create", entityType: "PurchaseOrder", entityId: order.id, requestId, after: snapshot(await this.embed(order)) });
      return { purchaseOrder: await this.embed(order), replayed: false };
    });
  }

  async updatePurchaseOrder(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, patch: Partial<PurchaseOrderInput>, granted: string[]): Promise<PurchaseOrderWithLines> {
    withScope(businessId, {});
    this.requireGrant(granted, PO_WRITE);
    return this.db.withLock(`purchase-order:${businessId}:${id}`, async () => {
      const current = await this.requireOrder(businessId, id);
      if (current.status !== "DRAFT") throw new Error("PURCHASE_ORDER_INVALID_STATE");
      if (current.version !== expectedVersion) throw new Error("STALE_VERSION");
      const supplierId = patch.supplierId ?? current.supplierId;
      const supplier = await this.requireSupplier(businessId, supplierId);
      if (patch.supplierId !== undefined && !supplier.isActive) throw new Error("SUPPLIER_INACTIVE");
      const branchId = patch.branchId !== undefined ? patch.branchId : current.branchId;
      await this.requireBranch(businessId, branchId ?? null);
      const expectedDate = patch.expectedDate !== undefined ? parseExpectedDate(patch.expectedDate) : current.expectedDate;
      const lines = patch.lines !== undefined ? await this.resolveOrderLines(businessId, supplierId, patch.lines) : await this.db.listPurchaseOrderLines(id, businessId);
      const totals = computePurchaseOrderTotals(lines);
      const next = await this.db.updatePurchaseOrder(id, businessId, {
        ...(patch.supplierId !== undefined ? { supplierId } : {}),
        ...(patch.branchId !== undefined ? { branchId: branchId ?? null } : {}),
        ...(patch.expectedDate !== undefined ? { expectedDate } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
        ...totals,
      }, expectedVersion);
      if (!next) throw new Error("STALE_VERSION");
      if (patch.lines !== undefined) {
        await this.db.deletePurchaseOrderLines(id, businessId);
        for (const line of lines) {
          const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...lineInput } = line;
          void _id; void _createdAt; void _updatedAt;
          await this.db.createPurchaseOrderLine({ ...lineInput, purchaseOrderId: id });
        }
      }
      const embedded = await this.embed(next);
      await this.db.appendAudit({ businessId, actorId, action: "purchase_order.update", entityType: "PurchaseOrder", entityId: id, requestId, before: snapshot(await this.embed(current)), after: snapshot(embedded) });
      return embedded;
    });
  }

  async orderPurchaseOrder(businessId: string, actorId: string, requestId: string, id: string, key: string, expectedVersion: number, granted: string[]): Promise<{ purchaseOrder: PurchaseOrderWithLines; replayed: boolean }> {
    withScope(businessId, {});
    this.requireGrant(granted, PO_ORDER);
    const fingerprint = fingerprintPayload({ purchaseOrderId: id });
    return this.db.withLock(`purchase-order:${businessId}:${id}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "purchase_order.order");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { purchaseOrder: await this.getPurchaseOrder(businessId, existing.resultId), replayed: true };
      }
      const current = await this.requireOrder(businessId, id);
      assertPurchaseOrderTransition(current.status, "ORDERED");
      if (current.version !== expectedVersion) throw new Error("STALE_VERSION");
      const supplier = await this.requireSupplier(businessId, current.supplierId);
      if (!supplier.isActive) throw new Error("SUPPLIER_INACTIVE");
      const lines = await this.db.listPurchaseOrderLines(id, businessId);
      if (lines.length === 0) throw new Error("VALIDATION");
      const next = await this.db.updatePurchaseOrder(id, businessId, { status: "ORDERED", orderedBy: actorId, orderedAt: new Date() }, expectedVersion);
      if (!next) throw new Error("STALE_VERSION");
      await this.db.claimIdempotency({ businessId, key, commandType: "purchase_order.order", fingerprint, resultId: id });
      await this.db.appendAudit({ businessId, actorId, action: "purchase_order.ordered", entityType: "PurchaseOrder", entityId: id, requestId, before: snapshot(current), after: snapshot(next) });
      return { purchaseOrder: await this.embed(next), replayed: false };
    });
  }

  async cancelPurchaseOrder(businessId: string, actorId: string, requestId: string, id: string, key: string, reason: string, expectedVersion: number, granted: string[]): Promise<{ purchaseOrder: PurchaseOrderWithLines; replayed: boolean }> {
    withScope(businessId, {});
    this.requireGrant(granted, PO_CANCEL);
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) throw new Error("VALIDATION");
    const fingerprint = fingerprintPayload({ purchaseOrderId: id, reason: cleanReason });
    return this.db.withLock(`purchase-order:${businessId}:${id}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "purchase_order.cancel");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        return { purchaseOrder: await this.getPurchaseOrder(businessId, existing.resultId), replayed: true };
      }
      const current = await this.requireOrder(businessId, id);
      assertPurchaseOrderTransition(current.status, "CANCELLED");
      if (current.version !== expectedVersion) throw new Error("STALE_VERSION");
      const next = await this.db.updatePurchaseOrder(id, businessId, { status: "CANCELLED", cancelledBy: actorId, cancelledAt: new Date(), cancelReason: cleanReason }, expectedVersion);
      if (!next) throw new Error("STALE_VERSION");
      await this.db.claimIdempotency({ businessId, key, commandType: "purchase_order.cancel", fingerprint, resultId: id });
      await this.db.appendAudit({ businessId, actorId, action: "purchase_order.cancelled", entityType: "PurchaseOrder", entityId: id, requestId, reason: cleanReason, before: snapshot(current), after: snapshot(next) });
      return { purchaseOrder: await this.embed(next), replayed: false };
    });
  }

  async listPurchaseOrderEvents(businessId: string, id: string) {
    await this.requireOrder(businessId, id);
    return this.db.listAuditFor(businessId, "PurchaseOrder", id);
  }
}
