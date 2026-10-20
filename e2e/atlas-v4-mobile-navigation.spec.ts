import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("V4 mobile workspace menu preserves navigation and returns keyboard focus after Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Mobile Owner",
    email: "atlas-mobile-menu@example.test",
    password: "correct-horse-12",
    businessName: "Atlas Mobile Menu QA",
  });
  await page.goto("/team");
  const header = page.locator('[data-ui="atlas-mobile-header"]');
  const open = header.getByRole("button", { name: "Open workspace menu" });
  await expect(open).toHaveAttribute("aria-expanded", "false");
  await open.click();
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation).toBeVisible();
  await navigation.getByRole("link", { name: "POS" }).focus();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
  await expect(header.getByRole("button", { name: "Open workspace menu" })).toBeFocused();
});
