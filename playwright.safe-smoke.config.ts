import { defineConfig, devices } from "@playwright/test";

/**
 * Safe, bounded frontend smoke runner:
 * - runs only the web server, never API or migration commands
 * - does not remove or reuse the normal apps/web/.next directory
 * - disables proxy routing to any potentially inherited external API
 * - uses an independent generated output directory
 *
 * Usage: pnpm exec playwright test e2e/security-headers.spec.ts
 *   --config=playwright.safe-smoke.config.ts --project=desktop --workers=1
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  use: { baseURL: "http://127.0.0.1:3110", trace: "off" },
  webServer: {
    command: "pnpm --filter @pos/web exec next dev -p 3110",
    url: "http://127.0.0.1:3110/login",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_DIST_DIR: ".next-release-smoke",
      NEXT_PUBLIC_API_BASE: "http://127.0.0.1:3110",
      API_PROXY_TARGET: "",
      DATABASE_URL: "",
      PGTEST_BASE: "",
    },
  },
});
