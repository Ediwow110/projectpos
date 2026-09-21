import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0003_phase2_catalog/migration.sql"),
  existsSync("packages/validation/src/catalog.schema.ts"),
  existsSync("apps/api/src/catalog/normalize.ts"),
  existsSync("apps/api/src/catalog/search.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.service.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.controller.ts"),
  existsSync("apps/api/src/catalog/nest/catalog.module.ts"),
  existsSync("apps/api/test/catalog.contract.test.ts"),
  existsSync("apps/web/src/app/products/page.tsx"),
  existsSync("apps/web/src/app/categories/page.tsx"),
  existsSync("tests/phase2-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE2_OK");
} else {
  console.error("PHASE2_MISSING");
  process.exit(1);
}
