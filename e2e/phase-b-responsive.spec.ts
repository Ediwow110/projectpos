import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`Phase B receipt lookup, case inbox and exception center remain usable at ${viewport.name} width`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const stamp = Date.now();
    await registerOperationalBusiness(page, {
      ownerName: "Responsive QA",
      email: `phase-b-responsive-${viewport.name}-${stamp}@example.com`,
      password: "correct-horse-12",
      businessName: "Phase B Responsive QA",
    });

    for (const route of [
      { path: "/receipts/lookup", heading: "Find a receipt" },
      { path: "/customer-concerns", heading: "Customer case inbox" },
      { path: "/exceptions", heading: "Operational exception center" },
    ]) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth, `${route.path} overflows at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 2);
    }
    await page.goto("/receipts/lookup");
    const input = page.getByLabel("Receipt number");
    await expect(input).toBeVisible();
    await input.fill("UNKNOWN-RECEIPT");
    await input.press("Enter");
    await expect(page.getByText("No matching receipt is available within your current access.")).toBeVisible();
  });
}
