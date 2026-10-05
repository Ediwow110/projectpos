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

  it("adds values and archives only unused values without changing variant meaning", async () => {
    const db = createMemoryDb();
    const service = new ProductModelService(db);
    const family = await service.createFamily("b1", "u1", "r1", {
      name: "Tee", options: [{ name: "Size", values: ["S", "M"] }],
    }) as { id: string; options: Array<{ id: string; values: Array<{ id: string; value: string }> }> };
    const option = family.options[0]!;
    const sizeS = option.values.find((value) => value.value === "S")!;
    const sizeM = option.values.find((value) => value.value === "M")!;
    await service.createVariant("b1", "u1", "r2", family.id, {
      sku: "TEE-S", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
      optionValueIds: [sizeS.id],
    });

    await expect(service.updateFamilyOptions("b1", "u1", "r3", family.id, {
      options: [{ id: option.id, addValues: ["L"], archiveValueIds: [sizeM.id] }],
    })).resolves.toMatchObject({ id: family.id });

    const updated = await service.listFamily("b1", family.id) as typeof family;
    expect(updated.options[0]!.values.find((value) => value.value === "L")).toMatchObject({ isActive: true });
    expect(updated.options[0]!.values.find((value) => value.id === sizeM.id)).toMatchObject({ isActive: false });
    await expect(service.createVariant("b1", "u1", "r4", family.id, {
      sku: "TEE-M", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
      optionValueIds: [sizeM.id],
    })).rejects.toThrow("INACTIVE_OPTION_VALUE");
  });

  it("rejects edits that rename a referenced option or archive a referenced value", async () => {
    const db = createMemoryDb();
    const service = new ProductModelService(db);
    const family = await service.createFamily("b1", "u1", "r1", {
      name: "Tee", options: [{ name: "Size", values: ["S"] }],
    }) as { id: string; options: Array<{ id: string; values: Array<{ id: string }> }> };
    const option = family.options[0]!;
    await service.createVariant("b1", "u1", "r2", family.id, {
      sku: "TEE-S", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
      optionValueIds: [option.values[0]!.id],
    });
    await expect(service.updateFamilyOptions("b1", "u1", "r3", family.id, {
      options: [{ id: option.id, name: "Fit" }],
    })).rejects.toThrow("OPTION_IN_USE");
    await expect(service.updateFamilyOptions("b1", "u1", "r4", family.id, {
      options: [{ id: option.id, archiveValueIds: [option.values[0]!.id] }],
    })).rejects.toThrow("OPTION_VALUE_IN_USE");
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
