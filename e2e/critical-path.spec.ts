// Phase 8 critical-path E2E (PLAN.md 13.2, adapted honestly):
// create business (UI) -> create product + receive stock (API: no product
// creation UI exists yet) -> create register (UI) -> open shift (UI) ->
// POS cash sale (UI) -> receipt (UI) -> sales history (UI) ->
// dashboard revenue (UI) -> close shift (UI) -> shift report reconciles.
//
// Role separation has its own real cashier browser coverage in roles.spec.ts.
// Audit-trail assertions live at the API level (audit rows asserted in service
// tests); here we assert the user-visible end-to-end effects.
import { expect, test } from "@playwright/test";
import {
  API,
  apiAuthedContext,
  clickPosPay,
  expectOnePosCartItem,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

test("critical path: register to reconciled close", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const password = "correct-horse-12";

  await registerOperationalBusiness(page, {
    ownerName: "E2E Owner",
    email,
    password,
    businessName: "E2E Store",
  });

  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, { name: "E2E Coke", priceMinor: 2500, stock: 50 });

  // Register + open shift via UI.
  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  const registerDialog = page.getByRole("dialog", { name: "Create register" });
  await registerDialog.getByLabel("Register name").fill("Counter 1");
  await registerDialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Counter 1")).toBeVisible();

  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  const openShiftDialog = page.getByRole("dialog", { name: "Open shift" });
  await openShiftDialog.getByLabel("Register").selectOption({ label: "Counter 1" });
  await openShiftDialog.getByLabel("Opening float (PHP)").fill("100.00");
  await openShiftDialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();

  // POS cash sale via UI.
  await page.goto("/pos");
  const viewportWidth = page.viewportSize()?.width ?? 1440;
  if (viewportWidth < 768) {
    await page.getByLabel("Mobile register").selectOption({ label: "Counter 1" });
  } else {
    await page.getByLabel("Register", { exact: true }).selectOption({ label: "Counter 1" });
  }
  await page.getByLabel("Search product, SKU or scan barcode").fill("E2E Coke");
  await page.getByRole("button", { name: /E2E Coke ₱25\.00/ }).click();
  await expectOnePosCartItem(page);
  await clickPosPay(page, "25.00");
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  // Preserve limited, non-sensitive checkout diagnostics if this flow fails.
  // Never log credentials, request bodies, payment instruments, or cookies.
  const checkoutResponses: string[] = [];
  const checkoutResponseReads: Promise<void>[] = [];
  const pageErrors: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/v1/sales/drafts" || path === "/api/v1/sales/complete") {
      checkoutResponseReads.push((async () => {
        let code = "unavailable";
        try {
          const body: unknown = await response.json();
          if (body && typeof body === "object") {
            const envelope = body as { code?: unknown; error?: { code?: unknown } };
            const returnedCode = envelope.error?.code ?? envelope.code;
            if (typeof returnedCode === "string") code = returnedCode;
          }
        } catch {
          // Non-JSON response: the HTTP status remains sufficient evidence.
        }
        checkoutResponses.push(`${response.request().method()} ${path} HTTP ${response.status()} code ${code}`);
      })());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.getByRole("button", { name: "Complete Payment" }).click();
  try {
    if (viewportWidth < 1280) {
      await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText("Sale completed.")).toBeVisible();
      await page.getByRole("region", { name: "Tablet payment status" }).getByRole("link", { name: "View receipt" }).click();
    } else {
      const cart = page.getByRole("complementary", { name: "Cart" });
      await expect(cart.getByText("Sale completed.")).toBeVisible();
      await cart.getByRole("link", { name: "View receipt" }).click();
    }
  } catch (error) {
    await Promise.allSettled(checkoutResponseReads);
    console.error("Checkout failure diagnostics", {
      checkoutResponses,
      pageErrors,
      statusMessages: await page.getByRole("status").allTextContents(),
      alerts: await page.getByRole("alert").allTextContents(),
    });
    throw error;
  }
  // Next dev compiles the receipts route on first visit; under parallel load
  // that plus the API round-trip can exceed the default 5s.
  await expect(page.getByText(/Receipt \d{4}-\d{6}/)).toBeVisible({ timeout: 30_000 });

  // Sales history shows the sale (by receipt number).
  await page.goto("/sales");
  await expect(page.getByText(/\d{4}-\d{6}/).first()).toBeVisible();

  // Dashboard shows revenue.
  await page.goto("/");
  await expect(page.getByText("25.00").first()).toBeVisible();

  // Reports show the same authoritative sale.
  await page.goto("/reports/sales");
  await expect(page.getByRole("heading", { name: "Reports intelligence" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("₱25.00").first()).toBeVisible();

  // Inventory decreased exactly once via the same server-side sale commit.
  const balances = await request.get(`${API}/api/v1/inventory/balances`, { headers });
  expect(balances.ok()).toBe(true);
  const items = ((await balances.json()) as { items: Array<{ productName?: string; qtyOnHand?: number; productId: string }> }).items;
  expect(items.find((item) => item.productId === productId)?.qtyOnHand).toBe(49);

  // Close shift and verify the report reconciles.
  await page.goto("/shifts");
  await page.getByRole("button", { name: "Close shift", exact: true }).first().click();
  const closeDialog = page.getByRole("dialog", { name: "Close & reconcile shift" });
  await closeDialog.getByLabel("Counted cash (PHP)").fill("125.00");
  await closeDialog.getByRole("button", { name: "Close shift", exact: true }).click();
  await expect(page.getByText("Shift closed. Variance: BALANCED")).toBeVisible();
});
