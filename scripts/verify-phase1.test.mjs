import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0002_phase1_auth/migration.sql"),
  existsSync("packages/validation/src/auth.schema.ts"),
  existsSync("apps/api/src/auth/password.ts"),
  existsSync("apps/api/src/auth/sessions.ts"),
  existsSync("apps/api/src/auth/reset-tokens.ts"),
  existsSync("apps/api/src/auth/csrf.ts"),
  existsSync("apps/api/src/tenant/seed.ts"),
  existsSync("apps/api/src/business/onboarding.ts"),
  existsSync("apps/api/src/app.module.ts"),
  existsSync("apps/web/src/app/page.tsx"),
  existsSync("tests/phase1-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE1_OK");
} else {
  console.error("PHASE1_MISSING");
  process.exit(1);
}
