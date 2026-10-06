import type { DbPort, DbProduct, DbSaleItem } from "../common/db.port";
import { incrementMetric } from "../common/metrics";
import { InventoryAvailabilityService } from "../inventory/availability-service";
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
    ownerOrderId?: string,
  ): Promise<void> {
    const requirements = await this.stockRequirements(businessId, items);
    try {
      await new InventoryAvailabilityService(this.db).assertDecreaseAllowed(
        businessId,
        branchId,
        [...requirements].map(([productId, qty]) => ({ productId, qty })),
        ownerOrderId,
      );
    } catch (error) {
      incrementMetric("pos_inventory_failures_total");
      throw error;
    }
  }

  private async stockRequirements(businessId: string, items: DbSaleItem[]): Promise<Map<string, number>> {
    const requirements = new Map<string, number>();
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      if (product.productType === "BUNDLE") {
        // Sale drafts own the historical bundle composition. Never consult the
        // live definition here: it may have changed after the draft was made,
        // while refunds intentionally use these same snapshots.
        const snapshots = await this.db.listSaleItemBundleComponents(item.id, businessId);
        if (snapshots.length === 0) throw new Error("INVALID_BUNDLE_SNAPSHOT");
        for (const component of snapshots) {
          if (!Number.isInteger(component.quantityPerBundleSnapshot) || component.quantityPerBundleSnapshot <= 0) {
            throw new Error("INVALID_BUNDLE_SNAPSHOT");
          }
          requirements.set(component.componentProductId, (requirements.get(component.componentProductId) ?? 0) + item.qty * component.quantityPerBundleSnapshot);
        }
      } else if (product.trackInventory) {
        requirements.set(item.productId, (requirements.get(item.productId) ?? 0) + item.qty);
      }
    }
    return requirements;
  }

  async applySale(
    businessId: string,
    actorId: string,
    requestId: string,
    saleId: string,
    items: DbSaleItem[],
    branchId: string | null = null,
    ownerOrderId?: string,
  ): Promise<void> {
    await withInventoryLocks(
      this.db,
      businessId,
      [...(await this.stockRequirements(businessId, items)).keys()].map((productId) => ({ productId, branchId })),
      async () => {
        await this.assertAvailable(businessId, items, branchId, ownerOrderId);
        const requirements = await this.stockRequirements(businessId, items);
        for (const [productId, required] of requirements) {
          const current = await this.db.findBalance(productId, businessId, branchId);
          const onHand = current?.qtyOnHand ?? 0;
          await this.db.createMovement({
            businessId,
            productId,
            type: "sale",
            qtyDelta: -required,
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
            productId,
            qtyOnHand: onHand - required,
          });
        }
      },
    );
  }
}
