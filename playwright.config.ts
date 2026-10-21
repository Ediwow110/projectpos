import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const externalServers = process.env["E2E_EXTERNAL_SERVERS"] === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    // CI runs the full suite against Next dev servers with two workers. The
    // first request to a route may include compilation and API warm-up, so
    // keep locator assertions aligned with the suite's cold-start tolerance.
    timeout: 15_000,
  },
  // Two concurrent browser workers can destabilize Playwright-owned Next/API
  // dev servers on Windows during the full multi-project matrix (transient
  // connection-refused/setup failures across otherwise-unrelated specs).
  // Keep CI/Linux parallel, but serialize Windows locally for deterministic
  // closure evidence without adding retries or weakening assertions.
  workers: process.platform === "win32" ? 1 : 2,
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
    {
      // POS-01 checkout-failure coverage requires the 820px breakpoint too.
      // Scoped by testMatch so the rest of the suite keeps its three projects.
      name: "mobile-wide",
      testMatch: /pos-checkout-failure\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } },
    },
  ],
  webServer: externalServers ? undefined : [
    {
      // Launch through the API package so its local tsx devDependency is
      // resolved from apps/api/node_modules rather than the workspace root.
      command: "pnpm --filter @pos/api start",
      port: 3101,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "development",
        TSX_TSCONFIG_PATH: resolve(process.cwd(), "apps/api/tsconfig.json"),
        API_PORT: "3101",
        WEB_URL: "http://localhost:3100",
        REGISTRATION_RATE_LIMIT: "1000",
        // The login brake counts every attempt per IP, successful ones
        // included. A full e2e run creates many disposable identities and
        // signs them in from one loopback address, so the production 5/min
        // would be spent before the flows under test even start.
        LOGIN_RATE_LIMIT: "1000",
        AUTH_REQUIRE_EMAIL_VERIFICATION: "0",
        BILLING_ENABLED: "0",
        // Platform routes are key-authed, not session-authed: the e2e suite
        // drives them through the /platform page, so the key must exist in
        // the dev API the browser talks to.
        PLATFORM_API_KEY: process.env["PLATFORM_API_KEY"] ?? "test-platform-key",
        BILLING_TEST_DOUBLE_SECRET: process.env["BILLING_TEST_DOUBLE_SECRET"] ?? "test-webhook-secret",
        // Keep direct focused Playwright runs aligned with scripts/run-e2e.mjs.
        APPROVAL_QUEUE_ENCRYPTION_KEY: process.env["APPROVAL_QUEUE_ENCRYPTION_KEY"] ?? "a4".repeat(32),
      } as Record<string, string>,
    },
    {
      // The e2e runner prepares the same standard production build path used
      // by normal Next builds before Playwright starts. Keep the long-lived
      // webServer process to serving only; chaining build + start inside
      // Playwright is unstable on Windows shells.
      command: "node apps/web/node_modules/next/dist/bin/next start apps/web -p 3100",
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: "production",
        // Match production's same-origin browser contract: Next proxies
        // /api/* to the API service, so navigation-based endpoints such as
        // CSV exports behave exactly like normal apiFetch calls.
        NEXT_PUBLIC_API_BASE: "http://localhost:3100",
        API_PROXY_TARGET: "http://localhost:3101",
      } as Record<string, string>,
    },
  ],
});
