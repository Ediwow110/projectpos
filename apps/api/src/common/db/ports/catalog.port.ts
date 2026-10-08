import type {
  DbCategory,
  DbProduct,
  DbProductFamily,
  DbProductOption,
  DbProductOptionValue,
  DbProductVariantOptionValue,
  DbProductBundle,
  DbBundleComponent,
} from "../types";

export interface CatalogPort {
  createCategory(c: Omit<DbCategory, "id">): Promise<DbCategory>;
  listCategories(businessId: string): Promise<DbCategory[]>;
  findCategoryById(id: string, businessId: string): Promise<DbCategory | null>;
  updateCategory(id: string, businessId: string, patch: Partial<Omit<DbCategory, "id" | "businessId">>): Promise<DbCategory | null>;
  createProduct(p: Omit<DbProduct, "id">): Promise<DbProduct>;
  listProducts(businessId: string): Promise<DbProduct[]>;
  findProductById(id: string, businessId: string): Promise<DbProduct | null>;
  updateProduct(id: string, businessId: string, patch: Partial<Omit<DbProduct, "id" | "businessId">>): Promise<DbProduct | null>;
  createProductFamily(f: Omit<DbProductFamily, "id" | "createdAt" | "updatedAt">): Promise<DbProductFamily>;
  listProductFamilies(businessId: string): Promise<DbProductFamily[]>;
  findProductFamilyById(id: string, businessId: string): Promise<DbProductFamily | null>;
  updateProductFamily(id: string, businessId: string, patch: Partial<Omit<DbProductFamily, "id" | "businessId" | "createdAt">>): Promise<DbProductFamily | null>;
  createProductOption(o: Omit<DbProductOption, "id" | "createdAt" | "updatedAt">): Promise<DbProductOption>;
  listProductOptions(familyId: string, businessId: string): Promise<DbProductOption[]>;
  findProductOptionById(id: string, businessId: string): Promise<DbProductOption | null>;
  createProductOptionValue(v: Omit<DbProductOptionValue, "id" | "createdAt" | "updatedAt">): Promise<DbProductOptionValue>;
  listProductOptionValues(optionId: string, businessId: string): Promise<DbProductOptionValue[]>;
  findProductOptionValueById(id: string, businessId: string): Promise<DbProductOptionValue | null>;
  createVariantOptionValue(v: Omit<DbProductVariantOptionValue, "id" | "createdAt">): Promise<DbProductVariantOptionValue>;
  listVariantOptionValues(productId: string, businessId: string): Promise<DbProductVariantOptionValue[]>;
  deleteVariantOptionValues(productId: string, businessId: string): Promise<void>;
  createProductBundle(b: Omit<DbProductBundle, "id" | "createdAt" | "updatedAt">): Promise<DbProductBundle>;
  findProductBundleByProductId(productId: string, businessId: string): Promise<DbProductBundle | null>;
  findProductBundleById(id: string, businessId: string): Promise<DbProductBundle | null>;
  updateProductBundle(id: string, businessId: string, patch: Partial<Omit<DbProductBundle, "id" | "businessId" | "createdAt">>): Promise<DbProductBundle | null>;
  createBundleComponent(c: Omit<DbBundleComponent, "id" | "createdAt" | "updatedAt">): Promise<DbBundleComponent>;
  listBundleComponents(bundleId: string, businessId: string): Promise<DbBundleComponent[]>;
  deleteBundleComponents(bundleId: string, businessId: string): Promise<void>;
}
