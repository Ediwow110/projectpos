import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, seedProduct, signIn } from "./helpers";

test("Atlas V4 owner photo management fails safely closed until Storage is enabled", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "P5 Media Owner", email: `p5-media-owner-${stamp}@example.com`,
    password, businessName: "P5 Product Media QA",
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const id = await seedProduct(request, headers, { name: "Atlas Oat Milk", priceMinor: 13500, stock: 10 });

  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/products/${id}`);
    const panel = page.getByRole("region", { name: "Owner-managed photo" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Product photo" })).toBeVisible();
    await expect(panel.getByText("Photo uploads are not enabled for this workspace.", { exact: false })).toBeVisible();
    await expect(panel.locator('input[type="file"]')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `Media owner page overflow at ${width}px`).toBeLessThanOrEqual(2);
  }

  const cashierEmail = `p5-media-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, headers, {
    email: cashierEmail, name: "P5 Media Cashier", role: "cashier",
  });
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto(`/products/${id}`);
  await expect(page.getByRole("region", { name: "Owner-managed photo" })).toHaveCount(0);
});
