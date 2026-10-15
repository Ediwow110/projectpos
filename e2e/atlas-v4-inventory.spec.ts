import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("Atlas V4 inventory routes render role-aware task surfaces", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await registerOperationalBusiness(page, {
    ownerName: "Atlas Inventory QA",
    email: `atlas-v4-inventory-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Atlas Inventory QA",
  });
  const routes = [
    ["/inventory/counts", "Scan & count"],
    ["/purchase-orders", "Batch receiving"],
    ["/inventory/stock-exceptions", "Expiry & damage"],
    ["/inventory/replenishment", "Replenishment"],
    ["/inventory/access", "Restricted action"],
  ] as const;
  for (const [path, title] of routes) {
    await page.goto(path);
    const sectionTitle = title === "Replenishment" ? "Reorder recommendations" : title;
    await expect(page.getByRole("heading", { name: sectionTitle, level: 2, exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: `${sectionTitle} safeguards` })).toBeVisible();
    await expect(page.locator('[data-ui="atlas-inventory-shell"]')).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, path).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1440) + 2);
    await page.screenshot({ path: `test-results/atlas-v4-inventory-${title.toLowerCase().replace(/[^a-z]+/g, "-")}-${testInfo.project.name}.png`, fullPage: false });
  }
});
