-- Atlas V4 managed product media. Public images live in object storage, not in SQL.
-- NexPOS owns tenant authorization; do not expose this table through Supabase's Data API.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_businessId_id_media_key" ON "Product" ("businessId", "id");

CREATE TABLE "ProductMediaAsset" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL UNIQUE,
  "publicUrl" TEXT NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'image/webp',
  "bytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACTIVE',
  "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  "lastCleanupAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductMediaAsset_business_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductMediaAsset_product_tenant_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE CASCADE,
  CONSTRAINT "ProductMediaAsset_media_type_check" CHECK ("contentType" = 'image/webp'),
  CONSTRAINT "ProductMediaAsset_bytes_check" CHECK ("bytes" > 0 AND "bytes" <= 1048576),
  CONSTRAINT "ProductMediaAsset_dimensions_check" CHECK ("width" BETWEEN 1 AND 1600 AND "height" BETWEEN 1 AND 1600),
  CONSTRAINT "ProductMediaAsset_state_check" CHECK ("state" IN ('ACTIVE', 'SUPERSEDED', 'PENDING_DELETE')),
  CONSTRAINT "ProductMediaAsset_cleanup_check" CHECK ("cleanupAttempts" >= 0)
);

CREATE UNIQUE INDEX "ProductMediaAsset_business_product_active_key"
  ON "ProductMediaAsset" ("businessId", "productId") WHERE "state" = 'ACTIVE';
CREATE INDEX "ProductMediaAsset_business_state_idx" ON "ProductMediaAsset" ("businessId", "state");
CREATE INDEX "ProductMediaAsset_cleanup_queue_idx" ON "ProductMediaAsset" ("updatedAt") WHERE "state" <> 'ACTIVE';
ALTER TABLE "ProductMediaAsset" ENABLE ROW LEVEL SECURITY;
