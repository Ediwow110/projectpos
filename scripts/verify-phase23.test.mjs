import { readFileSync } from "node:fs";

const checks = [
  ["apps/api/src/app.module.ts", "AccountingController"],
  ["apps/api/src/app.module.ts", "PayablesController"],
  ["apps/api/src/accounting/journal-posting.service.ts", "postSourceEvent"],
  ["apps/api/src/payables/payables.service.ts", "SUPPLIER_PAYMENT_EXCEEDS_BALANCE"],
  ["apps/api/src/procurement/nest/procurement.service.ts", "returnedBilledQuantityByReceiptLine"],
  ["packages/auth/src/permissions.ts", '"accounting.read"'],
  ["packages/auth/src/permissions.ts", '"payables.pay"'],
  ["apps/api/test/pg/pg-accounting.test.ts", "ACCOUNTING_LINE_TENANT_MISMATCH"],
];

for (const [path, expected] of checks) {
  if (!readFileSync(path, "utf8").includes(expected)) throw new Error(`${path} is missing required Phase 23 coverage: ${expected}`);
}
console.log("PHASE23_SOURCE_WIRING_OK");
