import { Injectable } from "@nestjs/common";
import { withScope } from "@pos/database";
import type { DbCategory, DbPort, DbProduct } from "../../common/db.port";
import {
  findDuplicateBarcode,
  findDuplicateSku,
  normalizeBarcode,
  normalizeProductInput,
  normalizeSku,
} from "../normalize";
import { applyProductSearch } from "../search";

export interface CategoryInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
}

export interface ProductInput {
  name: string;
  categoryId?: string | null;
  sku?: string | null;
  barcode?: string | null;
  brand?: string | null;
  unit?: string;
  costMinor?: number;
  priceMinor: number;
  taxRateBps?: number | null;
  reorderLevel?: number;
  trackInventory?: boolean;
  isActive?: boolean;
  imageUrl?: string | null;
}

export type ProductPatch = Partial<ProductInput>;
export type CategoryPatch = Partial<CategoryInput>;

async function assertCategoryBelongs(
  db: DbPort,
  businessId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (!categoryId) return;
  const cat = await db.findCategoryById(categoryId, businessId);
  if (!cat) throw new Error("VALIDATION");
}

async function assertUniqueSku(
  db: DbPort,
  businessId: string,
  sku: string | null,
  ignoreId?: string,
): Promise<void> {
  if (!sku) return;
  const rows = await db.listProducts(businessId);
  if (rows.some((r) => r.sku === sku && r.id !== ignoreId)) throw new Error("CATALOG_DUPLICATE_SKU");
}

async function assertUniqueBarcode(
  db: DbPort,
  businessId: string,
  barcode: string | null,
  ignoreId?: string,
): Promise<void> {
  if (!barcode) return;
  const rows = await db.listProducts(businessId);
  if (rows.some((r) => r.barcode === barcode && r.id !== ignoreId)) {
    throw new Error("CATALOG_DUPLICATE_BARCODE");
  }
}

@Injectable()
export class CatalogService {
  constructor(private readonly db: DbPort) {}

