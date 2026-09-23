import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/validation/src/reports.schema.ts"),
  existsSync("apps/api/src/reports/aggregate.ts"),
  existsSync("apps/api/src/reports/nest/reporting.service.ts"),
  existsSync("apps/api/src/reports/nest/reporting.controller.ts"),
  existsSync("apps/api/src/reports/nest/reporting.module.ts"),
  existsSync("apps/api/test/dashboard.contract.test.ts"),
  existsSync("apps/web/src/lib/reports.ts"),
  existsSync("apps/web/src/lib/charts.tsx"),
  existsSync("apps/web/src/app/reports/sales/page.tsx"),
  existsSync("apps/web/src/app/reports/cashiers/page.tsx"),
  existsSync("tests/phase7-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE7_OK");
} else {
  console.error("PHASE7_MISSING");
  process.exit(1);
}
