import { existsSync } from "node:fs";
const checks = [
  existsSync("apps/api/test/abuse.contract.test.ts"),
  existsSync("apps/api/test/abuse-payments.contract.test.ts"),
  existsSync("apps/api/test/hardening.contract.test.ts"),
  existsSync("apps/api/test/logging.test.ts"),
  existsSync("docs/superpowers/audits/2026-09-23-phase8-authorization.md"),
  existsSync("docs/superpowers/audits/2026-09-23-phase8-performance.md"),
  existsSync("docs/superpowers/runbooks/alerts.md"),
  existsSync("docs/superpowers/runbooks/backup-restore.md"),
  existsSync("docs/superpowers/runbooks/incidents.md"),
  existsSync("scripts/backup.sh"),
  existsSync("scripts/restore.sh"),
  existsSync("scripts/load/dashboard-mix.mjs"),
  existsSync("apps/api/test/load-cohort.test.ts"),
  existsSync("playwright.config.ts"),
  existsSync("e2e/critical-path.spec.ts"),
  existsSync("e2e/roles.spec.ts"),
  existsSync("tests/phase8-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE8_OK");
} else {
  console.error("PHASE8_MISSING");
  process.exit(1);
}
