-- Phase 21: archive product option values without deleting historical dimensions.
ALTER TABLE "ProductOptionValue" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
