import { expect, test } from "@playwright/test";

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
    await page.clock.install();
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
    // The identity query is fresh for 60 seconds; focus only refetches stale data.
    await page.clock.fastForward(61_000);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page).toHaveURL(/\/login$/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("nexpos-active-sync-scope-v1"))).toBeNull();
    await expect(page.getByRole("complementary", { name: "Workspace navigation" })).toHaveCount(0);
  });
}