  async createCategory(
    businessId: string,
    actorId: string,
    requestId: string,
    input: CategoryInput,
  ): Promise<DbCategory> {
    withScope(businessId, {});
    const name = input.name.trim();
    if (!name) throw new Error("VALIDATION");
    const row = await this.db.createCategory({
      businessId,
      name,
      description: input.description?.trim() ? input.description.trim() : null,
      isActive: input.isActive ?? true,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "category.create",
      entityType: "Category",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async listCategories(businessId: string): Promise<DbCategory[]> {
    withScope(businessId, {});
    return this.db.listCategories(businessId);
  }

  async updateCategory(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    patch: CategoryPatch,
  ): Promise<DbCategory> {
    withScope(businessId, {});
    const current = await this.db.findCategoryById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    const next = await this.db.updateCategory(id, businessId, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description?.trim() ? patch.description.trim() : null }
        : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    });
    if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "category.update",
      entityType: "Category",
      entityId: id,
      requestId,
    });
    return next;
  }

  async createProduct(
    businessId: string,
    actorId: string,
    requestId: string,
    input: ProductInput,
  ): Promise<DbProduct> {
    withScope(businessId, {});
    const norm = normalizeProductInput({ name: input.name, sku: input.sku, barcode: input.barcode });
    if (!norm.name) throw new Error("VALIDATION");
    await assertCategoryBelongs(this.db, businessId, input.categoryId);
    await assertUniqueSku(this.db, businessId, norm.sku);
    await assertUniqueBarcode(this.db, businessId, norm.barcode);
    const row = await this.db.createProduct({
      businessId,
      categoryId: input.categoryId ?? null,
      name: norm.name,
      sku: norm.sku,
      barcode: norm.barcode,
      brand: input.brand?.trim() ? input.brand.trim() : null,
      unit: input.unit?.trim() ? input.unit.trim() : "pc",
      costMinor: input.costMinor ?? 0,
      priceMinor: input.priceMinor,
      taxRateBps: input.taxRateBps ?? null,
      reorderLevel: input.reorderLevel ?? 0,
      trackInventory: input.trackInventory ?? true,
      isActive: input.isActive ?? true,
      imageUrl: input.imageUrl?.trim() ? input.imageUrl.trim() : null,
    });
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "product.create",
      entityType: "Product",
      entityId: row.id,
      requestId,
    });
    return row;
  }

  async getProduct(businessId: string, id: string, _granted: string[]): Promise<DbProduct> {
    withScope(businessId, {});
    void _granted;
    const row = await this.db.findProductById(id, businessId);
    if (!row) throw new Error("NOT_FOUND");
    return row;
  }

  async searchProducts(
    businessId: string,
    opts: { q?: string; categoryId?: string; active: "true" | "false" | "all"; page: number; pageSize: number },
  ): Promise<{ items: DbProduct[]; total: number; page: number; pageSize: number }> {
    withScope(businessId, {});
    if (opts.categoryId) {
      const cat = await this.db.findCategoryById(opts.categoryId, businessId);
      if (!cat) throw new Error("VALIDATION");
    }
    const rows = await this.db.listProducts(businessId);
    return applyProductSearch(rows, opts);
  }

  async updateProduct(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    patch: ProductPatch,
  ): Promise<DbProduct> {
    withScope(businessId, {});
    const current = await this.db.findProductById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    const sku = patch.sku !== undefined ? normalizeSku(patch.sku) : undefined;
    const barcode = patch.barcode !== undefined ? normalizeBarcode(patch.barcode) : undefined;
    if (patch.categoryId !== undefined && patch.categoryId !== null) {
      await assertCategoryBelongs(this.db, businessId, patch.categoryId);
    }
    if (sku !== undefined) await assertUniqueSku(this.db, businessId, sku, id);
    if (barcode !== undefined) await assertUniqueBarcode(this.db, businessId, barcode, id);
    const next = await this.db.updateProduct(id, businessId, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(sku !== undefined ? { sku } : {}),
      ...(barcode !== undefined ? { barcode } : {}),
      ...(patch.brand !== undefined
        ? { brand: patch.brand?.trim() ? patch.brand.trim() : null }
        : {}),
      ...(patch.unit !== undefined && patch.unit ? { unit: patch.unit.trim() } : {}),
      ...(patch.costMinor !== undefined ? { costMinor: patch.costMinor } : {}),
      ...(patch.priceMinor !== undefined ? { priceMinor: patch.priceMinor } : {}),
      ...(patch.taxRateBps !== undefined ? { taxRateBps: patch.taxRateBps } : {}),
      ...(patch.reorderLevel !== undefined ? { reorderLevel: patch.reorderLevel } : {}),
      ...(patch.trackInventory !== undefined ? { trackInventory: patch.trackInventory } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.imageUrl !== undefined
        ? { imageUrl: patch.imageUrl?.trim() ? patch.imageUrl.trim() : null }
        : {}),
    });
    if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "product.update",
      entityType: "Product",
      entityId: id,
      requestId,
    });
    return next;
  }

  async setProductActive(
    businessId: string,
    actorId: string,
    requestId: string,
    id: string,
    isActive: boolean,
  ): Promise<DbProduct> {
    withScope(businessId, {});
    const current = await this.db.findProductById(id, businessId);
    if (!current) throw new Error("NOT_FOUND");
    const next = await this.db.updateProduct(id, businessId, { isActive });
    if (!next) throw new Error("NOT_FOUND");
    await this.db.appendAudit({
      businessId,
      actorId,
      action: isActive ? "product.restore" : "product.archive",
      entityType: "Product",
      entityId: id,
      requestId,
    });
    return next;
  }

  async importProducts(
    businessId: string,
    actorId: string,
    requestId: string,
    input: { items: ProductInput[] },
  ): Promise<{ imported: number }> {
    withScope(businessId, {});
    const prepared = input.items.map((item) => {
      const norm = normalizeProductInput({ name: item.name, sku: item.sku, barcode: item.barcode });
      return { item, sku: norm.sku, barcode: norm.barcode, name: norm.name };
    });
    const dupSku = findDuplicateSku(prepared);
    if (dupSku >= 0) throw new Error("CATALOG_DUPLICATE_SKU");
    const dupBarcode = findDuplicateBarcode(prepared);
    if (dupBarcode >= 0) throw new Error("CATALOG_DUPLICATE_BARCODE");
    const existing = await this.db.listProducts(businessId);
    for (const p of prepared) {
      if (!p.name) throw new Error("VALIDATION");
      if (p.sku && existing.some((r) => r.sku === p.sku)) throw new Error("CATALOG_DUPLICATE_SKU");
      if (p.barcode && existing.some((r) => r.barcode === p.barcode)) {
        throw new Error("CATALOG_DUPLICATE_BARCODE");
      }
      if (p.item.categoryId) await assertCategoryBelongs(this.db, businessId, p.item.categoryId);
    }
    for (const p of prepared) {
      await this.createProduct(businessId, actorId, `${requestId}#${p.name}`, p.item);
    }
    await this.db.appendAudit({
      businessId,
      actorId,
      action: "product.import",
      entityType: "Product",
      entityId: `${prepared.length}`,
      requestId,
    });
    return { imported: prepared.length };
  }
}
