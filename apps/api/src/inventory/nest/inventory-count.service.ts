import { Inject, Injectable, Optional } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbBranch, DbInventoryCount, DbInventoryCountLine, DbPort, DbProduct } from "../../common/db.port";
import { fingerprintPayload } from "../../sales/idempotency";
import { withInventoryLocks } from "../inventory-locks";
import type { AppliedManagerApproval } from "../../auth/nest/manager-approval-policy.service";
import type { InventoryCountCreateInput, InventoryCountLineUpdateInput, ReplenishmentDraftPoInput } from "@pos/validation";
import { ProcurementService } from "../../procurement/nest/procurement.service";
import { InventoryAvailabilityService } from "../availability-service";

export interface InventoryCountView extends DbInventoryCount { lines: DbInventoryCountLine[]; }

export interface CountListPage { items: InventoryCountView[]; total: number; page: number; pageSize: number; }

export interface ReplenishmentRecommendation {
  productId: string;
  productName: string;
  sku: string | null;
  branchId: string | null;
  onHand: number;
  onOrderQty: number;
  effectiveQty: number;
  reorderLevel: number;
  targetQty: number;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
  unitCostMinor: number;
  leadTimeDays: number | null;
  balanceUpdatedAt: Date | null;
}

function snapshot(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }

function now(): Date { return new Date(); }

@Injectable()
export class InventoryCountService {
  constructor(@Inject("DbPort") private readonly db: DbPort, @Optional() @Inject(ProcurementService) private readonly procurement?: ProcurementService) {}

  private requireCountPermission(granted: string[]): void { if (!granted.includes("inventory.adjust")) throw new Error("FORBIDDEN"); }

  private async requireBranch(businessId: string, branchId: string | null): Promise<DbBranch | null> {
    if (branchId === null) return null;
    const branch = await this.db.findBranchById(branchId, businessId);
    if (!branch || !branch.isActive) throw new Error("VALIDATION");
    return branch;
  }

