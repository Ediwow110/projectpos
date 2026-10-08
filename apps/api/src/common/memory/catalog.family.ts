import type {
  DbBundleComponent,
  DbCategory,
  DbPort,
  DbProduct,
  DbProductBundle,
  DbProductFamily,
  DbProductOption,
  DbProductOptionValue,
  DbProductVariantOptionValue,
} from "../db.port";

type MemoryCatalogContext = {
  categories: Map<string, DbCategory>;
  products: Map<string, DbProduct>;
  productFamilies: Map<string, DbProductFamily>;
  productOptions: Map<string, DbProductOption>;
  productOptionValues: Map<string, DbProductOptionValue>;
  variantOptionValues: Map<string, DbProductVariantOptionValue>;
  productBundles: Map<string, DbProductBundle>;
  bundleComponents: Map<string, DbBundleComponent>;
  nextId: (prefix: string) => string;
};

export function createMemoryCatalog(context: MemoryCatalogContext): Pick<DbPort, "createCategory" | "listCategories" | "findCategoryById" | "updateCategory" | "createProduct" | "listProducts" | "findProductById" | "updateProduct" | "createProductFamily" | "listProductFamilies" | "findProductFamilyById" | "updateProductFamily" | "createProductOption" | "listProductOptions" | "findProductOptionById" | "createProductOptionValue" | "listProductOptionValues" | "findProductOptionValueById" | "createVariantOptionValue" | "listVariantOptionValues" | "deleteVariantOptionValues" | "createProductBundle" | "findProductBundleByProductId" | "findProductBundleById" | "updateProductBundle" | "createBundleComponent" | "listBundleComponents" | "deleteBundleComponents"> {
  const {
    categories,
    products,
    productFamilies,
    productOptions,
    productOptionValues,
    variantOptionValues,
    productBundles,
    bundleComponents,
    nextId: nid,
  } = context;

  return {
    async createCategory(c) {
      const row = { ...c, id: nid("cat") };
      categories.set(row.id, row);
      return row;
    },
    async listCategories(businessId) {
      return [...categories.values()].filter((c) => c.businessId === businessId);
    },
    async findCategoryById(id, businessId) {
      const c = categories.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      return c;
    },
    async updateCategory(id, businessId, patch) {
      const c = categories.get(id) ?? null;
      if (!c || c.businessId !== businessId) return null;
      const next = { ...c, ...patch };
      categories.set(id, next);
      return next;
    },
    async createProduct(p) {
      const row = { ...p, id: nid("prod") };
      products.set(row.id, row);
      return row;
    },
    async listProducts(businessId) {
      return [...products.values()].filter((p) => p.businessId === businessId);
    },
    async findProductById(id, businessId) {
      const p = products.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      return p;
    },
    async updateProduct(id, businessId, patch) {
      const p = products.get(id) ?? null;
      if (!p || p.businessId !== businessId) return null;
      const next = { ...p, ...patch };
      products.set(id, next);
      return next;
    },
    async createProductFamily(f) {
      const now = new Date(); const row = { ...f, id: nid("pfam"), createdAt: now, updatedAt: now };
      productFamilies.set(row.id, row); return row;
    },
    async listProductFamilies(businessId) { return [...productFamilies.values()].filter((r) => r.businessId === businessId); },
    async findProductFamilyById(id, businessId) { const row = productFamilies.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductFamily(id, businessId, patch) {
      const row = productFamilies.get(id) ?? null; if (!row || row.businessId !== businessId) return null;
      const next = { ...row, ...patch, updatedAt: new Date() }; productFamilies.set(id, next); return next;
    },
    async createProductOption(o) { const now = new Date(); const row = { ...o, id: nid("popt"), createdAt: now, updatedAt: now }; productOptions.set(row.id, row); return row; },
    async listProductOptions(familyId, businessId) { return [...productOptions.values()].filter((r) => r.familyId === familyId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async findProductOptionById(id, businessId) { const row = productOptions.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async createProductOptionValue(v) { const now = new Date(); const row = { ...v, id: nid("pval"), createdAt: now, updatedAt: now }; productOptionValues.set(row.id, row); return row; },
    async listProductOptionValues(optionId, businessId) { return [...productOptionValues.values()].filter((r) => r.optionId === optionId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async findProductOptionValueById(id, businessId) { const row = productOptionValues.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async createVariantOptionValue(v) { const row = { ...v, id: nid("pvo"), createdAt: new Date() }; variantOptionValues.set(row.id, row); return row; },
    async listVariantOptionValues(productId, businessId) { return [...variantOptionValues.values()].filter((r) => r.productId === productId && r.businessId === businessId); },
    async deleteVariantOptionValues(productId, businessId) { for (const [id, row] of variantOptionValues) if (row.productId === productId && row.businessId === businessId) variantOptionValues.delete(id); },
    async createProductBundle(b) { const now = new Date(); const row = { ...b, id: nid("bun"), createdAt: now, updatedAt: now }; productBundles.set(row.id, row); return row; },
    async findProductBundleByProductId(productId, businessId) { return [...productBundles.values()].find((r) => r.bundleProductId === productId && r.businessId === businessId) ?? null; },
    async findProductBundleById(id, businessId) { const row = productBundles.get(id) ?? null; return row && row.businessId === businessId ? row : null; },
    async updateProductBundle(id, businessId, patch) { const row = productBundles.get(id) ?? null; if (!row || row.businessId !== businessId) return null; const next = { ...row, ...patch, updatedAt: new Date() }; productBundles.set(id, next); return next; },
    async createBundleComponent(c) { const now = new Date(); const row = { ...c, id: nid("bc"), createdAt: now, updatedAt: now }; bundleComponents.set(row.id, row); return row; },
    async listBundleComponents(bundleId, businessId) { return [...bundleComponents.values()].filter((r) => r.bundleId === bundleId && r.businessId === businessId).sort((a, b) => a.position - b.position); },
    async deleteBundleComponents(bundleId, businessId) { for (const [id, row] of bundleComponents) if (row.bundleId === bundleId && row.businessId === businessId) bundleComponents.delete(id); },
  };
}
