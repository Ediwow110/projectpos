import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";

async function completeOnboarding(page: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    const button = page.getByRole("button", { name: "Mark step complete" });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
  }
  await expect(page).toHaveURL("/", { timeout: 30_000 });
}

test("onboarding acknowledges a slow step mutation immediately", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Feedback Owner",
    email: `feedback-onboarding-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Feedback Store",
  });
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible({ timeout: 30_000 });

  await page.route("**/api/v1/onboarding", async (route) => {
    if (route.request().method() === "PATCH") {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Mark step complete" }).click();
  const busy = page.getByRole("button", { name: "Saving step…" });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("SETUP 03 / 05")).toBeVisible({ timeout: 30_000 });
});

test("main navigation shows progress while a delayed route is loading", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Navigation Owner",
    email: `feedback-navigation-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Navigation Store",
  });
  await completeOnboarding(page);

  await page.route("**/sales**", async (route) => {
    if (route.request().url().includes("_rsc=")) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  const nav = (page.viewportSize()?.width ?? 1440) >= 1280
    ? page.locator('[data-ui="shell-sidebar"] nav')
    : page.locator('[data-ui="shell-mobile-nav"]');
  await nav.getByRole("link", { name: "Sales", exact: true }).click();
  await expect(page.locator('[data-ui="navigation-progress"]')).toBeVisible();
  await expect(page).toHaveURL("/sales", { timeout: 30_000 });
  await expect(page.locator('[data-ui="navigation-progress"]')).toBeHidden();
});
