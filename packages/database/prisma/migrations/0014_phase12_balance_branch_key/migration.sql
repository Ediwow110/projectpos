-- Phase 12: the runtime balance key is (businessId, productId, branchId) —
-- memory.db's balanceKey keeps one balance row per branch scope, so a product
-- can hold a head-office row AND per-branch rows at the same time (the
-- transfer flow requires it). The Phase 3 unique index below predates branch
-- scoping (Phase 9a only added the nullable column) and would forbid that
-- second row entirely. Replace it with a branch-aware unique index; NULLS
-- NOT DISTINCT (PG 15+, docker/CI run PG 16) keeps the head-office NULL
-- scope unique too, so INSERT ... ON CONFLICT ("businessId", "productId",
-- "branchId") can arbiter both NULL and non-NULL rows.
DROP INDEX "InventoryBalance_businessId_productId_key";

CREATE UNIQUE INDEX "InventoryBalance_businessId_productId_branchId_key"
  ON "InventoryBalance" ("businessId", "productId", "branchId")
  NULLS NOT DISTINCT;
