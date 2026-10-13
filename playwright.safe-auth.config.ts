import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated, synthetic-data E2E runner.
 *
 * - Starts its own in-memory API. DATABASE_URL is explicitly empty and
 *   NODE_ENV is development, so AppModule uses createMemoryDb().
 * - Disables outbound PayMongo and email credentials in the child process.
 * - Runs Next.js with an independent output directory, never clearing .next.
 * - Runs only the explicitly selected spec/project, not a full suite.
 *
 * Usage:
 *   pnpm exec playwright test e2e/critical-path.spec.ts
 *     --config=playwright.safe-auth.config.ts --project=desktop --workers=1
 */
const isolatedApiEnv: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL: "",
  PGTEST_BASE: "",
  API_PORT: "3101",
  WEB_URL: "http://localhost:3100",
  AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
  BILLING_ENABLED: "0",
  REGISTRATION_RATE_LIMIT: "1000",
  LOGIN_RATE_LIMIT: "1000",
  PAYMONGO_SECRET_KEY: "",
  PAYMONGO_WEBHOOK_SECRET: "",
  PAYMONGO_MANAGED_WEBHOOK: "0",
  PAYMONGO_WEBHOOK_DIAGNOSTICS: "0",
  PAYMONGO_CAPABILITY_DIAGNOSTICS: "0",
  // Disposable local-only operator credential for Phase D acceptance tests.
  PLATFORM_API_KEY: "phase-d-test-operator-key",
  // Disposable E2E-only 256-bit key for queued manager grants.
  // Production requires its own independently generated secret.
  APPROVAL_QUEUE_ENCRYPTION_KEY: "b7".repeat(32),
  BREVO_API_KEY: "",
  EMAIL_FROM: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  expect: { timeout: 15_000 },
  workers: 1,
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  use: { baseURL: "http://localhost:3100", trace: "off" },
  webServer: [
    {
      command: "pnpm --filter @pos/api exec tsx src/main.ts",
      url: "http://localhost:3101/readyz",
      reuseExistingServer: false,
      timeout: 120_000,
      env: isolatedApiEnv,
    },
    {
      command: "pnpm --filter @pos/web exec next dev -p 3100",
      url: "http://localhost:3100/login",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_DIST_DIR: ".next-release-auth",
        NEXT_PUBLIC_API_BASE: "http://localhost:3100",
        API_PROXY_TARGET: "http://localhost:3101",
        DATABASE_URL: "",
        PGTEST_BASE: "",
      },
    },
  ],
});
