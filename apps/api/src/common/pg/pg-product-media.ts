import type { DbProductMediaAsset, DbProductMediaInput } from "../db.port";
import { PRODUCT_MEDIA_ACTIVE_QUOTA_BYTES } from "../db.port";
import { nid, type PgContext } from "./context";
import { catalogFamily } from "./pg-catalog";
import { auditFamily } from "./pg-audit";

const ASSET_COLUMNS = '"id", "businessId", "productId", "actorId", "storagePath", "publicUrl", "contentType", "bytes", "width", "height", "state", "cleanupAttempts", "lastCleanupAt", "createdAt", "updatedAt"';

function assertMediaInput(input: DbProductMediaInput, businessId: string, productId: string): void {
  if (input.businessId !== businessId || input.productId !== productId || input.contentType !== "image/webp" ||
    !Number.isSafeInteger(input.bytes) || input.bytes <= 0 || input.bytes > 1024 * 1024 ||
    !Number.isInteger(input.width) || input.width < 1 || input.width > 1600 ||
    !Number.isInteger(input.height) || input.height < 1 || input.height > 1600 ||
    !input.storagePath.startsWith(`businesses/${businessId}/products/${productId}/`) ||
    !input.storagePath.endsWith(".webp")) throw new Error("PRODUCT_MEDIA_INVALID");
}

