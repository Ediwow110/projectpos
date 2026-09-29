ALTER TABLE "SaleItem" ADD COLUMN "position" INTEGER;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "businessId", "saleId"
      ORDER BY "id" ASC
    ) - 1 AS "position"
  FROM "SaleItem"
)
UPDATE "SaleItem" AS item
SET "position" = ranked."position"
FROM ranked
WHERE item."id" = ranked."id";

ALTER TABLE "SaleItem"
  ALTER COLUMN "position" SET NOT NULL,
  ALTER COLUMN "position" SET DEFAULT 0;

CREATE INDEX "SaleItem_businessId_saleId_position_idx"
  ON "SaleItem"("businessId", "saleId", "position");
