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
    const requirements = await this.stockRequirements(businessId, items);
    for (const [productId, required] of requirements) {
      const current = await this.db.findBalance(productId, businessId, branchId);
      const onHand = current?.qtyOnHand ?? 0;
      if (onHand - required < 0) {
        incrementMetric("pos_inventory_failures_total");
        throw new Error("INSUFFICIENT_STOCK");
      }
    }
  }

  private async stockRequirements(businessId: string, items: DbSaleItem[]): Promise<Map<string, number>> {
    const requirements = new Map<string, number>();
    for (const item of items) {
      const product = await this.requireProduct(businessId, item.productId);
      const bundle = product.productType === "BUNDLE"
        ? await this.db.findProductBundleByProductId(item.productId, businessId)
        : null;
      if (product.productType === "BUNDLE" && !bundle) throw new Error("INVALID_BUNDLE");
      if (bundle) {
        const components = await this.db.listBundleComponents(bundle.id, businessId);
        if (components.length === 0) throw new Error("INVALID_BUNDLE");
        for (const component of components) {
          requirements.set(component.componentProductId, (requirements.get(component.componentProductId) ?? 0) + item.qty * component.quantity);
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
  ): Promise<void> {
    await withInventoryLocks(
      this.db,
      businessId,
      [...(await this.stockRequirements(businessId, items)).keys()].map((productId) => ({ productId, branchId })),
      async () => {
        await this.assertAvailable(businessId, items, branchId);
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
