import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../common/memory.db";
import { ProductModelService } from "./product-model.service";

describe("phase19 product models", () => {
  it("creates variants with unique option combinations and generated barcodes", async () => {
    const db = createMemoryDb();
    const service = new ProductModelService(db);
    const family = await service.createFamily("b1", "u1", "r1", {
      name: "Tee",
      options: [{ name: "Size", values: ["S", "M"] }, { name: "Color", values: ["Black"] }],
    });
    const size = (family as { options: Array<{ values: Array<{ id: string; value: string }> }> }).options[0]!.values;
    const color = (family as { options: Array<{ values: Array<{ id: string; value: string }> }> }).options[1]!.values[0]!;
    const variant = await service.createVariant("b1", "u1", "r2", (family as { id: string }).id, {
      sku: "TEE-S-BLK", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
      optionValueIds: [size.find((v) => v.value === "S")!.id, color.id],
    });
    expect(variant.barcode).toBeNull();
    await expect(service.createVariant("b1", "u1", "r3", (family as { id: string }).id, {
      sku: "TEE-S-BLK-2", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
      optionValueIds: [size.find((v) => v.value === "S")!.id, color.id],
    })).rejects.toThrow("DUPLICATE_VARIANT");
    const generated = await service.generateBarcode("b1", "u1", "r4", variant.id);
    expect(generated.barcode).toMatch(/^NXP-/);
  });

  it("computes bundle availability from component stock and refuses nested/untracked components", async () => {
    const db = createMemoryDb();
    const service = new ProductModelService(db);
    const component = await db.createProduct({ businessId: "b1", categoryId: null, name: "Cup", sku: "CUP", barcode: null, brand: null, unit: "pc", costMinor: 100, priceMinor: 200, taxRateBps: null, reorderLevel: 0, trackInventory: true, isActive: true, imageUrl: null });
    await db.upsertBalance({ businessId: "b1", branchId: "br1", productId: component.id, qtyOnHand: 5 });
    const bundle = await service.createBundle("b1", "u1", "r1", { name: "Pack", sku: "PACK", priceMinor: 500, costMinor: 200, components: [{ productId: component.id, quantity: 2 }] });
    const productId = (bundle as { product: { id: string } }).product.id;
    expect(await service.bundleAvailability("b1", productId, "br1")).toBe(2);
    await expect(service.createBundle("b1", "u1", "r2", { name: "Nested", sku: "NEST", priceMinor: 1, costMinor: 1, components: [{ productId, quantity: 1 }] })).rejects.toThrow("INVALID_BUNDLE_COMPONENT");
  });
});
