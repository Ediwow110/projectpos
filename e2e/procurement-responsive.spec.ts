import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("purchase-order list stays usable across supported viewport widths", async ({ page }) => {
  await registerOperationalBusiness(page, {
    ownerName: "Procurement Responsive Owner",
    email: "procurement-responsive@example.com",
    password: "correct-horse-12",
    businessName: "Procurement Responsive Store",
  });
  for (const width of [360, 430, 768, 834, 1280, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/purchase-orders");
    await expect(page.getByRole("heading", { name: "Purchase orders", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
