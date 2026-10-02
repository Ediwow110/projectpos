import { expect, test } from "@playwright/test";

test("signed-out workspace routes redirect to login without rendering a fallback owner", async ({ page }) => {
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ code: "TENANT_REQUIRED", message: "Sign in required" }),
  }));
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(0);
});

test("workspace outages hide protected content and allow a successful retry", async ({ page }) => {
  let failed = true;
  await page.route("**/api/v1/me", (route) => route.fulfill({
    status: failed ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify(failed ? { code: "UNAVAILABLE", message: "Temporarily unavailable" } : {
      userId: "qa-user", businessId: "qa-business", businessName: "QA Workspace",
      role: "cashier", onboardingRequired: false, workspaceTourSeen: true,
      activeBranchId: null, activeBranchName: null,
    }),
  }));
  await page.route("**/api/v1/branches", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }),
  }));
  await page.goto("/team");
  await expect(page.getByRole("alert")).toContainText("Could not load your workspace");
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
});
