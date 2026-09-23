import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0007_phase6_care/migration.sql"),
  existsSync("packages/validation/src/customers.schema.ts"),
  existsSync("packages/validation/src/refunds.schema.ts"),
  existsSync("packages/validation/src/expenses.schema.ts"),
  existsSync("apps/api/src/customers/nest/customer.service.ts"),
  existsSync("apps/api/src/refunds/nest/refund.service.ts"),
  existsSync("apps/api/src/expenses/nest/expense.service.ts"),
  existsSync("apps/api/src/customers/nest/customer.controller.ts"),
  existsSync("apps/api/src/refunds/nest/refund.controller.ts"),
  existsSync("apps/api/src/expenses/nest/expense.controller.ts"),
  existsSync("apps/api/test/customer.contract.test.ts"),
  existsSync("apps/api/test/refund.contract.test.ts"),
  existsSync("apps/api/test/expense.contract.test.ts"),
  existsSync("apps/web/src/app/sales/page.tsx"),
  existsSync("apps/web/src/app/customers/page.tsx"),
  existsSync("apps/web/src/app/expenses/page.tsx"),
  existsSync("tests/phase6-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE6_OK");
} else {
  console.error("PHASE6_MISSING");
  process.exit(1);
}
