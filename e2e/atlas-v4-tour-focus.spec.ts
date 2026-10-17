import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("Atlas V4 system tour restores keyboard focus after Escape, Skip and responsive navigation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await registerOperationalBusiness(page, {
    ownerName: "Tour Focus QA",
    email: `tour-focus-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Tour Focus QA",
  });
  await page.goto("/admin/owner-controls");
  let opener;
  if (testInfo.project.name === "desktop") {
    opener = page.locator('[data-ui="shell-header"]').getByRole("button", { name: "Restart system tour" });
  } else {
    const menu = page.getByRole("button", { name: "Open workspace menu" });
    await menu.click();
    opener = page.locator('[data-ui="shell-mobile-more"]').getByRole("button", { name: "Restart system tour" });
  }
  await opener.click();

  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible();
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tour.getByRole("button", { name: "Close tour and do not show automatically again" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  const triggerAfterClose = testInfo.project.name === "desktop"
    ? page.locator('[data-ui="shell-header"]').getByRole("button", { name: "Restart system tour" })
    : page.getByRole("button", { name: "Open workspace menu" });
  await expect(triggerAfterClose).toBeFocused();

  if (testInfo.project.name !== "desktop") {
    await triggerAfterClose.click();
    const restart = page.locator('[data-ui="shell-mobile-more"]').getByRole("button", { name: "Restart system tour" });
    await restart.click();
  } else {
    await triggerAfterClose.click();
  }
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();
  await expect(triggerAfterClose).toBeFocused();
});

test("Atlas V4 mobile navigation cannot stay expanded after resizing to desktop and back", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await registerOperationalBusiness(page, {
    ownerName: "Responsive Menu QA",
    email: `responsive-menu-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Responsive Menu QA",
  });
  await page.goto("/admin/owner-controls");
  const button = page.getByRole("button", { name: "Open workspace menu" });
  await button.click();
  await expect(page.getByRole("button", { name: "Close workspace menu" })).toHaveAttribute("aria-expanded", "true");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-ui="shell-sidebar"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open workspace menu" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-ui="shell-mobile-more"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
});
