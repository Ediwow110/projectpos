import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";
import { OnboardingPage } from "./pages/OnboardingPage";

async function completeOnboarding(
  page: import("@playwright/test").Page,
  dismissTour = true,
): Promise<void> {
  const onboarding = new OnboardingPage(page);
  for (const nextStep of ["Currency & tax", "Receipt setup", "First products"]) {
    await onboarding.completeCurrentStep();
    await expect(page.getByRole("heading", { name: nextStep, exact: true })).toBeVisible();
  }
  await page.getByRole("link", { name: /Back to dashboard/i }).click();
  await expect(page).toHaveURL("/", { timeout: 30_000 });  if (dismissTour) {
    const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
    await expect(tour).toBeVisible({ timeout: 30_000 });
    const persisted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/tour/seen")
        && response.request().method() === "POST"
        && response.ok(),
      { timeout: 30_000 },
    );
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await persisted;
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
  await expect(tour.getByText("System tour · 1 of 7")).toBeVisible();
  const persisted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/tour/seen")
      && response.request().method() === "POST"
      && response.ok(),
    { timeout: 30_000 },
  );
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await persisted;
  await expect(tour).toBeHidden();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Welcome to NexPOS" })).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await page.getByRole("button", { name: "Open workspace menu" }).click();
  }
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

  await page.getByLabel("Operating address").fill("123 Test Street, Manila");
  await page.getByRole("button", { name: "Save & continue" }).click();
  const busy = page.getByRole("button", { name: /Saving configuration/ });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { name: "Currency & tax", exact: true })).toBeVisible({ timeout: 30_000 });
});

test("main navigation shows progress while a delayed route is loading", async ({ page }) => {
  await registerBusiness(page, {
    ownerName: "Navigation Owner",
    email: `feedback-navigation-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Navigation Store",
  });
  await completeOnboarding(page);

  const desktop = (page.viewportSize()?.width ?? 1440) >= 1280;
  const getDestination = async () => {
    if (!desktop) {
      await page.getByRole("button", { name: "Open workspace menu" }).click();
    }
    const nav = desktop
      ? page.getByRole("navigation", { name: "Owner navigation" })
      : page.getByRole("navigation", { name: "More workspace navigation" });
    return nav.getByRole("link", { name: "Owner controls", exact: true });
  };
  const firstClick = await getDestination();
  await firstClick.evaluate((node) => {
    node.addEventListener("click", (event) => event.preventDefault(), { once: true });
  });
  await firstClick.click();
  await expect(page.locator('[data-ui="navigation-progress"]')).toBeVisible();
  await (await getDestination()).click();
  await expect(page).toHaveURL("/admin/owner-controls", { timeout: 30_000 });
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
  await page.goto("/devices");

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
  await expect(page.getByText("This browser is registered. Future sign-ins will bind sessions to this device.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Registered devices" })).toBeVisible();
  await expect(page.getByText("Till QA", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revoke Till QA" }).click();
  const revokeDialog = page.getByRole("dialog", { name: "Revoke device?" });
  await expect(revokeDialog).toBeVisible();
  await revokeDialog.getByRole("button", { name: "Revoke device", exact: true }).click();
  await expect(page.getByText("This device was revoked. This session was not device-bound, so you can continue until you sign out.")).toBeVisible();
});
