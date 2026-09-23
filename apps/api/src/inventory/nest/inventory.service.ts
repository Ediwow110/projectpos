import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbBalance, DbMovement, DbPort, DbProduct } from "../../common/db.port";
import { validateQtyDelta, type MovementType } from "../signs";
import {
  applyMovementToBalance,
  computeBalanceFromLedger,
  deriveStockStatus,
  type StockStatus,
} from "../projection";

export interface MovementInput {
  productId: string;
  type: MovementType;
  qtyDelta: number;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
}

export interface BalanceRow {
  productId: string;
  productName: string;
  qtyOnHand: number;
  reorderLevel: number;
  trackInventory: boolean;
  status: StockStatus;
}

export interface BalancesPage {
  items: BalanceRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MovementPage {
  items: DbMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DriftRow {
  productId: string;
  balanceOnHand: number;
  ledgerSum: number;
  drift: number;
}

@Injectable()
export class InventoryService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private readonly locks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  private async requireProduct(businessId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId);
    if (!product) throw new Error("NOT_FOUND");
    return product;
  }

  async recordMovement(
    businessId: string,
    actorId: string,
    requestId: string,
    input: MovementInput,
  ): Promise<DbMovement> {
    return this.withLock(`${businessId}:${input.productId}`, async () => {
    withScope(businessId, {});
    const product = await this.requireProduct(businessId, input.productId);
    if (!product.trackInventory && input.type !== "adjustment" && input.type !== "stock_count") {
      throw new Error("PRODUCT_NOT_TRACKED");
    }
    validateQtyDelta(input.type, input.qtyDelta);
    if (
      (input.type === "damage" || input.type === "adjustment") &&
      (!input.reason || input.reason.trim().length < 3)
    ) {
      throw new Error("VALIDATION");
    }
    const current = await this.db.findBalance(input.productId, businessId);
    const onHand = current?.qtyOnHand ?? 0;
    const next = applyMovementToBalance(onHand, { qtyDelta: input.qtyDelta });
    const preventOversell = (product as DbProduct & { preventOversell?: boolean }).preventOversell ?? true;
    if (preventOversell && next < 0) throw new Error("INSUFFICIENT_STOCK");
    const movement = await this.db.createMovement({
      businessId,
      productId: input.productId,
      type: input.type,
      qtyDelta: input.qtyDelta,
      reason: input.reason?.trim() ? input.reason.trim() : null,
      referenceType: input.referenceType?.trim() ? input.referenceType.trim() : null,
      referenceId: input.referenceId ?? null,
      actorId,
      requestId,
    });
    await this.db.upsertBalance({ businessId, productId: input.productId, qtyOnHand: next });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "inventory.adjust",
      entityType: "InventoryMovement",
      entityId: movement.id,
      requestId,
    });
    return movement;
    });
  }

  async getBalances(
    businessId: string,
    opts: { page: number; pageSize: number; view: "all" | "low" | "out" },
  ): Promise<BalancesPage> {
    withScope(businessId, {});
    const [balances, products] = await Promise.all([
      this.db.listBalances(businessId),
      this.db.listProducts(businessId),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    let rows: BalanceRow[] = balances
      .map((b: DbBalance): BalanceRow | null => {
        const p = byId.get(b.productId);
        if (!p) return null;
        return {
          productId: b.productId,
          productName: p.name,
          qtyOnHand: b.qtyOnHand,
          reorderLevel: p.reorderLevel,
          trackInventory: p.trackInventory,
          status: deriveStockStatus({
            qtyOnHand: b.qtyOnHand,
            reorderLevel: p.reorderLevel,
            trackInventory: p.trackInventory,
          }),
        };
      })
      .filter((r): r is BalanceRow => r !== null);
    if (opts.view === "low") rows = rows.filter((r) => r.status === "low" || r.status === "out");
    if (opts.view === "out") rows = rows.filter((r) => r.status === "out");
    rows = [...rows].sort((a, b) => a.productName.localeCompare(b.productName));
    const total = rows.length;
    const start = (opts.page - 1) * opts.pageSize;
    return { items: rows.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
  }

  async getMovementHistory(
    businessId: string,
    productId: string,
    opts: { page: number; pageSize: number },
  ): Promise<MovementPage> {
    withScope(businessId, {});
    await this.requireProduct(businessId, productId);
    const all = await this.db.listMovements(productId, businessId);
    const sorted = [...all].sort((a, b) => (a.id < b.id ? 1 : -1));
    const total = sorted.length;
    const start = (opts.page - 1) * opts.pageSize;
    return { items: sorted.slice(start, start + opts.pageSize), total, page: opts.page, pageSize: opts.pageSize };
  }

  async rebuild(
    businessId: string,
    actorId: string,
    requestId: string,
  ): Promise<{ checked: number; drifts: DriftRow[] }> {
    withScope(businessId, {});
    const [movements, balances] = await Promise.all([
      this.db.listMovementsByBusiness(businessId),
      this.db.listBalances(businessId),
    ]);
    const sums = new Map<string, number>();
    for (const m of movements) {
      sums.set(m.productId, (sums.get(m.productId) ?? 0) + m.qtyDelta);
    }
    const balanceByProduct = new Map(balances.map((b) => [b.productId, b.qtyOnHand]));
    const productIds = new Set<string>([...sums.keys(), ...balanceByProduct.keys()]);
    const drifts: DriftRow[] = [];
    for (const productId of productIds) {
      const ledgerSum = sums.get(productId) ?? 0;
      const balanceOnHand = balanceByProduct.get(productId) ?? 0;
      const drift = balanceOnHand - ledgerSum;
      if (drift !== 0) drifts.push({ productId, balanceOnHand, ledgerSum, drift });
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "inventory.rebuild",
      entityType: "InventoryBalance",
      entityId: `${drifts.length}`,
      requestId,
    });
    return { checked: productIds.size, drifts };
  }
}

export { computeBalanceFromLedger };
