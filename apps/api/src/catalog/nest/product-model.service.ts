import { Inject, Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbBundleComponent, DbPort, DbProduct, DbProductBundle, DbProductFamily } from "../../common/db.port";

const MAX_OPTIONS = 3;
const MAX_VALUES = 20;
const MAX_VARIANTS = 100;

function internalBarcode(): string {
  return `NXP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

@Injectable()
export class ProductModelService {
  constructor(@Inject("DbPort") private readonly db: DbPort) {}

  private async uniqueProductIdentity(businessId: string, sku: string | null, barcode: string | null): Promise<void> {
    const products = await this.db.listProducts(businessId);
    if (sku && products.some((p) => p.sku === sku)) throw new Error("CATALOG_DUPLICATE_SKU");
    if (barcode && products.some((p) => p.barcode === barcode)) throw new Error("CATALOG_DUPLICATE_BARCODE");
  }

  async listFamily(businessId: string, id: string): Promise<unknown> {
    withScope(businessId, {});
    const family = await this.db.findProductFamilyById(id, businessId); if (!family) throw new Error("NOT_FOUND");
    const options = await this.db.listProductOptions(id, businessId);
    const values = Object.fromEntries(await Promise.all(options.map(async (o) => [o.id, await this.db.listProductOptionValues(o.id, businessId)] as const)));
    const products = (await this.db.listProducts(businessId)).filter((p) => p.familyId === id);
    const variants = await Promise.all(products.map(async (product) => ({ product, optionValueIds: (await this.db.listVariantOptionValues(product.id, businessId)).map((l) => l.optionValueId) })));
    return { ...family, options: options.map((o) => ({ ...o, values: values[o.id] ?? [] })), variants };
  }

  async listFamilies(businessId: string): Promise<DbProductFamily[]> { withScope(businessId, {}); return this.db.listProductFamilies(businessId); }

  async createFamily(businessId: string, actorId: string, requestId: string, input: { name: string; categoryId?: string | null; brand?: string | null; description?: string | null; options: Array<{ name: string; values: string[] }> }): Promise<unknown> {
    withScope(businessId, {});
    if (input.options.length > MAX_OPTIONS || input.options.some((o) => o.values.length > MAX_VALUES)) throw new Error("PHASE19_LIMIT");
    if (input.categoryId && !(await this.db.findCategoryById(input.categoryId, businessId))) throw new Error("VALIDATION");
    if (new Set(input.options.map((option) => option.name.trim().toLowerCase())).size !== input.options.length) throw new Error("DUPLICATE_OPTION");
    const existing = await this.db.listProductFamilies(businessId); if (existing.some((f) => f.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error("DUPLICATE_FAMILY");
    const family = await this.db.createProductFamily({ businessId, name: input.name.trim(), categoryId: input.categoryId ?? null, brand: input.brand?.trim() || null, description: input.description?.trim() || null, isActive: true });
    for (const [position, option] of input.options.entries()) {
      const row = await this.db.createProductOption({ businessId, familyId: family.id, name: option.name.trim(), position });
      for (const [valuePosition, value] of option.values.entries()) await this.db.createProductOptionValue({ businessId, optionId: row.id, value: value.trim(), position: valuePosition });
    }
    await this.db.appendAudit({ businessId, actorId, action: "product_family.create", entityType: "ProductFamily", entityId: family.id, requestId });
    return this.listFamily(businessId, family.id);
  }

  async updateFamily(businessId: string, actorId: string, requestId: string, id: string, patch: { name?: string; categoryId?: string | null; brand?: string | null; description?: string | null; isActive?: boolean }): Promise<DbProductFamily> {
    const current = await this.db.findProductFamilyById(id, businessId); if (!current) throw new Error("NOT_FOUND");
    const next = await this.db.updateProductFamily(id, businessId, patch); if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({ businessId, actorId, action: "product_family.update", entityType: "ProductFamily", entityId: id, requestId, before: current, after: next });
    return next;
  }

  async updateFamilyOptions(
    businessId: string,
    actorId: string,
    requestId: string,
    familyId: string,
    input: { options: Array<{ id: string; name?: string; addValues?: string[]; archiveValueIds?: string[] }> },
  ): Promise<unknown> {
    const family = await this.db.findProductFamilyById(familyId, businessId);
    if (!family) throw new Error("NOT_FOUND");
    const options = await this.db.listProductOptions(familyId, businessId);
    const requestedIds = new Set(input.options.map((option) => option.id));
    if (requestedIds.size !== input.options.length) throw new Error("DUPLICATE_OPTION");
    if (input.options.some((option) => !options.some((current) => current.id === option.id))) throw new Error("NOT_FOUND");

    const optionValues = new Map<string, Awaited<ReturnType<DbPort["listProductOptionValues"]>>>();
    for (const option of options) optionValues.set(option.id, await this.db.listProductOptionValues(option.id, businessId));
    const products = (await this.db.listProducts(businessId)).filter((product) => product.familyId === familyId);
    const links = (await Promise.all(products.map((product) => this.db.listVariantOptionValues(product.id, businessId)))).flat();
    const usedOptionIds = new Set(links.map((link) => link.optionId));
    const usedValueIds = new Set(links.map((link) => link.optionValueId));

    const names = new Map(options.map((option) => [option.id, option.name.trim().toLowerCase()]));
    for (const update of input.options) {
      const current = options.find((option) => option.id === update.id)!;
      if (update.name !== undefined) {
        const name = update.name.trim();
        const key = name.toLowerCase();
        if ([...names.entries()].some(([id, existing]) => id !== current.id && existing === key)) throw new Error("DUPLICATE_OPTION");
        if (usedOptionIds.has(current.id) && key !== current.name.trim().toLowerCase()) throw new Error("OPTION_IN_USE");
        names.set(current.id, key);
      }
      const values = optionValues.get(current.id)!;
      const addValues = (update.addValues ?? []).map((value) => value.trim()).filter(Boolean);
      const requestedAdds = new Set(addValues.map((value) => value.toLowerCase()));
      if (requestedAdds.size !== addValues.length) throw new Error("DUPLICATE_OPTION_VALUE");
      if (addValues.some((value) => values.some((existing) => existing.value.trim().toLowerCase() === value.toLowerCase()))) throw new Error("DUPLICATE_OPTION_VALUE");
      const archiveIds = update.archiveValueIds ?? [];
      if (new Set(archiveIds).size !== archiveIds.length) throw new Error("DUPLICATE_OPTION_VALUE");
      for (const valueId of archiveIds) {
        const value = values.find((candidate) => candidate.id === valueId);
        if (!value) throw new Error("NOT_FOUND");
        if (usedValueIds.has(value.id)) throw new Error("OPTION_VALUE_IN_USE");
        if (value.isActive === false) throw new Error("OPTION_VALUE_ARCHIVED");
      }
      if (values.filter((value) => value.isActive !== false).length - archiveIds.length + addValues.length < 1) throw new Error("OPTION_VALUE_REQUIRED");
      if (values.length + addValues.length > MAX_VALUES) throw new Error("PHASE19_LIMIT");
    }

    for (const update of input.options) {
      const current = options.find((option) => option.id === update.id)!;
      if (update.name !== undefined && update.name.trim() !== current.name) await this.db.updateProductOption(current.id, businessId, { name: update.name.trim() });
      const values = optionValues.get(current.id)!;
      for (const valueId of update.archiveValueIds ?? []) await this.db.updateProductOptionValue(valueId, businessId, { isActive: false });
      let position = values.reduce((max, value) => Math.max(max, value.position), -1) + 1;
      for (const value of (update.addValues ?? []).map((entry) => entry.trim()).filter(Boolean)) {
        await this.db.createProductOptionValue({ businessId, optionId: current.id, value, position: position++, isActive: true });
      }
    }
    await this.db.appendAudit({ businessId, actorId, action: "product_family.options.update", entityType: "ProductFamily", entityId: familyId, requestId, after: input });
    return this.listFamily(businessId, familyId);
  }

  async createVariant(businessId: string, actorId: string, requestId: string, familyId: string, input: { name?: string; sku: string; barcode?: string | null; priceMinor: number; costMinor: number; taxRateBps?: number | null; reorderLevel: number; trackInventory: boolean; optionValueIds: string[] }): Promise<DbProduct> {
    const family = await this.db.findProductFamilyById(familyId, businessId); if (!family || !family.isActive) throw new Error("NOT_FOUND");
    const options = await this.db.listProductOptions(familyId, businessId); if (input.optionValueIds.length !== options.length) throw new Error("OPTION_COMBINATION_REQUIRED");
    const selected = await Promise.all(input.optionValueIds.map((id) => this.db.findProductOptionValueById(id, businessId)));
    if (selected.some((v) => !v)) throw new Error("VALIDATION");
    if (selected.some((v) => v!.isActive === false)) throw new Error("INACTIVE_OPTION_VALUE");
    const optionIds = selected.map((v) => v!.optionId); if (selected.some((v) => !options.some((option) => option.id === v!.optionId)) || new Set(optionIds).size !== optionIds.length || new Set(optionIds).size !== options.length) throw new Error("OPTION_COMBINATION_REQUIRED");
    const existing = (await this.db.listProducts(businessId)).filter((p) => p.familyId === familyId);
    if (existing.length >= MAX_VARIANTS) throw new Error("PHASE19_LIMIT");
    const wanted = [...input.optionValueIds].sort().join(",");
    for (const product of existing) { const current = (await this.db.listVariantOptionValues(product.id, businessId)).map((l) => l.optionValueId).sort().join(","); if (current === wanted) throw new Error("DUPLICATE_VARIANT"); }
    const barcode = input.barcode?.trim() || null; await this.uniqueProductIdentity(businessId, input.sku.trim(), barcode);
    const valuesByOption = new Map(selected.map((v) => [v!.optionId, v!.value]));
    const display = `${family.name} · ${options.map((o) => valuesByOption.get(o.id)).join(" / ")}`;
    const product = await this.db.createProduct({ businessId, familyId, productType: "STANDARD", categoryId: family.categoryId, name: input.name?.trim() || display, sku: input.sku.trim(), barcode, brand: family.brand, unit: "pc", costMinor: input.costMinor, priceMinor: input.priceMinor, taxRateBps: input.taxRateBps ?? null, reorderLevel: input.reorderLevel, trackInventory: input.trackInventory, isActive: true, imageUrl: null });
    for (const value of selected) await this.db.createVariantOptionValue({ businessId, productId: product.id, optionId: value!.optionId, optionValueId: value!.id });
    await this.db.appendAudit({ businessId, actorId, action: "product_variant.create", entityType: "Product", entityId: product.id, requestId });
    return product;
  }

  async generateBarcode(businessId: string, actorId: string, requestId: string, productId: string): Promise<DbProduct> {
    const product = await this.db.findProductById(productId, businessId); if (!product) throw new Error("NOT_FOUND");
    if (product.barcode) return product;
    let barcode = internalBarcode(); while ((await this.db.listProducts(businessId)).some((p) => p.barcode === barcode)) barcode = internalBarcode();
    const next = await this.db.updateProduct(productId, businessId, { barcode }); if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({ businessId, actorId, action: "product.barcode_generate", entityType: "Product", entityId: productId, requestId, before: { barcode: null }, after: { barcode } });
    return next;
  }

  async findBarcode(businessId: string, barcode: string): Promise<DbProduct> {
    const row = (await this.db.listProducts(businessId)).find((p) => p.isActive && p.barcode === barcode); if (!row) throw new Error("NOT_FOUND"); return row;
  }

  async labelProducts(businessId: string, productIds: string[], quantity: number): Promise<Array<DbProduct & { labelQuantity: number }>> {
    const products = await Promise.all(productIds.map((id) => this.db.findProductById(id, businessId)));
    if (products.some((product) => !product || !product.isActive)) throw new Error("NOT_FOUND");
    return products.filter((product): product is DbProduct => product !== null).map((product) => ({ ...product, labelQuantity: quantity }));
  }

  async createBundle(businessId: string, actorId: string, requestId: string, input: { name: string; sku: string; barcode?: string | null; priceMinor: number; costMinor: number; categoryId?: string | null; components: Array<{ productId: string; quantity: number }> }): Promise<unknown> {
    const duplicate = new Set(input.components.map((c) => c.productId)); if (duplicate.size !== input.components.length) throw new Error("DUPLICATE_COMPONENT");
    if (input.components.some((component) => !Number.isInteger(component.quantity) || component.quantity <= 0)) throw new Error("VALIDATION");
    await this.uniqueProductIdentity(businessId, input.sku.trim(), input.barcode?.trim() || null);
    const products = await Promise.all(input.components.map((c) => this.db.findProductById(c.productId, businessId)));
    if (products.some((p) => !p || !p.isActive || !p.trackInventory)) throw new Error("INVALID_BUNDLE_COMPONENT");
    const bundle = await this.db.createProduct({ businessId, familyId: null, productType: "BUNDLE", categoryId: input.categoryId ?? null, name: input.name.trim(), sku: input.sku.trim(), barcode: input.barcode?.trim() || null, brand: null, unit: "kit", costMinor: input.costMinor, priceMinor: input.priceMinor, taxRateBps: null, reorderLevel: 0, trackInventory: false, isActive: true, imageUrl: null });
    const definition = await this.db.createProductBundle({ businessId, bundleProductId: bundle.id, version: 1 });
    for (const [position, c] of input.components.entries()) await this.db.createBundleComponent({ businessId, bundleId: definition.id, componentProductId: c.productId, quantity: c.quantity, position });
    await this.db.appendAudit({ businessId, actorId, action: "product_bundle.create", entityType: "ProductBundle", entityId: definition.id, requestId });
    return this.getBundle(businessId, definition.id);
  }

  async getBundle(businessId: string, bundleId: string): Promise<unknown> {
    const bundle = await this.db.findProductBundleById(bundleId, businessId); if (!bundle) throw new Error("NOT_FOUND");
    const product = await this.db.findProductById(bundle.bundleProductId, businessId); const components = await this.db.listBundleComponents(bundle.id, businessId);
    return { ...bundle, product, components };
  }

  async listBundles(businessId: string): Promise<unknown[]> {
    withScope(businessId, {});
    const products = (await this.db.listProducts(businessId)).filter((product) => product.productType === "BUNDLE");
    const bundles = await Promise.all(products.map(async (product) => {
      const bundle = await this.db.findProductBundleByProductId(product.id, businessId);
      return bundle ? { ...bundle, product, components: await this.db.listBundleComponents(bundle.id, businessId) } : null;
    }));
    return bundles.filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null);
  }

  async updateBundle(businessId: string, actorId: string, requestId: string, bundleId: string, input: { components: Array<{ productId: string; quantity: number }> }): Promise<unknown> {
    const bundle = await this.db.findProductBundleById(bundleId, businessId); if (!bundle) throw new Error("NOT_FOUND");
    const duplicate = new Set(input.components.map((c) => c.productId)); if (duplicate.size !== input.components.length || input.components.some((c) => !Number.isInteger(c.quantity) || c.quantity <= 0)) throw new Error("VALIDATION");
    const products = await Promise.all(input.components.map((c) => this.db.findProductById(c.productId, businessId)));
    if (products.some((p) => !p || !p.isActive || !p.trackInventory || p.productType === "BUNDLE")) throw new Error("INVALID_BUNDLE_COMPONENT");
    await this.db.deleteBundleComponents(bundle.id, businessId);
    for (const [position, component] of input.components.entries()) await this.db.createBundleComponent({ businessId, bundleId: bundle.id, componentProductId: component.productId, quantity: component.quantity, position });
    await this.db.updateProductBundle(bundle.id, businessId, { version: bundle.version + 1 });
    await this.db.appendAudit({ businessId, actorId, action: "product_bundle.update", entityType: "ProductBundle", entityId: bundle.id, requestId, after: { version: bundle.version + 1 } });
    return this.getBundle(businessId, bundle.id);
  }

  async bundleAvailability(businessId: string, productId: string, branchId: string | null): Promise<number> {
    const bundle = await this.db.findProductBundleByProductId(productId, businessId); if (!bundle) throw new Error("NOT_FOUND");
    const components = await this.db.listBundleComponents(bundle.id, businessId); if (!components.length) return 0;
    const values = await Promise.all(components.map(async (c) => Math.floor(((await this.db.findBalance(c.componentProductId, businessId, branchId))?.qtyOnHand ?? 0) / c.quantity)));
    return Math.min(...values);
  }

  async componentsForProduct(businessId: string, productId: string): Promise<{ bundle: DbProductBundle; components: DbBundleComponent[] } | null> {
    const bundle = await this.db.findProductBundleByProductId(productId, businessId); return bundle ? { bundle, components: await this.db.listBundleComponents(bundle.id, businessId) } : null;
  }
}
