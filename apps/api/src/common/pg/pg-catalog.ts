import type { DbCategory, DbProduct } from "../db.port";
import { nid } from "./context";
import type { PgContext } from "./context";

// The catalog family: categories and products. Mapping notes:
// - Runtime columns are exactly migration 0003's DDL ("updatedAt" is never
//   exposed — memory rows carry no timestamps); schema.prisma's
//   preventOversell has no DDL column and no runtime field, so it stays out.
// - listCategories/listProducts replicate the memory Map insertion order via
//   ORDER BY "createdAt" ASC, "id" ASC.
// - update* builds the SET clause from the patch's provided keys only (the
//   services spread conditionally, so absent keys stay untouched) and always
//   stamps "updatedAt" = CURRENT_TIMESTAMP like every other family's writes.
const CATEGORY_COLUMNS = '"id", "businessId", "name", "description", "isActive"';
const PRODUCT_COLUMNS =
  '"id", "businessId", "familyId", "productType", "categoryId", "name", "sku", "barcode", "brand", "unit", "costMinor", ' +
  '"priceMinor", "taxRateBps", "reorderLevel", "trackInventory", "isActive", "imageUrl"';

// Column names come from the typed patch keys (never user input), so quoting
// them is safe. Keys explicitly set to undefined are skipped — the SQL NOT NULL
// columns could not take them, and no caller produces them.
function buildSet(patch: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`"${key}" = $${values.length}`);
  }
  return { sets, values };
}

export function catalogFamily(ctx: PgContext) {
  return {
    async createCategory(cat: Omit<DbCategory, "id">): Promise<DbCategory> {
      const c = await ctx.client();
      try {
        const row = { ...cat, id: nid("cat") };
        await c.query(
          'INSERT INTO "Category" ("id", "businessId", "name", "description", "isActive", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [row.id, row.businessId, row.name, row.description ?? null, row.isActive],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listCategories(businessId: string): Promise<DbCategory[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${CATEGORY_COLUMNS} FROM "Category" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbCategory[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findCategoryById(id: string, businessId: string): Promise<DbCategory | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${CATEGORY_COLUMNS} FROM "Category" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbCategory | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateCategory(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbCategory, "id" | "businessId">>,
    ): Promise<DbCategory | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Category" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${CATEGORY_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbCategory | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async createProduct(p: Omit<DbProduct, "id">): Promise<DbProduct> {
      const c = await ctx.client();
      try {
        const row = { ...p, id: nid("prod") };
        await c.query(
          'INSERT INTO "Product" ("id", "businessId", "familyId", "productType", "categoryId", "name", "sku", "barcode", "brand", "unit", "costMinor", "priceMinor", "taxRateBps", "reorderLevel", "trackInventory", "isActive", "imageUrl", "createdAt", "updatedAt")' +
            ' VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
          [
            row.id, row.businessId, row.familyId ?? null, row.productType ?? "STANDARD", row.categoryId ?? null, row.name, row.sku ?? null,
            row.barcode ?? null, row.brand ?? null, row.unit, row.costMinor, row.priceMinor,
            row.taxRateBps ?? null, row.reorderLevel, row.trackInventory, row.isActive, row.imageUrl ?? null,
          ],
        );
        return row;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async listProducts(businessId: string): Promise<DbProduct[]> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRODUCT_COLUMNS} FROM "Product" WHERE "businessId" = $1 ORDER BY "createdAt" ASC, "id" ASC`,
          [businessId],
        );
        return r.rows as DbProduct[];
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async findProductById(id: string, businessId: string): Promise<DbProduct | null> {
      const c = await ctx.client();
      try {
        const r = await c.query(
          `SELECT ${PRODUCT_COLUMNS} FROM "Product" WHERE "id" = $1 AND "businessId" = $2`,
          [id, businessId],
        );
        return (r.rows[0] as DbProduct | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },

    async updateProduct(
      id: string,
      businessId: string,
      patch: Partial<Omit<DbProduct, "id" | "businessId">>,
    ): Promise<DbProduct | null> {
      const c = await ctx.client();
      try {
        const { sets, values } = buildSet(patch);
        const r = await c.query(
          `UPDATE "Product" SET ${sets.length ? sets.join(", ") + ", " : ""}"updatedAt" = CURRENT_TIMESTAMP` +
            ` WHERE "id" = $${values.length + 1} AND "businessId" = $${values.length + 2}` +
            ` RETURNING ${PRODUCT_COLUMNS}`,
          [...values, id, businessId],
        );
        return (r.rows[0] as DbProduct | undefined) ?? null;
      } finally {
        if (ctx.owns()) c.release();
      }
    },
  };
}

export type CatalogFamily = ReturnType<typeof catalogFamily>;
