// Phase 10 SaaS billing E2E (PLAN.md 16.2 and 17): trial on registration ->
// plan/usage surface -> public API token (one-time secret, scoped, revocable)
// -> platform operator plan change. Cap enforcement itself is server-side and
// covered by apps/api/test/plan-limits.contract.test.ts.
import { expect, test } from "@playwright/test";
import { API, registerBusiness } from "./helpers";

const PLATFORM_KEY = process.env["PLATFORM_API_KEY"] ?? "test-platform-key";

async function currentBusinessId(page): Promise<string> {
  const res = await page.request.get(`${API}/api/v1/me`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { businessId: string }).businessId;
}

test("registration starts a Pro trial surfaced on dashboard and billing", async ({ page }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Trial E2E Owner",
    email: `e2e-trial-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Trial Store ${stamp}`,
  });

  // Cold dashboard load: no client-side crash, trial countdown visible.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: `Trial Store ${stamp}` })).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Pro trial: \d+ day\(s\) left/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Billing" })).toBeVisible();

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Plan: pro" })).toBeVisible();
  await expect(page.getByText(/Status: trialing — \d+ trial day\(s\) left/)).toBeVisible();
  await expect(page.getByText("Users: 1 / 50 (2%)")).toBeVisible();
  await expect(page.getByText("Products: 0 / 20000 (0%)")).toBeVisible();
  await expect(page.getByText("No invoices yet.")).toBeVisible();
});

test("billing page mints a scoped API token that works, then revoke kills it", async ({ page, request }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Token E2E Owner",
    email: `e2e-token-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Token Store ${stamp}`,
  });

  await page.goto("/billing");
  await page.getByLabel("Token name").fill("E2E reader");
  await page.getByRole("checkbox", { name: "catalog:read" }).check();
  await page.getByRole("button", { name: "Mint token" }).click();

  const secretText = await page.getByText(/New token secret \(shown once\): pos_/).innerText();
  const secret = secretText.replace(/.*: /, "").trim();
  expect(secret).toMatch(/^pos_[0-9a-f]{8}_[0-9a-f]{64}$/);

  // Public API: Bearer token with catalog:read reaches GET /products.
  const okRes = await request.get(`${API}/api/v1/products`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(okRes.status()).toBe(200);

  // Scope discipline: this token lacks reports:read.
  const denied = await request.get(`${API}/api/v1/reports/sales?range=today&compare=none`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(denied.status()).toBe(403);

  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("(revoked)")).toBeVisible();

  const afterRevoke = await request.get(`${API}/api/v1/products`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(afterRevoke.status()).toBe(401);
});

test("platform operator changes the plan and billing reflects it", async ({ page }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Ops E2E Owner",
    email: `e2e-ops-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Ops Store ${stamp}`,
  });
  const businessId = await currentBusinessId(page);

  await page.goto("/platform");
  await page.getByLabel("Platform key").fill(PLATFORM_KEY);
  await page.getByLabel("Business ID").fill(businessId);
  await page.locator("select").selectOption("free");
  await page.getByRole("button", { name: "Change plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Plan changed to free.");

  await page.getByLabel("Period start (ISO)").fill("2026-09-01T00:00:00.000Z");
  await page.getByLabel("Period end (ISO)").fill("2026-10-01T00:00:00.000Z");
  await page.getByRole("button", { name: "Issue invoice" }).click();
  await expect(page.getByRole("status")).toHaveText(/Invoice issued: inv_/);

  await page.getByLabel("Flag key").fill("reports");
  await page.getByRole("button", { name: "Set flag" }).click();
  await expect(page.getByRole("status")).toHaveText("Flag reports set to true.");

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Plan: free" })).toBeVisible();
  await expect(page.getByText("Status: active")).toBeVisible();
  await expect(page.getByText("Users: 1 / 3 (33%)")).toBeVisible();
  await expect(page.getByText("Registers: 0 / 1 (0%)")).toBeVisible();
  await expect(page.getByText(/→ .*: 0\.00 PHP — open/)).toBeVisible();

  // Trial notice disappears once the subscription is no longer trialing.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Pro trial/ })).toHaveCount(0);
});