  private async requireCount(businessId: string, id: string): Promise<DbInventoryCount> {
    const row = await this.db.findInventoryCountById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  private async embed(count: DbInventoryCount): Promise<InventoryCountView> {
    return { ...count, lines: await this.db.listInventoryCountLines(count.id, count.businessId) };
  }

  private countFingerprint(count: DbInventoryCount, lines: DbInventoryCountLine[]): string {
    return fingerprintPayload({
      countId: count.id,
      version: count.version,
      branchId: count.branchId,
      lines: lines.map((line) => ({
        productId: line.productId,
        expectedQtySnapshot: line.expectedQtySnapshot,
        countedQty: line.countedQty,
        varianceQty: line.varianceQty,
      })).sort((a, b) => a.productId.localeCompare(b.productId)),
    });
  }

  async getApprovalFingerprint(businessId: string, countId: string): Promise<string> {
    const count = await this.requireCount(businessId, countId);
    return this.countFingerprint(count, await this.db.listInventoryCountLines(count.id, businessId));
  }

  async createCount(businessId: string, actorId: string, requestId: string, input: InventoryCountCreateInput, _granted: string[]): Promise<InventoryCountView> {
    withScope(businessId, {});
    const branchId = input.branchId ?? null;
    await this.requireBranch(businessId, branchId);
    return this.db.withLock(`inventory-count:${businessId}`, async () => {
      const products = await this.db.listProducts(businessId);
      const productIds = input.scopeType === "FULL" ? products.filter((p) => p.isActive && p.trackInventory).map((p) => p.id) : (input.productIds ?? []);
      if (productIds.length === 0) throw new Error("VALIDATION");
      const selected: DbProduct[] = [];
      for (const productId of productIds) {
        const product = products.find((candidate) => candidate.id === productId) ?? await this.db.findProductById(productId, businessId);
        if (!product || !product.isActive || !product.trackInventory) throw new Error("VALIDATION");
        selected.push(product);
      }
      const count = await this.db.createInventoryCount({
        businessId, branchId, countNumber: await this.db.nextInventoryCountNo(businessId), status: "DRAFT",
        scopeType: input.scopeType, name: input.name, notes: input.notes?.trim() || null, createdBy: actorId,
        startedAt: null, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null,
        approvalFingerprint: null, postedBy: null, postedAt: null, cancelledBy: null, cancelledAt: null, version: 1,
      });
      for (const product of selected) {
        await this.db.createInventoryCountLine({
          businessId, inventoryCountId: count.id, productId: product.id, expectedQtySnapshot: 0,
          balanceUpdatedAtSnapshot: null, countedQty: null, varianceQty: null,
          productNameSnapshot: product.name, skuSnapshot: product.sku, notes: null, countedBy: null, countedAt: null,
        });
      }
      await this.db.appendAudit({ businessId, actorId, action: "inventory_count.created", entityType: "InventoryCount", entityId: count.id, requestId, after: snapshot(count) });
      return this.embed(count);
    });
  }

  async listCounts(businessId: string, opts: { status: string; branchId?: string; page: number; pageSize: number }): Promise<CountListPage> {
    withScope(businessId, {});
    const rows = (await this.db.listInventoryCountsByBusiness(businessId))
      .filter((row) => opts.status === "all" || row.status === opts.status)
      .filter((row) => opts.branchId === undefined || row.branchId === opts.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const start = (opts.page - 1) * opts.pageSize;
    return { items: await Promise.all(rows.slice(start, start + opts.pageSize).map((row) => this.embed(row))), total: rows.length, page: opts.page, pageSize: opts.pageSize };
  }

  async getCount(businessId: string, id: string): Promise<InventoryCountView> { withScope(businessId, {}); return this.embed(await this.requireCount(businessId, id)); }

  private async verifyFreshness(businessId: string, count: DbInventoryCount, lines: DbInventoryCountLine[]): Promise<void> {
    for (const line of lines) {
      const balance = await this.db.findBalance(line.productId, businessId, count.branchId);
      const currentAt = balance?.updatedAt ?? null;
      const snapshotAt = line.balanceUpdatedAtSnapshot ?? null;
      if ((currentAt?.getTime() ?? null) !== (snapshotAt?.getTime() ?? null)) throw new Error("COUNT_STALE");
    }
  }

  async startCount(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, _granted: string[]): Promise<InventoryCountView> {
    return this.db.withLock(`inventory-count:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (count.status !== "DRAFT") throw new Error("INVALID_STATE");
      const lines = await this.db.listInventoryCountLines(id, businessId);
      for (const line of lines) {
        const balance = await this.db.findBalance(line.productId, businessId, count.branchId);
        await this.db.updateInventoryCountLine(line.id, businessId, {
          expectedQtySnapshot: balance?.qtyOnHand ?? 0,
          balanceUpdatedAtSnapshot: balance?.updatedAt ?? null,
          countedQty: null, varianceQty: null, countedBy: null, countedAt: null,
        });
      }
      const next = await this.db.updateInventoryCount(id, businessId, { status: "COUNTING", startedAt: now(), approvalFingerprint: null }, expectedVersion);
      if (!next) throw new Error("CONFLICT");
      await this.db.appendAudit({ businessId, actorId, action: "inventory_count.started", entityType: "InventoryCount", entityId: id, requestId, after: snapshot(next) });
      return this.embed(next);
    });
  }

  async updateLines(businessId: string, actorId: string, requestId: string, id: string, input: InventoryCountLineUpdateInput, _granted: string[]): Promise<InventoryCountView> {
    return this.db.withLock(`inventory-count:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (count.status !== "COUNTING") throw new Error("INVALID_STATE");
      const lines = await this.db.listInventoryCountLines(id, businessId);
      for (const item of input.lines) {
        const line = lines.find((candidate) => candidate.id === item.lineId);
        if (!line) throw new Error("NOT_FOUND");
        const countedQty = item.countedQty;
        await this.db.updateInventoryCountLine(line.id, businessId, {
          countedQty, varianceQty: countedQty === null ? null : countedQty - line.expectedQtySnapshot,
          notes: item.notes?.trim() || line.notes, countedBy: countedQty === null ? null : actorId, countedAt: countedQty === null ? null : now(),
        });
      }
      const next = await this.db.updateInventoryCount(id, businessId, { approvalFingerprint: null }, input.expectedVersion);
      if (!next) throw new Error("CONFLICT");
      return this.embed(next);
    });
  }

  private async validateSubmission(businessId: string, count: DbInventoryCount, lines: DbInventoryCountLine[]): Promise<void> {
    if (lines.some((line) => line.countedQty === null || line.varianceQty === null)) throw new Error("COUNT_INCOMPLETE");
    await this.verifyFreshness(businessId, count, lines);
  }

  async submitCount(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, _granted: string[]): Promise<InventoryCountView> {
    return this.db.withLock(`inventory-count:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (count.status !== "COUNTING") throw new Error("INVALID_STATE");
      const lines = await this.db.listInventoryCountLines(id, businessId);
      await this.validateSubmission(businessId, count, lines);
      const next = await this.db.updateInventoryCount(id, businessId, { status: "SUBMITTED", submittedBy: actorId, submittedAt: now(), approvalFingerprint: null }, expectedVersion);
      if (!next) throw new Error("CONFLICT");
      await this.db.appendAudit({ businessId, actorId, action: "inventory_count.submitted", entityType: "InventoryCount", entityId: id, requestId, after: snapshot(next) });
      return this.embed(next);
    });
  }

  async approveCount(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, granted: string[], approval?: AppliedManagerApproval): Promise<InventoryCountView> {
    return this.db.withLock(`inventory-count:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (count.status !== "SUBMITTED") throw new Error("INVALID_STATE");
      const lines = await this.db.listInventoryCountLines(id, businessId);
      await this.validateSubmission(businessId, count, lines);
      const fingerprint = this.countFingerprint(count, lines);
      if (lines.some((line) => line.varianceQty !== 0) && !granted.includes("inventory.adjust") && !approval) throw new Error("FORBIDDEN");
      if (lines.some((line) => line.varianceQty !== 0) && approval?.stateFingerprint && approval.stateFingerprint !== fingerprint) throw new Error("APPROVAL_STALE");
      const storedFingerprint = this.countFingerprint({ ...count, version: expectedVersion + 1 }, lines);
      const next = await this.db.updateInventoryCount(id, businessId, { status: "APPROVED", approvedBy: actorId, approvedAt: now(), approvalFingerprint: storedFingerprint }, expectedVersion);
      if (!next) throw new Error("CONFLICT");
      await this.db.appendAudit({ businessId, actorId, action: "inventory_count.approved", entityType: "InventoryCount", entityId: id, requestId, after: snapshot(next) });
      return this.embed(next);
    });
  }

