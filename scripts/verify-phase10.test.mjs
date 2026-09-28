import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0011_phase10_billing/migration.sql"),
  existsSync("packages/validation/src/billing.schema.ts"),
  existsSync("apps/api/src/billing/entitlements.ts"),
  existsSync("apps/api/src/billing/platform-key.ts"),
  existsSync("apps/api/src/billing/nest/billing.service.ts"),
  existsSync("apps/api/src/billing/nest/billing.controller.ts"),
  existsSync("apps/api/src/billing/nest/platform.controller.ts"),
  existsSync("apps/api/src/payments/provider.ts"),
  existsSync("apps/api/src/exports/nest/export.service.ts"),
  existsSync("apps/api/src/exports/nest/export.controller.ts"),
  existsSync("apps/api/src/print/escpos.ts"),
  existsSync("apps/api/src/print/nest/print.controller.ts"),
  existsSync("apps/api/src/display/nest/display.controller.ts"),
  existsSync("apps/api/src/apitokens/api-token.guard.ts"),
  existsSync("apps/api/src/apitokens/nest/apitoken.service.ts"),
  existsSync("apps/api/src/apitokens/nest/apitoken.controller.ts"),
  existsSync("apps/api/test/plan-limits.contract.test.ts"),
  existsSync("apps/api/test/billing.contract.test.ts"),
  existsSync("apps/api/test/webhook.contract.test.ts"),
  existsSync("apps/api/test/export.contract.test.ts"),
  existsSync("apps/api/test/print-display.contract.test.ts"),
  existsSync("apps/api/test/apitoken.contract.test.ts"),
  existsSync("apps/web/src/lib/billing.ts"),
  existsSync("apps/web/test/billing.test.ts"),
  // Billing is intentionally disabled in the product UI. Keep checking the
  // shared billing error surface instead of the removed /billing page.
  existsSync("apps/web/src/lib/billing-ui.tsx"),
  existsSync("apps/web/src/app/platform/page.tsx"),
  existsSync("apps/web/src/app/display/page.tsx"),
  existsSync("e2e/offline.spec.ts"),
  existsSync("e2e/billing.spec.ts"),
  existsSync("tests/phase10-exit.test.ts"),
  existsSync("scripts/verify-phase10-migration.mjs"),
];
if (checks.every(Boolean)) {
  console.log("PHASE10_OK");
} else {
  console.error("PHASE10_MISSING");
  process.exit(1);
}
