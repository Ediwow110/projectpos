import { existsSync, readFileSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0012_phase11_closures/migration.sql"),
  existsSync("packages/validation/src/phase11.schema.ts"),
  existsSync("packages/validation/test/phase11.schema.test.ts"),
  existsSync("apps/api/src/common/audit.test.ts"),
  existsSync("apps/api/src/sales/payment-methods.ts"),
  existsSync("apps/api/src/sales/payment-methods.test.ts"),
  existsSync("apps/api/src/sales/receipt-text.ts"),
  existsSync("apps/api/src/sales/receipt-text.test.ts"),
  existsSync("apps/api/src/sales/nest/receipt-share.controller.ts"),
  existsSync("apps/api/src/memberships/nest/membership.service.ts"),
  existsSync("apps/api/src/memberships/nest/membership.controller.ts"),
  existsSync("apps/api/src/memberships/nest/membership.service.test.ts"),
  existsSync("apps/api/src/billing/nest/support-grant.service.ts"),
  existsSync("apps/api/src/billing/nest/support-grants.test.ts"),
  existsSync("apps/api/src/common/metrics.ts"),
  existsSync("apps/api/src/common/metrics.controller.ts"),
  existsSync("apps/api/src/common/metrics.middleware.ts"),
  existsSync("apps/api/src/common/metrics.test.ts"),
  existsSync("apps/api/test/email-verification.test.ts"),
  existsSync("apps/api/test/business-switch.contract.test.ts"),
  existsSync("tests/phase11-exit.test.ts"),
  // CI carries the phase 11 hygiene steps and this script.
  readFileSync(".github/workflows/ci.yml", "utf8").includes("pnpm build"),
  readFileSync(".github/workflows/ci.yml", "utf8").includes("pnpm audit --prod --audit-level critical"),
  readFileSync(".github/workflows/ci.yml", "utf8").includes("verify-phase11"),
];
if (checks.every(Boolean)) {
  console.log("PHASE11_OK");
} else {
  console.error("PHASE11_MISSING");
  process.exit(1);
}
