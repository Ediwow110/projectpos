import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0004_phase3_inventory/migration.sql"),
  existsSync("packages/validation/src/inventory.schema.ts"),
  existsSync("apps/api/src/inventory/signs.ts"),
  existsSync("apps/api/src/inventory/projection.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.service.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.controller.ts"),
  existsSync("apps/api/src/inventory/nest/inventory.module.ts"),
  existsSync("apps/api/test/inventory.contract.test.ts"),
  existsSync("apps/web/src/app/inventory/page.tsx"),
  existsSync("tests/phase3-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE3_OK");
} else {
  console.error("PHASE3_MISSING");
  process.exit(1);
}