export function productMediaFamily(ctx: PgContext) {
  return {
    async getActiveProductMedia(businessId: string, productId: string): Promise<DbProductMediaAsset | null> {
      const client = await ctx.client();
      try {
        const result = await client.query(
          `SELECT ${ASSET_COLUMNS} FROM "ProductMediaAsset" WHERE "businessId"=$1 AND "productId"=$2 AND "state"='ACTIVE'`,
          [businessId, productId],
        );
        return (result.rows[0] as DbProductMediaAsset | undefined) ?? null;
      } finally {
        if (ctx.owns()) client.release();
      }
    },

    async replaceProductMediaAtomic(
      businessId: string, productId: string, expectedAssetId: string | null, input: DbProductMediaInput, requestId?: string,
    ) {
      assertMediaInput(input, businessId, productId);
      return ctx.withLock(`product-media-quota:${businessId}`, async () => {
        const client = await ctx.client();
        try {
          const product = await client.query(
            'SELECT "id" FROM "Product" WHERE "businessId"=$1 AND "id"=$2 FOR UPDATE',
            [businessId, productId],
          );
          if (!product.rows.length) throw new Error("NOT_FOUND");
          const current = await client.query(
            `SELECT ${ASSET_COLUMNS} FROM "ProductMediaAsset" WHERE "businessId"=$1 AND "productId"=$2 AND "state"='ACTIVE' FOR UPDATE`,
            [businessId, productId],
          );
          const oldAsset = (current.rows[0] as DbProductMediaAsset | undefined) ?? null;
          if ((oldAsset?.id ?? null) !== expectedAssetId) throw new Error("PRODUCT_MEDIA_CONFLICT");
          const total = await client.query<{ size: string }>(
            `SELECT COALESCE(SUM("bytes"),0)::text AS size FROM "ProductMediaAsset" WHERE "businessId"=$1 AND "state"='ACTIVE'`,
            [businessId],
          );
          const activeBytes = Number(total.rows[0]?.size ?? 0);
          if (activeBytes - (oldAsset?.bytes ?? 0) + input.bytes > PRODUCT_MEDIA_ACTIVE_QUOTA_BYTES) {
            throw new Error("PRODUCT_MEDIA_QUOTA");
          }
          if (oldAsset) await client.query(
            `UPDATE "ProductMediaAsset" SET "state"='SUPERSEDED', "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "businessId"=$2`,
            [oldAsset.id, businessId],
          );
          const assetId = nid("media");
          const result = await client.query(
            `INSERT INTO "ProductMediaAsset" ("id", "businessId", "productId", "actorId", "storagePath", "publicUrl", "contentType", "bytes", "width", "height", "state") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE') RETURNING ${ASSET_COLUMNS}`,
            [assetId, businessId, productId, input.actorId, input.storagePath, input.publicUrl,
              input.contentType, input.bytes, input.width, input.height],
          );
          await client.query(
            'UPDATE "Product" SET "imageUrl"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE "businessId"=$2 AND "id"=$3',
            [input.publicUrl, businessId, productId],
          );
          const updated = await catalogFamily(ctx).findProductById(productId, businessId);
          if (!updated) throw new Error("NOT_FOUND");
          if (requestId) await auditFamily(ctx).appendAudit({
            businessId, actorId: input.actorId, action: "product.media.upload",
            entityType: "Product", entityId: productId, requestId,
          });
          return { product: updated, asset: result.rows[0] as DbProductMediaAsset, oldAsset };
        } finally {
          if (ctx.owns()) client.release();
        }
      });
    },

    async detachProductMediaAtomic(businessId: string, productId: string, expectedAssetId: string | null, actorId?: string, requestId?: string) {
      return ctx.withLock(`product-media-quota:${businessId}`, async () => {
        const client = await ctx.client();
        try {
          const product = await client.query(
            'SELECT "id" FROM "Product" WHERE "businessId"=$1 AND "id"=$2 FOR UPDATE',
            [businessId, productId],
          );
          if (!product.rows.length) throw new Error("NOT_FOUND");
          const result = await client.query(
            `SELECT ${ASSET_COLUMNS} FROM "ProductMediaAsset" WHERE "businessId"=$1 AND "productId"=$2 AND "state"='ACTIVE' FOR UPDATE`,
            [businessId, productId],
          );
          const oldAsset = (result.rows[0] as DbProductMediaAsset | undefined) ?? null;
          if ((oldAsset?.id ?? null) !== expectedAssetId) throw new Error("PRODUCT_MEDIA_CONFLICT");
          if (oldAsset) await client.query(
            `UPDATE "ProductMediaAsset" SET "state"='PENDING_DELETE', "updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "businessId"=$2`,
            [oldAsset.id, businessId],
          );
          await client.query(
            'UPDATE "Product" SET "imageUrl"=NULL, "updatedAt"=CURRENT_TIMESTAMP WHERE "businessId"=$1 AND "id"=$2',
            [businessId, productId],
          );
          const updated = await catalogFamily(ctx).findProductById(productId, businessId);
          if (!updated) throw new Error("NOT_FOUND");
          if (actorId && requestId) await auditFamily(ctx).appendAudit({
            businessId, actorId, action: "product.media.remove",
            entityType: "Product", entityId: productId, requestId,
          });
          return { product: updated, oldAsset };
        } finally {
          if (ctx.owns()) client.release();
        }
      });
    },

    async listProductMediaCleanupCandidates(limit: number): Promise<DbProductMediaAsset[]> {
      const client = await ctx.client();
      try {
        const result = await client.query(
          `SELECT ${ASSET_COLUMNS} FROM "ProductMediaAsset" WHERE "state" <> 'ACTIVE' ORDER BY "updatedAt", "id" LIMIT $1`,
          [Math.max(0, Math.min(100, Math.floor(limit) || 0))],
        );
        return result.rows as DbProductMediaAsset[];
      } finally {
        if (ctx.owns()) client.release();
      }
    },

    async markProductMediaCleanupResult(businessId: string, assetId: string, succeeded: boolean): Promise<void> {
      const client = await ctx.client();
      try {
        if (succeeded) {
          await client.query(
            `DELETE FROM "ProductMediaAsset" WHERE "businessId"=$1 AND "id"=$2 AND "state"<>'ACTIVE'`,
            [businessId, assetId],
          );
        } else {
          await client.query(
            `UPDATE "ProductMediaAsset" SET "cleanupAttempts"="cleanupAttempts"+1, "lastCleanupAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP WHERE "businessId"=$1 AND "id"=$2 AND "state"<>'ACTIVE'`,
            [businessId, assetId],
          );
        }
      } finally {
        if (ctx.owns()) client.release();
      }
    },
  };
}
