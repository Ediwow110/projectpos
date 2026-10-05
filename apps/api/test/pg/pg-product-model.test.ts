import { describe, expect, it } from "vitest";
import { ProductModelService } from "../../src/catalog/nest/product-model.service";
import { withPg } from "./helpers";

describe("phase21 pg product dimensions", () => {
  it("persists added and archived option values while protecting variant links", async () => {
    await withPg(async (db) => {
      const business = await db.createBusiness({ name: `Dimension Biz ${Date.now()}`, currency: "PHP" });
      const service = new ProductModelService(db);
      const family = await service.createFamily(business.id, "user-1", "request-1", {
        name: "Tee", options: [{ name: "Size", values: ["S", "M"] }],
      }) as { id: string; options: Array<{ id: string; values: Array<{ id: string; value: string }> }> };
      const option = family.options[0]!;
      const sizeS = option.values.find((value) => value.value === "S")!;
      const sizeM = option.values.find((value) => value.value === "M")!;
      await service.createVariant(business.id, "user-1", "request-2", family.id, {
        sku: "TEE-S", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
        optionValueIds: [sizeS.id],
      });
      await service.updateFamilyOptions(business.id, "user-1", "request-3", family.id, {
        options: [{ id: option.id, addValues: ["L"], archiveValueIds: [sizeM.id] }],
      });
      const updated = await service.listFamily(business.id, family.id) as typeof family;
      expect(updated.options[0]!.values.find((value) => value.value === "L")).toMatchObject({ isActive: true });
      expect(updated.options[0]!.values.find((value) => value.id === sizeM.id)).toMatchObject({ isActive: false });
      await expect(service.createVariant(business.id, "user-1", "request-4", family.id, {
        sku: "TEE-M", priceMinor: 1200, costMinor: 500, reorderLevel: 0, trackInventory: true,
        optionValueIds: [sizeM.id],
      })).rejects.toThrow("INACTIVE_OPTION_VALUE");
    });
  });
});
