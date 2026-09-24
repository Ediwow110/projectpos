// Phase 10 SaaS billing E2E (PLAN.md 16.2 and 17): trial on registration ->
// plan/usage surface -> public API token (one-time secret, scoped, revocable)
// -> platform operator plan change. Cap enforcement itself is server-side and
// covered by apps/api/test/plan-limits.contract.test.ts.
import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

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
  const email = `e2e-token-${stamp}@example.com`;
  await registerBusiness(page, {
    ownerName: "Token E2E Owner",
    email,
    password: "correct-horse-12",
    businessName: `Token Store ${stamp}`,
  });
  // The public API is an Enterprise entitlement (PLAN.md 16.2), so upgrade
  // before minting; the billing page then shows the switch too.
  const businessId = await currentBusinessId(page);
  const upgrade = await request.patch(`${API}/api/v1/platform/businesses/${businessId}/plan`, {
    headers: { "x-platform-key": PLATFORM_KEY },
    data: { planKey: "enterprise" },
  });
  expect(upgrade.ok()).toBe(true);

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Plan: enterprise" })).toBeVisible();
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

test("free plan caps are enforced in the UI with an upgrade path", async ({ page, request }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Cap Owner",
    email: `e2e-caps-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Cap Store ${stamp}`,
  });
  const businessId = await currentBusinessId(page);
  await request.patch(`${API}/api/v1/platform/businesses/${businessId}/plan`, {
    headers: { "x-platform-key": PLATFORM_KEY },
    data: { planKey: "free" },
  });

  await page.goto("/registers");
  await page.getByLabel("Name").fill("Counter 1");
  await page.getByRole("button", { name: "Create register" }).click();
  await expect(page.getByText("Counter 1")).toBeVisible();

  // Free allows one register: the second create is refused server-side and the
  // UI shows the limit with a route to billing.
  await page.getByLabel("Name").fill("Counter 2");
  await page.getByRole("button", { name: "Create register" }).click();
  const notice = page.locator("main").getByRole("alert");
  await expect(notice).toContainText("Register limit reached on the Free plan");
  await notice.getByRole("link", { name: "Manage plan" }).click();
  await expect(page).toHaveURL(/\/billing/);
  await expect(page.getByRole("heading", { name: "Plan: free" })).toBeVisible();
});

test("an offline cash sale still syncs after a downgrade to Free", async ({ page, context, request }) => {
  const stamp = Date.now();
  const email = `e2e-offline-free-${stamp}@example.com`;
  await registerBusiness(page, {
    ownerName: "Offline Free Owner",
    email,
    password: "correct-horse-12",
    businessName: `Offline Free Store ${stamp}`,
  });
  const businessId = await currentBusinessId(page);
  await request.patch(`${API}/api/v1/platform/businesses/${businessId}/plan`, {
    headers: { "x-platform-key": PLATFORM_KEY },
    data: { planKey: "free" },
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Free Cola", priceMinor: 2500, stock: 20 });

  await page.goto("/pos");
  await page.getByLabel("Search or scan").fill("Free Cola");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: /Free Cola — 25\.00/ }).click();
  await expect(page.getByText("Total due:")).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("Offline.", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByText(/Provisional receipt OFFLINE-/)).toBeVisible();

  await context.setOffline(false);
  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "Sync queue" })).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/— SYNCED —/)).toBeVisible({ timeout: 30000 });

  const sales = await request.get(`${API}/api/v1/sales?limit=5`, { headers });
  expect(sales.ok()).toBe(true);
  const items = ((await sales.json()) as { items: Array<{ status: string; totalMinor: number }> }).items;
  expect(items.some((s) => s.status === "COMPLETED" && s.totalMinor === 2500)).toBe(true);
});

test("the customer display shows the last completed sale", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-display-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerBusiness(page, {
    ownerName: "Display Owner",
    email,
    password,
    businessName: `Display Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "Display Cola", priceMinor: 2500, stock: 10 });

  const register = await request.post(`${API}/api/v1/registers`, {
    headers,
    data: { name: "Front counter" },
  });
  const registerId = ((await register.json()) as { id: string }).id;
  await request.post(`${API}/api/v1/registers/${registerId}/open`, {
    headers,
    data: { registerId, openingFloatMinor: 0 },
  });
  const products = await request.get(`${API}/api/v1/products?page=1&pageSize=1`, { headers });
  const productId = ((await products.json()) as { items: Array<{ id: string }> }).items[0]!.id;
  const realDraft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }], registerId },
  });
  const draftBody = (await realDraft.json()) as { id: string; totalMinor: number };
  const done = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `display-sale-${stamp}` },
    data: { saleId: draftBody.id, registerId, payments: [{ method: "cash", amountMinor: draftBody.totalMinor }] },
  });
  expect(done.ok()).toBe(true);
  const receiptNo = ((await done.json()) as { receiptNo: string }).receiptNo;

  const token = await request.post(`${API}/api/v1/display/tokens`, {
    headers,
    data: { registerId },
  });
  expect(token.ok()).toBe(true);
  const displayToken = ((await token.json()) as { token: string }).token;

  await page.goto(`/display?registerId=${registerId}&token=${encodeURIComponent(displayToken)}`);
  await expect(page.getByRole("heading", { name: `Display Store ${stamp}` })).toBeVisible();
  await expect(page.getByText(`Last sale ${receiptNo}: 25.00`)).toBeVisible();
});
