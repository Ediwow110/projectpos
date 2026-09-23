import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0009_phase9a_branches/migration.sql"),
  existsSync("packages/validation/src/branches.schema.ts"),
  existsSync("apps/api/src/branches/nest/branch.service.ts"),
  existsSync("apps/api/src/transfers/transfer-math.ts"),
  existsSync("apps/api/src/transfers/nest/transfer.service.ts"),
  existsSync("apps/api/src/branches/nest/branch.controller.ts"),
  existsSync("apps/api/src/transfers/nest/transfer.controller.ts"),
  existsSync("apps/api/test/branch.contract.test.ts"),
  existsSync("apps/api/test/transfer.contract.test.ts"),
  existsSync("apps/web/src/app/branches/page.tsx"),
  existsSync("apps/web/src/app/transfers/page.tsx"),
  existsSync("apps/web/src/app/reports/branches/page.tsx"),
  existsSync("tests/phase9a-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE9A_OK");
} else {
  console.error("PHASE9A_MISSING");
  process.exit(1);
}
