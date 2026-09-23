import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @pos/api exec tsx src/main.ts",
      port: 3001,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...process.env, API_PORT: "3001" } as Record<string, string>,
    },
    {
      command: "pnpm --filter @pos/web exec next dev -p 3000",
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...process.env, NEXT_PUBLIC_API_BASE: "http://localhost:3001" } as Record<string, string>,
    },
  ],
});
