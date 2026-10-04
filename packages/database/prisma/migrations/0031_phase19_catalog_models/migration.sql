-- Phase 19: additive product families, variant option links, fixed bundles,
-- and sale-time bundle component snapshots. Product remains the stock-bearing
-- SKU; bundles deliberately do not create a physical balance.

ALTER TABLE "Product" ADD COLUMN "familyId" TEXT;
ALTER TABLE "Product" ADD COLUMN "productType" TEXT NOT NULL DEFAULT 'STANDARD';
CREATE INDEX "Product_businessId_familyId_isActive_idx" ON "Product"("businessId", "familyId", "isActive");

CREATE TABLE "ProductFamily" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "categoryId" TEXT,
  "brand" TEXT,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductFamily_businessId_name_key" ON "ProductFamily"("businessId", "name");
CREATE INDEX "ProductFamily_businessId_isActive_idx" ON "ProductFamily"("businessId", "isActive");
ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductFamily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ADD CONSTRAINT "Product_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProductOption" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductOption_businessId_familyId_name_key" ON "ProductOption"("businessId", "familyId", "name");
CREATE UNIQUE INDEX "ProductOption_businessId_familyId_position_key" ON "ProductOption"("businessId", "familyId", "position");
CREATE INDEX "ProductOption_businessId_familyId_idx" ON "ProductOption"("businessId", "familyId");
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOption" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "ProductOptionValue" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductOptionValue_businessId_optionId_value_key" ON "ProductOptionValue"("businessId", "optionId", "value");
CREATE UNIQUE INDEX "ProductOptionValue_businessId_optionId_position_key" ON "ProductOptionValue"("businessId", "optionId", "position");
CREATE INDEX "ProductOptionValue_businessId_optionId_idx" ON "ProductOptionValue"("businessId", "optionId");
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductOptionValue" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "ProductVariantOptionValue" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "optionValueId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductVariantOptionValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductVariantOptionValue_businessId_productId_optionId_key" ON "ProductVariantOptionValue"("businessId", "productId", "optionId");
CREATE UNIQUE INDEX "ProductVariantOptionValue_businessId_productId_optionValueId_key" ON "ProductVariantOptionValue"("businessId", "productId", "optionValueId");
CREATE INDEX "ProductVariantOptionValue_businessId_optionId_optionValueId_idx" ON "ProductVariantOptionValue"("businessId", "optionId", "optionValueId");
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantOptionValue" ADD CONSTRAINT "ProductVariantOptionValue_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "ProductOptionValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariantOptionValue" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "ProductBundle" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "bundleProductId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductBundle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductBundle_bundleProductId_key" ON "ProductBundle"("bundleProductId");
CREATE INDEX "ProductBundle_businessId_idx" ON "ProductBundle"("businessId");
ALTER TABLE "ProductBundle" ADD CONSTRAINT "ProductBundle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBundle" ADD CONSTRAINT "ProductBundle_bundleProductId_fkey" FOREIGN KEY ("bundleProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBundle" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "BundleComponent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "componentProductId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BundleComponent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BundleComponent_quantity_check" CHECK ("quantity" > 0)
);
CREATE UNIQUE INDEX "BundleComponent_businessId_bundleId_componentProductId_key" ON "BundleComponent"("businessId", "bundleId", "componentProductId");
CREATE INDEX "BundleComponent_businessId_bundleId_position_idx" ON "BundleComponent"("businessId", "bundleId", "position");
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProductBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BundleComponent" ADD CONSTRAINT "BundleComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BundleComponent" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "SaleItemBundleComponent" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "componentProductId" TEXT NOT NULL,
  "componentNameSnapshot" TEXT NOT NULL,
  "quantityPerBundleSnapshot" INTEGER NOT NULL,
  "costMinorSnapshot" INTEGER NOT NULL,
  "compositionVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleItemBundleComponent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleItemBundleComponent_businessId_saleItemId_idx" ON "SaleItemBundleComponent"("businessId", "saleItemId");
CREATE INDEX "SaleItemBundleComponent_businessId_bundleId_idx" ON "SaleItemBundleComponent"("businessId", "bundleId");
ALTER TABLE "SaleItemBundleComponent" ADD CONSTRAINT "SaleItemBundleComponent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItemBundleComponent" ADD CONSTRAINT "SaleItemBundleComponent_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItemBundleComponent" ADD CONSTRAINT "SaleItemBundleComponent_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProductBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItemBundleComponent" ADD CONSTRAINT "SaleItemBundleComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleItemBundleComponent" ENABLE ROW LEVEL SECURITY;
