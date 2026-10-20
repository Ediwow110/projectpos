import { Inject, Injectable } from "@nestjs/common";
import type { DbPort, DbStockException } from "../../common/db.port";
import { withInventoryLocks } from "../inventory-locks";
import { InventoryAvailabilityService } from "../availability-service";

export interface StockExceptionInput {
  productId: string;
  branchId?: string | null;
  kind: "DAMAGE" | "EXPIRY";
  quantity: number;
  expiresOn?: string | null;
  reason: string;
}

export interface StockExceptionScope {
  activeBranchId?: string | null;
  allowedBranchIds?: string[] | null;
}

function inScope(row: { branchId: string | null }, scope: StockExceptionScope): boolean {
  if (scope.allowedBranchIds != null) return Boolean(row.branchId && row.branchId === scope.activeBranchId && scope.allowedBranchIds.includes(row.branchId));
  return !scope.activeBranchId || row.branchId === scope.activeBranchId;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class StockExceptionService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  async list(businessId: string, scope: StockExceptionScope): Promise<DbStockException[]> {
    const rows = await this.db.listStockExceptions(businessId);
    return rows.filter((row) => inScope(row, scope)).sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }

  async report(
    businessId: string, actorId: string, requestId: string, key: string,
    input: StockExceptionInput, granted: string[], scope: StockExceptionScope,
  ): Promise<{ row: DbStockException; replayed: boolean }> {
    if (!granted.includes("inventory.adjust")) throw new Error("FORBIDDEN");
    if (!key || key.length > 128 || !input || typeof input.productId !== "string" ||
      !["DAMAGE", "EXPIRY"].includes(input.kind) ||
      !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 1_000_000 ||
      typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 300 ||
      (input.kind === "EXPIRY" && (!input.expiresOn || !validIsoDate(input.expiresOn))) ||
      (input.expiresOn != null && !validIsoDate(input.expiresOn))) throw new Error("VALIDATION");
    const branchId = input.branchId ?? scope.activeBranchId ?? null;
    if (!inScope({ branchId }, scope)) throw new Error("FORBIDDEN");
    const product = await this.db.findProductById(input.productId, businessId);
    if (!product) throw new Error("NOT_FOUND");
    if (!product.isActive || !product.trackInventory || product.productType === "BUNDLE") throw new Error("PRODUCT_NOT_TRACKED");
    if (branchId !== null) {
      const branch = await this.db.findBranchById(branchId, businessId);
      if (!branch?.isActive) throw new Error("VALIDATION");
    }
    return this.db.withLock(`stock-exception-report:${businessId}:${key}`, async () => {
      const prior = await this.db.findStockExceptionByKey(businessId, key);
      if (prior) {
        if (prior.reportedBy !== actorId || prior.productId !== input.productId || prior.branchId !== branchId ||
          prior.kind !== input.kind || prior.quantity !== input.quantity || prior.expiresOn !== (input.expiresOn ?? null) ||
          prior.reason !== input.reason.trim()) throw new Error("IDEMPOTENCY_MISMATCH");
        return { row: prior, replayed: true };
      }
      return this.db.withTransaction(async (tx) => {
        const row = await tx.createStockException({
          businessId, productId: input.productId, branchId, kind: input.kind,
          quantity: input.quantity, expiresOn: input.expiresOn ?? null, reason: input.reason.trim(),
          status: "OPEN", reportKey: key, reportedBy: actorId,
          disposedBy: null, disposedAt: null, movementId: null,
        });
        await tx.appendAudit({
          businessId, actorId, requestId, action: "stock_exception.report",
          entityType: "StockException", entityId: row.id,
          after: { productId: row.productId, branchId, kind: row.kind, quantity: row.quantity, expiresOn: row.expiresOn },
        });
        return { row, replayed: false };
      });
    });
  }

  async dispose(
    businessId: string, actorId: string, requestId: string, id: string,
    granted: string[], scope: StockExceptionScope,
  ): Promise<{ row: DbStockException; replayed: boolean }> {
    if (!granted.includes("inventory.adjust")) throw new Error("FORBIDDEN");
    const entry = await this.db.findStockExceptionById(id, businessId);
    if (!entry) throw new Error("NOT_FOUND");
    if (!inScope(entry, scope)) throw new Error("FORBIDDEN");
    return this.db.withLock(`sales:${businessId}`, () =>
      withInventoryLocks(this.db, businessId, [{ productId: entry.productId, branchId: entry.branchId }], async () =>
        this.db.withTransaction(async (tx) => {
          const current = await tx.findStockExceptionById(id, businessId);
          if (!current) throw new Error("NOT_FOUND");
          if (!inScope(current, scope)) throw new Error("FORBIDDEN");
          if (current.status === "DISPOSED") return { row: current, replayed: true };
          const product = await tx.findProductById(current.productId, businessId);
          if (!product?.trackInventory || product.productType === "BUNDLE") throw new Error("PRODUCT_NOT_TRACKED");
          const balance = await tx.findBalance(current.productId, businessId, current.branchId);
          if ((balance?.qtyOnHand ?? 0) < current.quantity) throw new Error("INSUFFICIENT_STOCK");
          await new InventoryAvailabilityService(tx).assertReservationsPreserved(
            businessId, current.branchId, [{ productId: current.productId, qty: current.quantity }],
          );
          const movement = await tx.createMovement({
            businessId, productId: current.productId, branchId: current.branchId,
            type: "damage", qtyDelta: -current.quantity,
            reason: `${current.kind.toLowerCase()} disposal: ${current.reason}`,
            referenceType: "StockException", referenceId: id, actorId, requestId,
          });
          await tx.upsertBalance({
            businessId, productId: current.productId, branchId: current.branchId,
            qtyOnHand: (balance?.qtyOnHand ?? 0) - current.quantity,
          });
          const row = await tx.disposeStockException(id, businessId, actorId, movement.id);
          if (!row) throw new Error("INVALID_STATE");
          await tx.appendAudit({
            businessId, actorId, requestId, action: "stock_exception.dispose",
            entityType: "StockException", entityId: id,
            before: { status: "OPEN" },
            after: { status: "DISPOSED", movementId: movement.id, quantity: current.quantity, branchId: current.branchId },
          });
          return { row, replayed: false };
        }),
      ));
  }
}
