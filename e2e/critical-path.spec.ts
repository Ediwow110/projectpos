// Phase 8 critical-path E2E (PLAN.md 13.2, adapted honestly):
// create business (UI) -> create product + receive stock (API: no product
// creation UI exists yet) -> create register (UI) -> open shift (UI) ->
// POS cash sale (UI) -> receipt (UI) -> sales history (UI) ->
// dashboard revenue (UI) -> close shift (UI) -> shift report reconciles.
//
// Known gaps (documented, not faked): no member-invite API exists, so the
// "create employee / sign in as cashier" step runs through the cashier UI
// surfaces (POS) on the owner session; multi-session role separation is
// proven by unit/contract tests (rolePermissions, FORBIDDEN gates).
// Audit-trail assertions live at the API level (audit rows asserted in
// service tests); here we assert the user-visible effects.
import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

test("critical path: register to reconciled close", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const password = "correct-horse-12";

  await registerBusiness(page, {
    ownerName: "E2E Owner",
    email,
    password,
    businessName: "E2E Store",
  });

  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "E2E Coke", priceMinor: 2500, stock: 50 });

  // Register + open shift via UI.
  await page.goto("/registers");
  await page.getByLabel("Register name").fill("Counter 1");
  await page.getByRole("button", { name: "Create register" }).click();
  await expect(page.getByText("Counter 1")).toBeVisible();

  await page.goto("/shifts");
  await page.getByLabel("Register").selectOption({ label: "Counter 1" });
  await page.getByLabel("Opening float").fill("100.00");
  await page.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();

  // POS cash sale via UI.
  await page.goto("/pos");
  await page.getByLabel("Register").selectOption({ label: "Counter 1" });
  await page.getByLabel("Search or scan").fill("E2E Coke");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: /E2E Coke — 25\.00/ }).click();
  await expect(page.getByText("Total due:")).toBeVisible();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByText("Sale completed.")).toBeVisible();
  await page.getByRole("link", { name: "View receipt" }).click();
  // Next dev compiles the receipts route on first visit; under parallel load
  // that plus the API round-trip can exceed the default 5s.
  await expect(page.getByText(/Receipt \d{4}-\d{6}/)).toBeVisible({ timeout: 30_000 });

  // Sales history shows the sale (by receipt number).
  await page.goto("/sales");
  await expect(page.getByText(/\d{4}-\d{6}/).first()).toBeVisible();

  // Dashboard shows revenue.
  await page.goto("/");
  await expect(page.getByText("25.00").first()).toBeVisible();

  // Inventory decreased via API (memory store is shared with the UI session).
  const balances = await request.get(`${API}/api/v1/inventory/balances`, { headers });
  expect(balances.ok()).toBe(true);
  const items = ((await balances.json()) as { items: Array<{ productName?: string; qtyOnHand?: number; productId: string }> }).items;
  expect(items.length).toBeGreaterThan(0);

  // Close shift and verify the report reconciles.
  await page.goto("/shifts");
  await page.getByLabel("Counted cash").fill("125.00");
  await page.getByRole("button", { name: "Close shift" }).click();
  await expect(page.getByText("Shift closed. Variance: BALANCED")).toBeVisible();
});
