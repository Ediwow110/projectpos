import type {
  DbBundleComponent,
  DbProductBundle,
  DbProductFamily,
  DbProductOption,
  DbProductOptionValue,
  DbProductVariantOptionValue,
  DbSaleItemBundleComponent,
} from "../db.port";
import { nid, type PgContext } from "./context";

const FAMILY = '"id", "businessId", "name", "categoryId", "brand", "description", "isActive", "createdAt", "updatedAt"';
const OPTION = '"id", "businessId", "familyId", "name", "position", "createdAt", "updatedAt"';
const VALUE = '"id", "businessId", "optionId", "value", "position", "isActive", "createdAt", "updatedAt"';
const LINK = '"id", "businessId", "productId", "optionId", "optionValueId", "createdAt"';
const BUNDLE = '"id", "businessId", "bundleProductId", "version", "createdAt", "updatedAt"';
const COMPONENT = '"id", "businessId", "bundleId", "componentProductId", "quantity", "position", "createdAt", "updatedAt"';
const SNAPSHOT = '"id", "businessId", "saleItemId", "bundleId", "componentProductId", "componentNameSnapshot", "quantityPerBundleSnapshot", "costMinorSnapshot", "compositionVersion", "createdAt"';

export function productModelFamily(ctx: PgContext) {
  async function one<T>(fn: (c: any) => Promise<T>): Promise<T> {
    const c = await ctx.client();
    try { return await fn(c); } finally { if (ctx.owns()) c.release(); }
  }
  return {
    async createProductFamily(f: Omit<DbProductFamily, "id" | "createdAt" | "updatedAt">): Promise<DbProductFamily> {
      const row = { ...f, id: nid("pfam"), createdAt: new Date(), updatedAt: new Date() };
      await one((c) => c.query('INSERT INTO "ProductFamily" ("id","businessId","name","categoryId","brand","description","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)', [row.id,row.businessId,row.name,row.categoryId,row.brand,row.description,row.isActive])); return row;
    },
    async listProductFamilies(businessId: string) { return one(async (c) => (await c.query(`SELECT ${FAMILY} FROM "ProductFamily" WHERE "businessId"=$1 ORDER BY "createdAt","id"`, [businessId])).rows as DbProductFamily[]); },
    async findProductFamilyById(id: string, businessId: string) { return one(async (c) => ((await c.query(`SELECT ${FAMILY} FROM "ProductFamily" WHERE "id"=$1 AND "businessId"=$2`, [id,businessId])).rows[0] as DbProductFamily | undefined) ?? null); },
    async updateProductFamily(id: string, businessId: string, patch: Partial<Omit<DbProductFamily, "id" | "businessId" | "createdAt">>) {
      const entries = Object.entries(patch).filter(([,v]) => v !== undefined); const sets = entries.map(([k],i) => `"${k}"=$${i+1}`); const values = entries.map(([,v]) => v);
      return one(async (c) => ((await c.query(`UPDATE "ProductFamily" SET ${sets.length ? sets.join(",") + "," : ""}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} RETURNING ${FAMILY}`, [...values,id,businessId])).rows[0] as DbProductFamily | undefined) ?? null);
    },
    async createProductOption(o: Omit<DbProductOption, "id" | "createdAt" | "updatedAt">): Promise<DbProductOption> { const row={...o,id:nid("popt"),createdAt:new Date(),updatedAt:new Date()}; await one(c=>c.query('INSERT INTO "ProductOption" ("id","businessId","familyId","name","position","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.familyId,row.name,row.position])); return row; },
    async listProductOptions(familyId: string, businessId: string) { return one(async c => (await c.query(`SELECT ${OPTION} FROM "ProductOption" WHERE "familyId"=$1 AND "businessId"=$2 ORDER BY "position","id"`,[familyId,businessId])).rows as DbProductOption[]); },
    async findProductOptionById(id: string, businessId: string) { return one(async c => ((await c.query(`SELECT ${OPTION} FROM "ProductOption" WHERE "id"=$1 AND "businessId"=$2`,[id,businessId])).rows[0] as DbProductOption | undefined) ?? null); },
    async updateProductOption(id: string, businessId: string, patch: Partial<Pick<DbProductOption, "name" | "position">>) { const entries=Object.entries(patch).filter(([,v])=>v !== undefined); const sets=entries.map(([k],i)=>`"${k}"=$${i+1}`); const values=entries.map(([,v])=>v); return one(async c=>((await c.query(`UPDATE "ProductOption" SET ${sets.length ? sets.join(",")+"," : ""}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} RETURNING ${OPTION}`,[...values,id,businessId])).rows[0] as DbProductOption | undefined) ?? null); },
    async createProductOptionValue(v: Omit<DbProductOptionValue, "id" | "createdAt" | "updatedAt">): Promise<DbProductOptionValue> { const row={...v,isActive:v.isActive ?? true,id:nid("pval"),createdAt:new Date(),updatedAt:new Date()}; await one(c=>c.query('INSERT INTO "ProductOptionValue" ("id","businessId","optionId","value","position","isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.optionId,row.value,row.position,row.isActive])); return row; },
    async listProductOptionValues(optionId: string, businessId: string) { return one(async c => (await c.query(`SELECT ${VALUE} FROM "ProductOptionValue" WHERE "optionId"=$1 AND "businessId"=$2 ORDER BY "position","id"`,[optionId,businessId])).rows as DbProductOptionValue[]); },
    async findProductOptionValueById(id: string, businessId: string) { return one(async c => ((await c.query(`SELECT ${VALUE} FROM "ProductOptionValue" WHERE "id"=$1 AND "businessId"=$2`,[id,businessId])).rows[0] as DbProductOptionValue | undefined) ?? null); },
    async updateProductOptionValue(id: string, businessId: string, patch: Partial<Pick<DbProductOptionValue, "isActive">>) { const entries=Object.entries(patch).filter(([,v])=>v !== undefined); const sets=entries.map(([k],i)=>`"${k}"=$${i+1}`); const values=entries.map(([,v])=>v); return one(async c=>((await c.query(`UPDATE "ProductOptionValue" SET ${sets.length ? sets.join(",")+"," : ""}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} RETURNING ${VALUE}`,[...values,id,businessId])).rows[0] as DbProductOptionValue | undefined) ?? null); },
    async createVariantOptionValue(v: Omit<DbProductVariantOptionValue, "id" | "createdAt">): Promise<DbProductVariantOptionValue> { const row={...v,id:nid("pvo"),createdAt:new Date()}; await one(c=>c.query('INSERT INTO "ProductVariantOptionValue" ("id","businessId","productId","optionId","optionValueId","createdAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.productId,row.optionId,row.optionValueId])); return row; },
    async listVariantOptionValues(productId: string, businessId: string) { return one(async c => (await c.query(`SELECT ${LINK} FROM "ProductVariantOptionValue" WHERE "productId"=$1 AND "businessId"=$2`,[productId,businessId])).rows as DbProductVariantOptionValue[]); },
    async deleteVariantOptionValues(productId: string, businessId: string) { await one(c=>c.query('DELETE FROM "ProductVariantOptionValue" WHERE "productId"=$1 AND "businessId"=$2',[productId,businessId])); },
    async createProductBundle(b: Omit<DbProductBundle, "id" | "createdAt" | "updatedAt">): Promise<DbProductBundle> { const row={...b,id:nid("bun"),createdAt:new Date(),updatedAt:new Date()}; await one(c=>c.query('INSERT INTO "ProductBundle" ("id","businessId","bundleProductId","version","createdAt","updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.bundleProductId,row.version])); return row; },
    async findProductBundleByProductId(productId: string, businessId: string) { return one(async c=>((await c.query(`SELECT ${BUNDLE} FROM "ProductBundle" WHERE "bundleProductId"=$1 AND "businessId"=$2`,[productId,businessId])).rows[0] as DbProductBundle | undefined) ?? null); },
    async findProductBundleById(id: string, businessId: string) { return one(async c=>((await c.query(`SELECT ${BUNDLE} FROM "ProductBundle" WHERE "id"=$1 AND "businessId"=$2`,[id,businessId])).rows[0] as DbProductBundle | undefined) ?? null); },
    async updateProductBundle(id: string, businessId: string, patch: Partial<Omit<DbProductBundle, "id" | "businessId" | "createdAt">>) { const entries=Object.entries(patch).filter(([,v])=>v!==undefined); const sets=entries.map(([k],i)=>`"${k}"=$${i+1}`); const values=entries.map(([,v])=>v); return one(async c=>((await c.query(`UPDATE "ProductBundle" SET ${sets.length?sets.join(",")+",":""}"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$${values.length+1} AND "businessId"=$${values.length+2} RETURNING ${BUNDLE}`,[...values,id,businessId])).rows[0] as DbProductBundle|undefined)??null); },
    async createBundleComponent(cmp: Omit<DbBundleComponent, "id" | "createdAt" | "updatedAt">): Promise<DbBundleComponent> { const row={...cmp,id:nid("bc"),createdAt:new Date(),updatedAt:new Date()}; await one(c=>c.query('INSERT INTO "BundleComponent" ("id","businessId","bundleId","componentProductId","quantity","position","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.bundleId,row.componentProductId,row.quantity,row.position])); return row; },
    async listBundleComponents(bundleId: string, businessId: string) { return one(async c=>(await c.query(`SELECT ${COMPONENT} FROM "BundleComponent" WHERE "bundleId"=$1 AND "businessId"=$2 ORDER BY "position","id"`,[bundleId,businessId])).rows as DbBundleComponent[]); },
    async deleteBundleComponents(bundleId: string, businessId: string) { await one(c=>c.query('DELETE FROM "BundleComponent" WHERE "bundleId"=$1 AND "businessId"=$2',[bundleId,businessId])); },
    async createSaleItemBundleComponent(s: Omit<DbSaleItemBundleComponent, "id" | "createdAt">): Promise<DbSaleItemBundleComponent> { const row={...s,id:nid("sbc"),createdAt:new Date()}; await one(c=>c.query('INSERT INTO "SaleItemBundleComponent" ("id","businessId","saleItemId","bundleId","componentProductId","componentNameSnapshot","quantityPerBundleSnapshot","costMinorSnapshot","compositionVersion","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',[row.id,row.businessId,row.saleItemId,row.bundleId,row.componentProductId,row.componentNameSnapshot,row.quantityPerBundleSnapshot,row.costMinorSnapshot,row.compositionVersion])); return row; },
    async listSaleItemBundleComponents(saleItemId: string, businessId: string) { return one(async c=>(await c.query(`SELECT ${SNAPSHOT} FROM "SaleItemBundleComponent" WHERE "saleItemId"=$1 AND "businessId"=$2 ORDER BY "id"`,[saleItemId,businessId])).rows as DbSaleItemBundleComponent[]); },
  };
}

export type ProductModelFamily = ReturnType<typeof productModelFamily>;
