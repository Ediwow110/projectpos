import { readFileSync, existsSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const checks = [
  pkg.private === true,
  existsSync("packages/types/src/money.ts"),
  existsSync("packages/types/src/api.ts"),
  existsSync("packages/types/src/tenant.ts"),
  existsSync("packages/types/src/audit.ts"),
  existsSync("packages/validation/src/money.schema.ts"),
  existsSync("packages/validation/src/api.schema.ts"),
  existsSync("packages/config/src/env.ts"),
  existsSync("packages/database/prisma/schema.prisma"),
  existsSync("packages/database/src/tenant.ts"),
  existsSync("packages/auth/src/session.ts"),
  existsSync("packages/auth/src/permissions.ts"),
  existsSync("apps/api/src/tenant.guard.ts"),
  existsSync("apps/api/src/routes/me.ts"),
  existsSync("apps/api/src/routes/health.ts"),
  existsSync("apps/web/src/status.ts"),
  existsSync("tests/phase0-exit.test.ts"),
];
if (checks.every(Boolean)) { console.log("PHASE0_OK"); } else { console.error("PHASE0_MISSING"); process.exit(1); }
