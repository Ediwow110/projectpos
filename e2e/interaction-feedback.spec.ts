import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";

async function completeOnboarding(
  page: import("@playwright/test").Page,
  dismissTour = true,
): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    const button = page.getByRole("button", { name: "Mark step complete" });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
  }
  await expect(page).toHaveURL("/", { timeout: 30_000 });
  if (dismissTour) {
    const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
    await expect(tour).toBeVisible({ timeout: 30_000 });
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
  }
}

test("first workspace landing shows a dismissible tour once and allows manual restart", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Tour Feedback Owner",
    email: `feedback-tour-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Tour Feedback Store",
  });
  await completeOnboarding(page, false);

  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible();
  await expect(tour.getByText("System tour · 1 of 6")).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome to NexPOS" })).toHaveCount(0);

  await page.getByRole("button", { name: "Restart system tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to NexPOS" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Welcome to NexPOS" }).getByRole("button", { name: "Next" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Welcome to NexPOS" })).toHaveCount(0);
});

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

test("unfinished owner setup cannot be bypassed by direct workspace navigation", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Guarded Owner",
    email: `guarded-owner-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Guarded Store",
  });

  await page.goto("/pos");
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Products" })).toHaveCount(0);
});

test("device enrollment acknowledges slow work immediately", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Device Feedback Owner",
    email: `device-feedback-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Device Feedback Store",
  });
  await completeOnboarding(page);
  await page.goto("/sync");

  await page.route("**/api/v1/devices", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  await page.getByLabel("Device label").fill("Till QA");
  await page.getByRole("button", { name: "Register this device" }).click();
  const busy = page.getByRole("button", { name: "Registering…" });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("This device is registered. Future sign-ins will bind to it.")).toBeVisible({ timeout: 30_000 });
});
