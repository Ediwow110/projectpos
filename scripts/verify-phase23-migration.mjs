import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = "packages/database/prisma/migrations";
const migrationNames = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const phase23Names = migrationNames.filter((name) => /^003[6-9]_phase23_/.test(name));
if (phase23Names.length < 2) throw new Error("Phase 23 accounting and return cost migrations are required");

const sql = phase23Names.map((name) => readFileSync(join(migrationsDir, name, "migration.sql"), "utf8")).join("\n");
const required = [
  'CREATE TABLE "AccountingAccount"',
  'CREATE TABLE "JournalEntry"',
  'CREATE TABLE "JournalLine"',
  'CREATE TABLE "SupplierBill"',
  'CREATE TABLE "SupplierCredit"',
  'CREATE TABLE "SupplierPayment"',
  'CREATE TABLE "SupplierReturnReceiptAllocation"',
  'CREATE TABLE "AccountingBackfillRun"',
  'CREATE TABLE "AccountingBackfillIssue"',
  'ADD COLUMN "resolutionEvidence" TEXT',
  'CREATE TABLE "AccountingActivation"',
  'CREATE TRIGGER "JournalEntry_tenant_scope"',
  'CREATE TRIGGER "JournalLine_tenant_scope"',
  'CREATE TRIGGER "JournalEntry_immutable"',
  'CREATE TRIGGER "JournalLine_immutable"',
  '"billedInvoiceCostMinorSnapshot" BIGINT NOT NULL DEFAULT 0',
];
for (const fragment of required) {
  if (!sql.includes(fragment)) throw new Error(`Phase 23 migration is missing: ${fragment}`);
}
const expectedRlsTables = ["AccountingAccount", "JournalEntry", "JournalLine", "SupplierBill", "SupplierBillAllocation", "SupplierCredit", "SupplierPayment", "SupplierReturnReceiptAllocation", "AccountingBackfillRun", "AccountingBackfillIssue", "AccountingActivation"];
for (const table of expectedRlsTables) {
  if (!sql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)) throw new Error(`Phase 23 RLS is missing for ${table}`);
}
console.log("PHASE23_MIGRATION_OK");
