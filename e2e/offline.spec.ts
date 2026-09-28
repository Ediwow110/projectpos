// Phase 9b offline E2E (PLAN.md 15, spec docs/superpowers/specs/2026-09-24-phase9b-offline-design.md):
// offline cash sale -> provisional receipt -> reconnect -> SYNCED with server
// effects; oversell conflict -> review queue -> resolve. Catalog served from
// cache with staleness while offline.
//
// Known gaps (documented, not faked): browser-level offline also blocks the
// API origin, which is exactly the outage under test; the Playwright request
// fixture stays online and plays the "rest of the world" (draining stock).
import { expect, test } from "@playwright/test";
import {
  API,
  apiAuthedContext,
  clickPosPay,
  expectOnePosCartItem,
  registerBusiness,
  seedProduct,
} from "./helpers";

async function refreshOutbox(page) {
  await page.goto("/sync");
  await expect(page.getByRole("heading", { name: "Sync queue" })).toBeVisible();
}

async function openPayment(page, amount: string) {
  await clickPosPay(page, amount);
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
}

async function expectPosStatus(page, text: RegExp) {
  const tabletPos = (page.viewportSize()?.width ?? 1440) < 1280;
  const region = tabletPos
    ? page.getByRole("region", { name: "Tablet payment status" })
    : page.getByRole("complementary", { name: "Cart" });
  await expect(region.getByText(text)).toBeVisible();
}

test("offline cash sale syncs on reconnect", async ({ page, context, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `e2e-off-${stamp}@example.com`;
  const password = "correct-horse-12";

  await registerBusiness(page, {
    ownerName: "E2E Owner",
    email,
    password,
    businessName: "E2E Offline Store",
  });

  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "Offline Cola", priceMinor: 2500, stock: 50 });

  // Online: search fills the catalog cache, add to cart.
  await page.goto("/pos");
  await page.getByLabel("Search product, SKU or scan barcode").fill("Offline Cola");
  await page.getByRole("button", { name: /Offline Cola ₱25\.00/ }).click();
  await expectOnePosCartItem(page);

  // Outage: API origin unreachable.
  await context.setOffline(true);
  await expect(page.getByText("Offline — cash only, sales will queue.", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Offline catalog as of/)).toBeVisible();

  // Cash-only offline sale -> provisional receipt, cart cleared.
  await openPayment(page, "25.00");
  await expect(page.getByRole("dialog", { name: "Payment" }).getByText("Offline sales accept cash only.")).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expectPosStatus(page, /Provisional receipt OFFLINE-/);

  // Reconnect and sync: draft + complete replay to a server sale.
  await context.setOffline(false);
  await refreshOutbox(page);
  await expect(page.getByText("Queued · pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("button", { name: "Syncing…" })).toBeDisabled();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Sync pass: 1 synced, 0 conflicts, 0 retryable.")).toBeVisible();

  // Server-side effects: one COMPLETED cash sale, stock 50 -> 49.
  const sales = await request.get(`${API}/api/v1/sales?limit=5`, { headers });
  expect(sales.ok()).toBe(true);
  const items = ((await sales.json()) as { items: Array<{ status: string; totalMinor: number }> }).items;
  const done = items.find((s) => s.status === "COMPLETED" && s.totalMinor === 2500);
  expect(done).toBeTruthy();
  const balances = await request.get(`${API}/api/v1/inventory/balances`, { headers });
  expect(balances.ok()).toBe(true);
  const stock = ((await balances.json()) as { items: Array<{ qtyOnHand: number }> }).items;
  expect(stock[0].qtyOnHand).toBe(49);
});

test("oversell conflict lands in review and resolves", async ({ page, context, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `e2e-conf-${stamp}@example.com`;
  const password = "correct-horse-12";

  await registerBusiness(page, {
    ownerName: "E2E Owner",
    email,
    password,
    businessName: "E2E Conflict Store",
  });

  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, { name: "Last Unit", priceMinor: 1000, stock: 1 });

  await page.goto("/pos");
  await page.getByLabel("Search product, SKU or scan barcode").fill("Last Unit");
  await page.getByRole("button", { name: /Last Unit ₱10\.00/ }).click();

  await context.setOffline(true);
  await expect(page.getByText("Offline — cash only, sales will queue.", { exact: true })).toBeVisible({ timeout: 30000 });
  await openPayment(page, "10.00");
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expectPosStatus(page, /Provisional receipt OFFLINE-/);

  // Rest of the world drains the last unit while we are offline.
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draft.ok()).toBe(true);
  const draftBody = (await draft.json()) as { id: string; totalMinor: number };
  const complete = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `e2e-drain-${stamp}` },
    data: { saleId: draftBody.id, payments: [{ method: "cash", amountMinor: draftBody.totalMinor }] },
  });
  expect(complete.ok()).toBe(true);

  await context.setOffline(false);
  await refreshOutbox(page);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Conflict · pending", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("INSUFFICIENT_STOCK")).toBeVisible();

  // Manager resolves with a reason: audited, terminal, never silently dropped.
  await page.getByLabel("Resolution reason").fill("covered by till count");
  await page.getByRole("button", { name: "Resolve conflict", exact: true }).click();
  await expect(page.getByText("Conflict resolved and recorded.")).toBeVisible();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
});

test("offline queue stays private to its account across logout and re-login", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const emailA = await registerBusiness(page, {
    ownerName: "Offline Owner A",
    email: `e2e-isolation-a-${stamp}@example.com`,
    password,
    businessName: "Offline Isolation A",
  });

  const { headers } = await apiAuthedContext(request, emailA, password, page);
  await seedProduct(request, headers, { name: "Private Queue Cola", priceMinor: 2500, stock: 10 });

  await page.goto("/pos");
  await page.getByLabel("Search product, SKU or scan barcode").fill("Private Queue Cola");
  await page.getByRole("button", { name: /Private Queue Cola ₱25\.00/ }).click();
  await context.setOffline(true);
  await expect(page.getByText("Offline — cash only, sales will queue.", { exact: true })).toBeVisible({ timeout: 30_000 });
  await openPayment(page, "25.00");
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expectPosStatus(page, /Provisional receipt OFFLINE-/);
  await context.setOffline(false);

  await refreshOutbox(page);
  await expect(page.getByText("Queued · pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await registerBusiness(page, {
    ownerName: "Offline Owner B",
    email: `e2e-isolation-b-${stamp}@example.com`,
    password,
    businessName: "Offline Isolation B",
  });
  await page.goto("/sync");
  await expect(page.getByText("No offline commands queued.")).toBeVisible();
  await expect(page.getByText("Queued · pending", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(emailA);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.goto("/sync");
  await expect(page.getByText("Queued · pending", { exact: true })).toBeVisible();
});
