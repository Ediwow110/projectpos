import type { DbPort, DbProduct, DbSaleItem } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import { withInventoryLocks } from "../inventory/inventory-locks";

export class SalesStockService {
  constructor(private readonly db: DbPort) {}

  async requireProduct(businessId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId);
    if (!product || !product.isActive) throw new Error("NOT_FOUND");
    return product;
  }

  async assertAvailable(
    businessId: string,
    items: DbSaleItem[],
    branchId: string | null,
  ): Promise<void> {
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (!product.trackInventory) continue;
      const current = await this.db.findBalance(item.productId, businessId, branchId);
      const onHand = current?.qtyOnHand ?? 0;
      if (onHand - item.qty < 0) {
        incrementMetric("pos_inventory_failures_total");
        throw new Error("INSUFFICIENT_STOCK");
      }
    }
  }

  async applySale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    items: DbSaleItem[],
    branchId: string | null = null,
  ): Promise<void> {
    await withInventoryLocks(
      this.db,
      businessId,
      items.map((item) => ({ productId: item.productId, branchId })),
      async () => {
        await this.assertAvailable(businessId, items, branchId);
        for (const item of items) {
          const product = await this.requireProduct(businessId, item.productId);
          if (!product.trackInventory) continue;
          const current = await this.db.findBalance(item.productId, businessId, branchId);
          const onHand = current?.qtyOnHand ?? 0;
          await this.db.createMovement({
            businessId,
            productId: item.productId,
            type: "sale",
            qtyDelta: -item.qty,
            reason: null,
            referenceType: "Sale",
            referenceId: saleId,
            actorId,
            requestId,
            branchId,
          });
          await this.db.upsertBalance({
            businessId,
            branchId,
            productId: item.productId,
            qtyOnHand: onHand - item.qty,
          });
        }
      },
    );
  }
}
