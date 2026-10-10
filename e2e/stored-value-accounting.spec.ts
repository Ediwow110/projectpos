import { expect, test } from "@playwright/test";
import { StoredValuePage } from "./pages/StoredValuePage";

test("manual store-credit adjustment posts with selected counter account", async ({ page }) => {
  let postedBody: { amountMinor: number; counterAccountCode: string; reason: string } | null = null;
  await page.route("**/api/v1/me", async (route) => route.fulfill({ json: {
    userId: "value-owner", businessId: "value-business", businessName: "Stored Value E2E", role: "owner",
    onboardingRequired: false, workspaceTourSeen: true, activeBranchId: null, activeBranchName: null,
  } }));
  await page.route("**/api/v1/branches", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/v1/customers/customer-1", async (route) => route.fulfill({ json: { id: "customer-1", name: "Test customer" } }));
  await page.route("**/api/v1/customers/customer-1/stored-value/history", async (route) => route.fulfill({ json: { customerId: "customer-1", storeCredit: [], loyalty: [] } }));
  await page.route("**/api/v1/accounting/accounts", async (route) => route.fulfill({ json: [
    { code: "2310", name: "Store Credit Liability", isActive: true },
    { code: "6000", name: "Operating Expenses", isActive: true },
    { code: "4000", name: "Merchandise Revenue", isActive: true },
  ] }));
  await page.route("**/api/v1/auth/csrf", async (route) => route.fulfill({ json: { csrfToken: "value-csrf" } }));
  await page.route("**/api/v1/customers/customer-1/store-credit/adjust", async (route) => {
    postedBody = route.request().postDataJSON() as typeof postedBody;
    await route.fulfill({ json: { customerId: "customer-1", balanceMinor: 500 } });
  });

  const storedValue = new StoredValuePage(page);
  await page.goto("/customers/customer-1/stored-value");
  await storedValue.applyStoreCreditAdjustment({ amountMinor: "500", counterAccountCode: "4000", reason: "Verified customer correction" });
  await storedValue.expectAdjustmentSaved();
  expect(postedBody).toEqual({ amountMinor: 500, counterAccountCode: "4000", reason: "Verified customer correction" });
});