  async postCount(businessId: string, actorId: string, requestId: string, id: string, key: string, expectedVersion: number, granted: string[]): Promise<{ count: InventoryCountView; replayed: boolean; movements: number }> {
    this.requireCountPermission(granted);
    const existing = await this.db.findIdempotency(businessId, key, "inventory_count.post");
    if (existing) {
      if (existing.resultId !== id || existing.fingerprint !== fingerprintPayload({ countId: id, version: expectedVersion })) throw new Error("IDEMPOTENCY_MISMATCH");
      return { count: await this.getCount(businessId, id), replayed: true, movements: 0 };
    }
    return this.db.withLock(`sales:${businessId}`, () => this.db.withLock(`inventory-count-post:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (count.status === "POSTED") throw new Error("IDEMPOTENCY_MISMATCH");
      if (count.status !== "APPROVED") throw new Error("INVALID_STATE");
      const lines = await this.db.listInventoryCountLines(id, businessId);
      await this.validateSubmission(businessId, count, lines);
      const fingerprint = this.countFingerprint(count, lines);
      if (count.approvalFingerprint !== fingerprint) throw new Error("APPROVAL_STALE");
      const targets = lines.map((line) => ({ productId: line.productId, branchId: count.branchId }));
      return withInventoryLocks(this.db, businessId, targets, async () => this.db.withTransaction(async (tx) => {
        const replay = await tx.findIdempotency(businessId, key, "inventory_count.post");
        if (replay) {
          if (replay.resultId !== id || replay.fingerprint !== fingerprintPayload({ countId: id, version: expectedVersion })) throw new Error("IDEMPOTENCY_MISMATCH");
          return { count: await this.getCount(businessId, id), replayed: true, movements: 0 };
        }
        const latest = await tx.findInventoryCountById(id, businessId);
        if (!latest || latest.version !== expectedVersion || latest.status !== "APPROVED") throw new Error("CONFLICT");
        await this.verifyFreshness(businessId, latest, lines);
        const decreases = lines
          .filter((line) => (line.varianceQty ?? 0) < 0)
          .map((line) => ({ productId: line.productId, qty: Math.abs(line.varianceQty ?? 0) }));
        if (decreases.length > 0) {
          await new InventoryAvailabilityService(tx).assertReservationsPreserved(
            businessId,
            latest.branchId,
            decreases,
          );
        }
        let movementCount = 0;
        for (const line of lines) {
          const variance = line.varianceQty ?? 0;
          if (variance === 0) continue;
          const balance = await tx.findBalance(line.productId, businessId, latest.branchId);
          await tx.createMovement({ businessId, productId: line.productId, type: "stock_count", qtyDelta: variance, reason: `Stock count ${latest.countNumber}`, referenceType: "InventoryCount", referenceId: latest.id, actorId, requestId, branchId: latest.branchId });
          await tx.upsertBalance({ businessId, productId: line.productId, branchId: latest.branchId, qtyOnHand: (balance?.qtyOnHand ?? 0) + variance });
          movementCount += 1;
        }
        const posted = await tx.updateInventoryCount(id, businessId, { status: "POSTED", postedBy: actorId, postedAt: now() }, expectedVersion);
        if (!posted) throw new Error("CONFLICT");
        await tx.claimIdempotency({ businessId, key, commandType: "inventory_count.post", fingerprint: fingerprintPayload({ countId: id, version: expectedVersion }), resultId: id });
        await tx.appendAudit({ businessId, actorId, action: "inventory_count.posted", entityType: "InventoryCount", entityId: id, requestId, after: snapshot(posted) });
        return { count: { ...posted, lines: await tx.listInventoryCountLines(id, businessId) }, replayed: false, movements: movementCount };
      }));
    }));
  }

  async cancelCount(businessId: string, actorId: string, requestId: string, id: string, expectedVersion: number, _granted: string[]): Promise<InventoryCountView> {
    return this.db.withLock(`inventory-count:${businessId}:${id}`, async () => {
      const count = await this.requireCount(businessId, id);
      if (["POSTED", "CANCELLED"].includes(count.status)) throw new Error("INVALID_STATE");
      const next = await this.db.updateInventoryCount(id, businessId, { status: "CANCELLED", cancelledBy: actorId, cancelledAt: now(), approvalFingerprint: null }, expectedVersion);
      if (!next) throw new Error("CONFLICT");
      await this.db.appendAudit({ businessId, actorId, action: "inventory_count.cancelled", entityType: "InventoryCount", entityId: id, requestId, after: snapshot(next) });
      return this.embed(next);
    });
  }

  private async outstandingByProduct(businessId: string, branchId: string | null): Promise<Map<string, number>> {
    const outstanding = new Map<string, number>();
    for (const order of await this.db.listPurchaseOrdersByBusiness(businessId)) {
      if (order.branchId !== branchId || !["ORDERED", "PARTIALLY_RECEIVED"].includes(order.status)) continue;
      for (const line of await this.db.listPurchaseOrderLines(order.id, businessId)) {
        const receipts = await this.db.listPurchaseReceiptsByOrder(order.id, businessId);
        let received = 0;
        for (const receipt of receipts) for (const receiptLine of await this.db.listPurchaseReceiptLines(receipt.id, businessId)) if (receiptLine.purchaseOrderLineId === line.id) received += receiptLine.quantityReceived;
        outstanding.set(line.productId, (outstanding.get(line.productId) ?? 0) + Math.max(0, line.quantity - received));
      }
    }
    return outstanding;
  }

  async listReplenishment(businessId: string, branchId: string | null, supplierId?: string): Promise<ReplenishmentRecommendation[]> {
    withScope(businessId, {});
    await this.requireBranch(businessId, branchId);
    const [products, balances, mappings, suppliers, outstanding] = await Promise.all([
      this.db.listProducts(businessId), this.db.listBalances(businessId), this.db.listProductSuppliersByBusiness(businessId), this.db.listSuppliersByBusiness(businessId), this.outstandingByProduct(businessId, branchId),
    ]);
    return products.filter((product) => product.isActive && product.trackInventory).flatMap((product) => {
      const balance = balances.find((row) => row.productId === product.id && (row.branchId ?? null) === branchId);
      const onHand = balance?.qtyOnHand ?? 0;
      const onOrderQty = outstanding.get(product.id) ?? 0;
      const effectiveQty = onHand + onOrderQty;
      if (effectiveQty > product.reorderLevel) return [];
      const mapping = mappings.find((row) => row.productId === product.id && row.isPreferred);
      const supplier = mapping ? suppliers.find((row) => row.id === mapping.supplierId) : undefined;
      if (supplierId && mapping?.supplierId !== supplierId) return [];
      const targetQty = product.reorderLevel * 2;
      return [{ productId: product.id, productName: product.name, sku: product.sku, branchId, onHand, onOrderQty, effectiveQty, reorderLevel: product.reorderLevel, targetQty, suggestedQty: Math.max(0, targetQty - effectiveQty), supplierId: mapping?.supplierId ?? null, supplierName: supplier?.name ?? null, unitCostMinor: mapping?.unitCostMinor ?? product.costMinor, leadTimeDays: mapping?.leadTimeDays ?? null, balanceUpdatedAt: balance?.updatedAt ?? null }];
    }).filter((row) => row.suggestedQty > 0);
  }

  async createDraftPoFromReplenishment(businessId: string, actorId: string, requestId: string, key: string, input: ReplenishmentDraftPoInput, granted: string[]): Promise<unknown> {
    if (!granted.includes("purchase_order.write")) throw new Error("FORBIDDEN");
    const rows = await this.listReplenishment(businessId, input.branchId ?? null, input.supplierId);
    const byProduct = new Map(rows.map((row) => [row.productId, row]));
    const recommendations = input.lines.map((line) => {
      const row = byProduct.get(line.productId);
      if (!row || row.supplierId !== input.supplierId || row.branchId !== (input.branchId ?? null) || line.quantity <= 0 || line.quantity > row.suggestedQty) throw new Error("REPLENISHMENT_STALE");
      return { productId: line.productId, quantity: line.quantity, unitCostMinor: row.unitCostMinor };
    });
    if (!this.procurement) throw new Error("VALIDATION");
    return this.procurement.createPurchaseOrder(businessId, actorId, requestId, key, { supplierId: input.supplierId, branchId: input.branchId ?? null, lines: recommendations }, granted);
  }
}
