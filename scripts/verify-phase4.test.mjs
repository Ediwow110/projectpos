import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0005_phase4_sales/migration.sql"),
  existsSync("packages/validation/src/sales.schema.ts"),
  existsSync("apps/api/src/sales/totals.ts"),
  existsSync("apps/api/src/sales/state-machine.ts"),
  existsSync("apps/api/src/sales/idempotency.ts"),
  existsSync("apps/api/src/sales/nest/sales.service.ts"),
  existsSync("apps/api/src/sales/nest/sales.controller.ts"),
  existsSync("apps/api/src/sales/nest/sales.module.ts"),
  existsSync("apps/api/test/sales.contract.test.ts"),
  existsSync("apps/web/src/app/pos/page.tsx"),
  existsSync("apps/web/src/app/receipts/[saleId]/page.tsx"),
  existsSync("tests/phase4-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE4_OK");
} else {
  console.error("PHASE4_MISSING");
  process.exit(1);
}
