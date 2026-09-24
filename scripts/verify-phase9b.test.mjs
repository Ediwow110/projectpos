import { existsSync } from "node:fs";
const checks = [
  existsSync("packages/database/prisma/migrations/0010_phase9b_devices/migration.sql"),
  existsSync("packages/validation/src/sync.schema.ts"),
  existsSync("apps/api/src/devices/nest/device.service.ts"),
  existsSync("apps/api/src/sync/nest/sync.service.ts"),
  existsSync("apps/api/src/devices/nest/device.controller.ts"),
  existsSync("apps/api/src/sync/nest/sync.controller.ts"),
  existsSync("apps/api/test/device.contract.test.ts"),
  existsSync("apps/api/test/sync.contract.test.ts"),
  existsSync("apps/web/src/lib/sync-state.ts"),
  existsSync("apps/web/src/lib/sync-store.ts"),
  existsSync("apps/web/src/lib/replay.ts"),
  existsSync("apps/web/src/lib/replay-sale.ts"),
  existsSync("apps/web/src/lib/connectivity.ts"),
  existsSync("apps/web/src/lib/sync-ui.tsx"),
  existsSync("apps/web/src/app/sync/page.tsx"),
  existsSync("e2e/offline.spec.ts"),
  existsSync("tests/phase9b-exit.test.ts"),
];
if (checks.every(Boolean)) {
  console.log("PHASE9B_OK");
} else {
  console.error("PHASE9B_MISSING");
  process.exit(1);
}
