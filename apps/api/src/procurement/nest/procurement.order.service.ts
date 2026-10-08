import { withScope } from "@pos/database";
import type {
  DbPurchaseReceiptLine,
} from "../../common/db.port";

import { fingerprintPayload } from "../../sales/idempotency";
import { assertPurchaseOrderTransition, computePurchaseOrderTotals } from "../purchase-order-math";
import { parseExpectedDate, parsePurchaseOrderFilterDate } from "../normalize";
import { withInventoryLocks } from "../../inventory/inventory-locks";
import type { PurchaseOrderInput, PurchaseOrderPage, PurchaseOrderWithLines, PurchaseReceiptWithLines, SupplierReturnWithLines } from "./procurement.contracts";
import { PO_CANCEL, PO_ORDER, PO_WRITE, snapshot } from "./procurement.contracts";
import { ProcurementSupport } from "./procurement.support";

export class ProcurementOrderService extends ProcurementSupport {
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
