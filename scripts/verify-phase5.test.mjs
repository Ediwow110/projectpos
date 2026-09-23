import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0006_phase5_shifts/migration.sql"),
  existsSync("packages/validation/src/shifts.schema.ts"),
  existsSync("apps/api/src/shifts/cash.ts"),
  existsSync("apps/api/src/shifts/nest/shift.service.ts"),
  existsSync("apps/api/src/shifts/nest/shift.controller.ts"),
  existsSync("apps/api/src/shifts/nest/shift.module.ts"),
  existsSync("apps/api/test/shift.contract.test.ts"),
  existsSync("apps/web/src/app/registers/page.tsx"),
  existsSync("apps/web/src/app/shifts/page.tsx"),
  existsSync("apps/web/src/app/shifts/[id]/page.tsx"),
  existsSync("tests/phase5-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE5_OK");
} else {
  console.error("PHASE5_MISSING");
  process.exit(1);
}
