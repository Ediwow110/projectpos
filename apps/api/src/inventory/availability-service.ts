import type { DbInventoryReservation, DbPort } from "../common/db.port";

export interface StockDecreaseRequirement {
  productId: string;
  qty: number;
}

function aggregate(requirements: StockDecreaseRequirement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of requirements) {
    if (!Number.isInteger(row.qty) || row.qty <= 0) throw new Error("VALIDATION");
    out.set(row.productId, (out.get(row.productId) ?? 0) + row.qty);
  }
  return out;
}

function liveHold(row: DbInventoryReservation, now: Date): boolean {
  return row.status === "HELD" && (row.expiresAt === null || row.expiresAt.getTime() > now.getTime());
}

export class InventoryAvailabilityService {
  constructor(private readonly db: DbPort) {}

  private async heldQty(
    businessId: string,
    branchId: string | null,
    productId: string,
    ownerOrderId?: string,
    now: Date = new Date(),
  ): Promise<number> {
    if (branchId === null) return 0;
    const rows = await this.db.listActiveReservationsByProduct(businessId, branchId, productId);
    return rows
      .filter((row) => liveHold(row, now) && row.orderId !== ownerOrderId)
      .reduce((sum, row) => sum + row.qty, 0);
  }

  async availableToSell(
    businessId: string,
    branchId: string | null,
    productId: string,
    ownerOrderId?: string,
  ): Promise<number> {
    const balance = await this.db.findBalance(productId, businessId, branchId);
    const held = await this.heldQty(businessId, branchId, productId, ownerOrderId);
    return Math.max(0, (balance?.qtyOnHand ?? 0) - held);
  }

  async assertReservationsPreserved(
    businessId: string,
    branchId: string | null,
    requirements: StockDecreaseRequirement[],
    ownerOrderId?: string,
  ): Promise<void> {
    for (const [productId, qty] of aggregate(requirements)) {
      const balance = await this.db.findBalance(productId, businessId, branchId);
      const held = await this.heldQty(businessId, branchId, productId, ownerOrderId);
      if ((balance?.qtyOnHand ?? 0) - qty < held) throw new Error("RESERVATION_CONFLICT");
    }
  }

  async assertDecreaseAllowed(
    businessId: string,
    branchId: string | null,
    requirements: StockDecreaseRequirement[],
    ownerOrderId?: string,
  ): Promise<void> {
    const grouped = aggregate(requirements);
    for (const [productId, qty] of grouped) {
      const balance = await this.db.findBalance(productId, businessId, branchId);
      if ((balance?.qtyOnHand ?? 0) < qty) throw new Error("INSUFFICIENT_STOCK");
    }
    await this.assertReservationsPreserved(
      businessId,
      branchId,
      [...grouped].map(([productId, qty]) => ({ productId, qty })),
      ownerOrderId,
    );
  }
}
