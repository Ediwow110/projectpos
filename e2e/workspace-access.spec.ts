import { expect, test } from "@playwright/test";

test("incomplete owners stay in setup across dashboard deep links and browser history", async ({ page }) => {
  let dashboardOverviewRequests = 0;
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      userId: "qa-owner", businessId: "qa-business", businessName: "QA Workspace",
      role: "owner", onboardingRequired: true, workspaceTourSeen: false,
      activeBranchId: null, activeBranchName: null,
    }),
  }));
  await page.route("**/api/v1/onboarding", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      currentStep: "taxCurrency",
      steps: {
        businessDetails: "done", taxCurrency: "pending", receiptSetup: "pending",
        products: "pending", employees: "pending",
      },
    }),
  }));
  await page.route("**/api/v1/dashboard/overview**", (route) => {
    dashboardOverviewRequests += 1;
    const emptyKpi = { value: 0, previous: 0, deltaMinor: 0, deltaPct: 0 };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kpis: {
          netRevenue: emptyKpi, orders: emptyKpi, avgOrder: emptyKpi,
          refundTotal: emptyKpi, discountTotal: emptyKpi, expenseTotal: emptyKpi,
        },
        series: [], topProducts: [], attention: [], compareLabel: "previous period",
      }),
    });
  });

  await page.goto("/login");
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await expect(page.getByText("Complete required setup to open the dashboard.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(0);
  expect(dashboardOverviewRequests).toBe(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
});

test("owners can open the dashboard after required setup while optional steps remain", async ({ page }) => {
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      userId: "qa-owner", businessId: "qa-business", businessName: "QA Workspace",
      role: "owner", onboardingRequired: false, workspaceTourSeen: true,
      activeBranchId: null, activeBranchName: null,
    }),
  }));
  await page.route("**/api/v1/onboarding", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      currentStep: "products",
      steps: {
        businessDetails: "done", taxCurrency: "done", receiptSetup: "done",
        products: "pending", employees: "pending",
      },
    }),
  }));
  await page.route("**/api/v1/branches", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }),
  }));
  await page.route("**/api/v1/dashboard/overview**", (route) => {
    const emptyKpi = { value: 0, previous: 0, deltaMinor: 0, deltaPct: 0 };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kpis: {
          netRevenue: emptyKpi, orders: emptyKpi, avgOrder: emptyKpi,
          refundTotal: emptyKpi, discountTotal: emptyKpi, expenseTotal: emptyKpi,
        },
        series: [], topProducts: [], attention: [], compareLabel: "previous period",
      }),
    });
  });

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "First products" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to dashboard" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("signed-out workspace routes redirect to login without rendering a fallback owner", async ({ page }) => {
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ code: "TENANT_REQUIRED", message: "Sign in required" }),
  }));
  await page.addInitScript(() => {
    localStorage.setItem("nexpos-active-sync-scope-v1", JSON.stringify({ userId: "qa-user", businessId: "qa-business" }));
  });
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nexpos-active-sync-scope-v1"))).toBeNull();
});

for (const status of [401, 403]) {
  test(`cached workspace identity is cleared after authorization denial (${status})`, async ({ page }) => {
    let denied = false;
    await page.route("**/api/v1/me", (route) => route.fulfill({
      status: denied ? status : 200,
      contentType: "application/json",
      body: JSON.stringify(denied ? { code: "TENANT_REQUIRED", message: "Sign in required" } : {
        userId: "qa-user", businessId: "qa-business", businessName: "QA Workspace",
        role: "cashier", onboardingRequired: false, workspaceTourSeen: true,
        activeBranchId: null, activeBranchName: null,
      }),
    }));
    await page.route("**/api/v1/branches", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }),
    }));
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.setItem("nexpos-active-sync-scope-v1", JSON.stringify({ userId: "qa-user", businessId: "qa-business" })));
    denied = true;
    // A synthetic visibilitychange cannot flip the focus manager (it only
    // refetches when focus actually changes), so drive the next identity
    // check with a reload: route mocks and localStorage survive it.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nexpos-active-sync-scope-v1"))).toBeNull();
    await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(0);
  });
}
