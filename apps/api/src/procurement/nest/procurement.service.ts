import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type {
  DbBranch,
  DbPort,
  DbProduct,
  DbProductSupplier,
  DbPurchaseOrder,
  DbPurchaseOrderLine,
  DbPurchaseReceipt,
  DbPurchaseReceiptLine,
  DbSupplier,
  DbSupplierReturn,
  DbSupplierReturnLine,
} from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import {
  assertPurchaseOrderTransition,
  computePurchaseOrderTotals,
} from "../purchase-order-math";
import { normalizeSupplierCode, normalizeSupplierPayload, parseExpectedDate, parsePurchaseOrderFilterDate } from "../normalize";
import { withInventoryLocks } from "../../inventory/inventory-locks";

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
      if (product.productType === "BUNDLE") throw new Error("PRODUCT_NOT_TRACKED");
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
    const order = await this.requireOrder(businessId, id);
    return this.embedFull(order);
  }

  private async embedFull(order: DbPurchaseOrder): Promise<PurchaseOrderWithLines> {
    const [base, receipts, returns] = await Promise.all([
      this.embed(order),
      this.listReceiptDetails(order.id, order.businessId),
      this.listReturnDetails(order.id, order.businessId),
    ]);
    return { ...base, receipts, supplierReturns: returns };
  }

  private async listReceiptDetails(purchaseOrderId: string, businessId: string): Promise<PurchaseReceiptWithLines[]> {
    const receipts = await this.db.listPurchaseReceiptsByOrder(purchaseOrderId, businessId);
    return Promise.all(receipts.map(async (receipt) => ({ receipt, lines: await this.db.listPurchaseReceiptLines(receipt.id, businessId) }))).then((rows) => rows.map(({ receipt, lines }) => ({ ...receipt, lines })));
  }

  private async listReturnDetails(purchaseOrderId: string, businessId: string): Promise<SupplierReturnWithLines[]> {
    const returns = await this.db.listSupplierReturnsByOrder(purchaseOrderId, businessId);
    return Promise.all(returns.map(async (item) => ({ item, lines: await this.db.listSupplierReturnLines(item.id, businessId) }))).then((rows) => rows.map(({ item, lines }) => ({ ...item, lines })));
  }

  private async requireReceipt(businessId: string, id: string): Promise<DbPurchaseReceipt> {
    const row = await this.db.findPurchaseReceiptById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  private async requireSupplierReturn(businessId: string, id: string): Promise<DbSupplierReturn> {
    const row = await this.db.findSupplierReturnById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  private async receivedByLine(businessId: string, orderId: string, db: DbPort = this.db): Promise<Map<string, number>> {
    const receipts = await db.listPurchaseReceiptsByOrder(orderId, businessId);
    const totals = new Map<string, number>();
    for (const receipt of receipts) {
      for (const line of await db.listPurchaseReceiptLines(receipt.id, businessId)) totals.set(line.purchaseOrderLineId, (totals.get(line.purchaseOrderLineId) ?? 0) + line.quantityReceived);
    }
    return totals;
  }

  private async returnedByLine(businessId: string, orderId: string, db: DbPort = this.db): Promise<Map<string, number>> {
    const returns = await db.listSupplierReturnsByOrder(orderId, businessId);
    const totals = new Map<string, number>();
    for (const item of returns) {
      if (item.status !== "POSTED") continue;
      for (const line of await db.listSupplierReturnLines(item.id, businessId)) totals.set(line.purchaseOrderLineId, (totals.get(line.purchaseOrderLineId) ?? 0) + line.quantity);
    }
    return totals;
  }

  private async receiptLines(businessId: string, order: DbPurchaseOrder, input: { branchId?: string | null; lines: Array<{ purchaseOrderLineId: string; quantityReceived: number }>; notes?: string }, db: DbPort = this.db): Promise<Array<{ source: DbPurchaseOrderLine; quantityReceived: number }>> {
    if (input.branchId !== undefined && (input.branchId ?? null) !== order.branchId) throw new Error("VALIDATION");
    if (order.status !== "ORDERED" && order.status !== "PARTIALLY_RECEIVED") throw new Error("PURCHASE_ORDER_INVALID_STATE");
    const lines = await db.listPurchaseOrderLines(order.id, businessId);
    const byId = new Map(lines.map((line) => [line.id, line]));
    const received = await this.receivedByLine(businessId, order.id, db);
    const seen = new Set<string>();
    const resolved: Array<{ source: DbPurchaseOrderLine; quantityReceived: number }> = [];
    for (const item of input.lines) {
      if (seen.has(item.purchaseOrderLineId)) throw new Error("VALIDATION");
      seen.add(item.purchaseOrderLineId);
      const source = byId.get(item.purchaseOrderLineId);
      if (!source || !Number.isInteger(item.quantityReceived) || item.quantityReceived <= 0) throw new Error("VALIDATION");
      const remaining = source.quantity - (received.get(source.id) ?? 0);
      if (item.quantityReceived > remaining) throw new Error("RECEIPT_EXCEEDS_OUTSTANDING");
      resolved.push({ source, quantityReceived: item.quantityReceived });
    }
    if (!resolved.length) throw new Error("VALIDATION");
    return resolved;
  }

  async listPurchaseReceipts(businessId: string, orderId: string): Promise<PurchaseReceiptWithLines[]> {
    await this.requireOrder(businessId, orderId);
    return this.listReceiptDetails(orderId, businessId);
  }

  async getPurchaseReceipt(businessId: string, id: string): Promise<PurchaseReceiptWithLines> {
    const receipt = await this.requireReceipt(businessId, id);
    return { ...receipt, lines: await this.db.listPurchaseReceiptLines(id, businessId) };
  }

  async receivePurchaseOrder(businessId: string, actorId: string, requestId: string, orderId: string, key: string, input: { branchId?: string | null; lines: Array<{ purchaseOrderLineId: string; quantityReceived: number }>; notes?: string }, granted: string[]): Promise<{ purchaseReceipt: PurchaseReceiptWithLines; purchaseOrder: PurchaseOrderWithLines; replayed: boolean }> {
    withScope(businessId, {});
    this.requireGrant(granted, "purchase_order.receive");
    const fingerprint = fingerprintPayload({ purchaseOrderId: orderId, ...input });
    return this.db.withLock(`purchase-order:${businessId}:${orderId}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "purchase_receipt.post");
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH");
        const purchaseReceipt = await this.getPurchaseReceipt(businessId, existing.resultId);
        return { purchaseReceipt, purchaseOrder: await this.getPurchaseOrder(businessId, purchaseReceipt.purchaseOrderId), replayed: true };
      }
      return this.db.withTransaction(async (tx) => {
        const current = await this.requireOrder(businessId, orderId);
        await this.requireBranch(businessId, current.branchId);
        const resolved = await this.receiptLines(businessId, current, input, tx);
        const result = await withInventoryLocks(tx, businessId, resolved.map(({ source }) => ({ productId: source.productId, branchId: current.branchId })), async () => {
          const receiptNumber = await tx.nextPurchaseReceiptNo(businessId);
          const receipt = await tx.createPurchaseReceipt({ businessId, purchaseOrderId: orderId, branchId: current.branchId, receiptNumber, status: "POSTED", receivedBy: actorId, receivedAt: new Date(), notes: input.notes?.trim() || null });
          const createdLines: DbPurchaseReceiptLine[] = [];
          for (const { source, quantityReceived } of resolved) {
            createdLines.push(await tx.createPurchaseReceiptLine({ businessId, purchaseReceiptId: receipt.id, purchaseOrderLineId: source.id, productId: source.productId, quantityReceived, unitCostMinorSnapshot: source.unitCostMinor, productNameSnapshot: source.productNameSnapshot, supplierSkuSnapshot: source.supplierSkuSnapshot }));
            const balance = await tx.findBalance(source.productId, businessId, current.branchId);
            await tx.createMovement({ businessId, productId: source.productId, type: "receive", qtyDelta: quantityReceived, reason: null, referenceType: "PurchaseReceipt", referenceId: receipt.id, actorId, requestId, branchId: current.branchId });
            await tx.upsertBalance({ businessId, productId: source.productId, branchId: current.branchId, qtyOnHand: (balance?.qtyOnHand ?? 0) + quantityReceived });
          }
          const cumulative = await this.receivedByLine(businessId, orderId, tx);
          for (const { source, quantityReceived } of resolved) cumulative.set(source.id, (cumulative.get(source.id) ?? 0) + quantityReceived);
          const allReceived = (await tx.listPurchaseOrderLines(orderId, businessId)).every((line) => (cumulative.get(line.id) ?? 0) >= line.quantity);
          const nextStatus = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
          const next = await tx.updatePurchaseOrder(orderId, businessId, { status: nextStatus }, current.version);
          if (!next) throw new Error("STALE_VERSION");
          await tx.claimIdempotency({ businessId, key, commandType: "purchase_receipt.post", fingerprint, resultId: receipt.id });
          const receiptDetail = { ...receipt, lines: createdLines };
          await tx.appendAudit({ businessId, actorId, action: "purchase_receipt.posted", entityType: "PurchaseReceipt", entityId: receipt.id, requestId, after: snapshot(receiptDetail) });
          await tx.appendAudit({ businessId, actorId, action: allReceived ? "purchase_order.received" : "purchase_order.partially_received", entityType: "PurchaseOrder", entityId: orderId, requestId, before: snapshot(current), after: snapshot(next) });
          return { purchaseReceipt: receiptDetail, purchaseOrder: await this.getPurchaseOrder(businessId, orderId), replayed: false };
        });
        return result;
      });
    });
  }

  async listSupplierReturns(businessId: string): Promise<SupplierReturnWithLines[]> {
    const rows = await this.db.listSupplierReturnsByBusiness(businessId);
    return Promise.all(rows.map(async (item) => ({ ...item, lines: await this.db.listSupplierReturnLines(item.id, businessId) })));
  }

  async getSupplierReturn(businessId: string, id: string): Promise<SupplierReturnWithLines> {
    const item = await this.requireSupplierReturn(businessId, id);
    return { ...item, lines: await this.db.listSupplierReturnLines(id, businessId) };
  }

  private async resolveReturnLines(businessId: string, order: DbPurchaseOrder, input: Array<{ purchaseOrderLineId: string; quantity: number }>, db: DbPort = this.db): Promise<Array<{ source: DbPurchaseOrderLine; quantity: number }>> {
    const received = await this.receivedByLine(businessId, order.id, db);
    const returned = await this.returnedByLine(businessId, order.id, db);
    const byId = new Map((await db.listPurchaseOrderLines(order.id, businessId)).map((line) => [line.id, line]));
    const seen = new Set<string>(); const resolved: Array<{ source: DbPurchaseOrderLine; quantity: number }> = [];
    for (const item of input) {
      if (seen.has(item.purchaseOrderLineId)) throw new Error("VALIDATION"); seen.add(item.purchaseOrderLineId);
      const source = byId.get(item.purchaseOrderLineId); const available = source ? (received.get(source.id) ?? 0) - (returned.get(source.id) ?? 0) : 0;
      if (!source || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > available) throw new Error("RETURN_EXCEEDS_RETURNABLE");
      resolved.push({ source, quantity: item.quantity });
    }
    if (!resolved.length) throw new Error("VALIDATION"); return resolved;
  }

  async createSupplierReturn(businessId: string, actorId: string, requestId: string, key: string, input: { supplierId: string; purchaseOrderId: string; branchId?: string | null; reason: string; lines: Array<{ purchaseOrderLineId: string; quantity: number }> }, granted: string[]): Promise<{ supplierReturn: SupplierReturnWithLines; replayed: boolean }> {
    withScope(businessId, {}); this.requireGrant(granted, "supplier_return.write");
    const fingerprint = fingerprintPayload(input);
    return this.db.withLock(`supplier-return:${businessId}:${input.purchaseOrderId}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "supplier_return.create");
      if (existing) { if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH"); return { supplierReturn: await this.getSupplierReturn(businessId, existing.resultId), replayed: true }; }
      const order = await this.requireOrder(businessId, input.purchaseOrderId); if (order.supplierId !== input.supplierId) throw new Error("NOT_FOUND"); if (input.branchId !== undefined && (input.branchId ?? null) !== order.branchId) throw new Error("VALIDATION");
      if (order.status !== "PARTIALLY_RECEIVED" && order.status !== "RECEIVED") throw new Error("PURCHASE_ORDER_INVALID_STATE");
      const supplier = await this.requireSupplier(businessId, input.supplierId); void supplier;
      await this.requireBranch(businessId, order.branchId);
      const resolved = await this.resolveReturnLines(businessId, order, input.lines);
      const number = await this.db.nextSupplierReturnNo(businessId);
      const item = await this.db.createSupplierReturn({ businessId, supplierId: input.supplierId, purchaseOrderId: order.id, branchId: order.branchId, returnNumber: number, status: "DRAFT", reason: input.reason.trim(), createdBy: actorId, postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 1 });
      const lines = await Promise.all(resolved.map(({ source, quantity }) => this.db.createSupplierReturnLine({ businessId, supplierReturnId: item.id, purchaseOrderLineId: source.id, productId: source.productId, quantity, unitCostMinorSnapshot: source.unitCostMinor, productNameSnapshot: source.productNameSnapshot, supplierSkuSnapshot: source.supplierSkuSnapshot })));
      await this.db.claimIdempotency({ businessId, key, commandType: "supplier_return.create", fingerprint, resultId: item.id });
      const detail = { ...item, lines }; await this.db.appendAudit({ businessId, actorId, action: "supplier_return.created", entityType: "SupplierReturn", entityId: item.id, requestId, after: snapshot(detail) });
      return { supplierReturn: detail, replayed: false };
    });
  }

  async updateSupplierReturn(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, input: { reason?: string; lines?: Array<{ purchaseOrderLineId: string; quantity: number }> }, granted: string[]): Promise<SupplierReturnWithLines> {
    this.requireGrant(granted, "supplier_return.write");
    return this.db.withLock(`supplier-return:${businessId}:${id}`, async () => {
      const current = await this.requireSupplierReturn(businessId, id); if (current.status !== "DRAFT") throw new Error("SUPPLIER_RETURN_INVALID_STATE");
      const order = await this.requireOrder(businessId, current.purchaseOrderId); const lines = input.lines ? await this.resolveReturnLines(businessId, order, input.lines) : null;
      const next = await this.db.updateSupplierReturn(id, businessId, { ...(input.reason !== undefined ? { reason: input.reason.trim() } : {}) }, expectedVersion);
      if (!next) throw new Error("STALE_VERSION");
      if (lines) { await this.db.deleteSupplierReturnLines(id, businessId); for (const { source, quantity } of lines) await this.db.createSupplierReturnLine({ businessId, supplierReturnId: id, purchaseOrderLineId: source.id, productId: source.productId, quantity, unitCostMinorSnapshot: source.unitCostMinor, productNameSnapshot: source.productNameSnapshot, supplierSkuSnapshot: source.supplierSkuSnapshot }); }
      const detail = await this.getSupplierReturn(businessId, id); await this.db.appendAudit({ businessId, actorId, action: "supplier_return.updated", entityType: "SupplierReturn", entityId: id, requestId, before: snapshot(current), after: snapshot(detail) }); return detail;
    });
  }

  async postSupplierReturn(businessId: string, actorId: string, requestId: string, id: string, key: string, expectedVersion: number, granted: string[]): Promise<{ supplierReturn: SupplierReturnWithLines; replayed: boolean }> {
    withScope(businessId, {}); this.requireGrant(granted, "supplier_return.post"); const fingerprint = fingerprintPayload({ supplierReturnId: id, expectedVersion });
    return this.db.withLock(`supplier-return:${businessId}:${id}`, async () => {
      const existing = await this.db.findIdempotency(businessId, key, "supplier_return.post"); if (existing) { if (existing.fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_MISMATCH"); return { supplierReturn: await this.getSupplierReturn(businessId, existing.resultId), replayed: true }; }
      return this.db.withTransaction(async (tx) => {
        const current = await this.requireSupplierReturn(businessId, id); if (current.status !== "DRAFT") throw new Error("SUPPLIER_RETURN_INVALID_STATE");
        const order = await this.requireOrder(businessId, current.purchaseOrderId); await this.requireBranch(businessId, current.branchId); const draftLines = await tx.listSupplierReturnLines(id, businessId); const resolved = await this.resolveReturnLines(businessId, order, draftLines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: line.quantity })), tx);
        return withInventoryLocks(tx, businessId, resolved.map(({ source }) => ({ productId: source.productId, branchId: current.branchId })), async () => {
          for (const { source, quantity } of resolved) { const balance = await tx.findBalance(source.productId, businessId, current.branchId); if ((balance?.qtyOnHand ?? 0) < quantity) throw new Error("INSUFFICIENT_STOCK"); }
          const next = await tx.updateSupplierReturn(id, businessId, { status: "POSTED", postedBy: actorId, postedAt: new Date() }, expectedVersion); if (!next) throw new Error("STALE_VERSION");
          for (const { source, quantity } of resolved) { const balance = await tx.findBalance(source.productId, businessId, current.branchId); await tx.createMovement({ businessId, productId: source.productId, type: "supplier_return", qtyDelta: -quantity, reason: current.reason, referenceType: "SupplierReturn", referenceId: id, actorId, requestId, branchId: current.branchId }); await tx.upsertBalance({ businessId, productId: source.productId, branchId: current.branchId, qtyOnHand: (balance?.qtyOnHand ?? 0) - quantity }); }
          await tx.claimIdempotency({ businessId, key, commandType: "supplier_return.post", fingerprint, resultId: id }); const detail = await this.getSupplierReturn(businessId, id); await tx.appendAudit({ businessId, actorId, action: "supplier_return.posted", entityType: "SupplierReturn", entityId: id, requestId, before: snapshot(current), after: snapshot(detail) }); return { supplierReturn: detail, replayed: false };
        });
      });
    });
  }

  async cancelSupplierReturn(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, granted: string[]): Promise<SupplierReturnWithLines> {
    this.requireGrant(granted, "supplier_return.cancel"); return this.db.withLock(`supplier-return:${businessId}:${id}`, async () => { const current = await this.requireSupplierReturn(businessId, id); if (current.status !== "DRAFT") throw new Error("SUPPLIER_RETURN_INVALID_STATE"); const next = await this.db.updateSupplierReturn(id, businessId, { status: "CANCELLED", cancelledBy: actorId, cancelledAt: new Date() }, expectedVersion); if (!next) throw new Error("STALE_VERSION"); const detail = await this.getSupplierReturn(businessId, id); await this.db.appendAudit({ businessId, actorId, action: "supplier_return.cancelled", entityType: "SupplierReturn", entityId: id, requestId, before: snapshot(current), after: snapshot(detail) }); return detail; });
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
    const order = await this.requireOrder(businessId, id);
    const supplierReturns = await this.listReturnDetails(order.id, businessId);
    const events = await Promise.all([
      this.db.listAuditFor(businessId, "PurchaseOrder", id),
      ...supplierReturns.map((item) => this.db.listAuditFor(businessId, "SupplierReturn", item.id)),
    ]);
    return events.flat().sort((left, right) => (left.at?.getTime() ?? 0) - (right.at?.getTime() ?? 0));
  }
}
