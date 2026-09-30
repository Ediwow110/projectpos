import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  workers: 2,
  use: {
    baseURL: "http://localhost:3100",
    // Playwright 1.63 on Windows can race its retained-trace network files
    // during context teardown (ENOENT after otherwise-passing offline tests).
    // CI runs on Linux and keeps failure traces there.
    trace: process.platform === "win32" ? "off" : "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 1366 } } },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @pos/api exec tsx src/main.ts",
      port: 3101,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        API_PORT: "3101",
        WEB_URL: "http://localhost:3100",
        REGISTRATION_RATE_LIMIT: "1000",
        AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
        BILLING_ENABLED: "0",
        // Platform routes are key-authed, not session-authed: the e2e suite
        // drives them through the /platform page, so the key must exist in
        // the dev API the browser talks to.
        PLATFORM_API_KEY: process.env["PLATFORM_API_KEY"] ?? "test-platform-key",
        BILLING_TEST_DOUBLE_SECRET: process.env["BILLING_TEST_DOUBLE_SECRET"] ?? "test-webhook-secret",
      } as Record<string, string>,
    },
    {
      // A production `next build` and `next dev` use different artifacts in
      // the same .next directory. Clear that generated cache before E2E dev
      // startup so a build->browser-test sequence cannot cross-contaminate.
      command: "node -e \"require('fs').rmSync('apps/web/.next',{recursive:true,force:true})\" && pnpm --filter @pos/web exec next dev -p 3100",
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        // Match production's same-origin browser contract: Next proxies
        // /api/* to the API service, so navigation-based endpoints such as
        // CSV exports behave exactly like normal apiFetch calls.
        NEXT_PUBLIC_API_BASE: "http://localhost:3100",
        API_PROXY_TARGET: "http://localhost:3101",
      } as Record<string, string>,
    },
  ],
});
