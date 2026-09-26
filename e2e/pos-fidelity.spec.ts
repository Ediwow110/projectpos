import { expect, test } from "@playwright/test";
import { apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

test("POS shell and responsive geometry match the current navigation contract", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const desktop = testInfo.project.name === "desktop";
  await page.setViewportSize(desktop ? { width: 1440, height: 1024 } : { width: 1024, height: 1366 });

  const stamp = Date.now();
  const email = `fidelity-${testInfo.project.name}-${stamp}@example.com`;
  await registerBusiness(page, {
    ownerName: "Fidelity Owner",
    email,
    password: "correct-horse-12",
    businessName: "NexPOS Market",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Visual Latte", priceMinor: 14500, stock: 20 });

  await page.goto("/pos");
  const search = page.getByLabel("Search product, SKU or scan barcode");
  const product = page.getByRole("button", { name: /Visual Latte ₱145\.00/ });
  await expect(search).toBeVisible({ timeout: 30_000 });
  await expect(product).toBeVisible({ timeout: 30_000 });

  const header = page.locator('[data-ui="shell-header"]');
  const sidebar = page.locator('[data-ui="shell-sidebar"]');
  const main = page.locator('[data-ui="shell-main"]');
  const mobileNav = page.locator('[data-ui="shell-mobile-nav"]');

  await expect(header).toBeVisible();
  await expect(main).toBeVisible();

  if (desktop) {
    await expect(sidebar).toBeVisible();
    await expect(mobileNav).toBeHidden();
    const sidebarBox = await sidebar.boundingBox();
    const mainBox = await main.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(215);
    expect(sidebarBox!.width).toBeLessThanOrEqual(225);
    expect(mainBox!.x).toBeGreaterThanOrEqual(215);
    expect(mainBox!.width).toBeGreaterThan(1100);
    await expect(page.getByRole("complementary", { name: "Cart" })).toBeVisible();
  } else {
    await expect(sidebar).toBeHidden();
    await expect(mobileNav).toBeVisible();
    const mainBox = await main.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mainBox!.x).toBeCloseTo(0, 0);
    expect(mainBox!.width).toBeCloseTo(1024, 0);
    const tabletCart = page.getByRole("region", { name: "Tablet cart" });
    await expect(tabletCart).toBeVisible();
    const cartBox = await tabletCart.boundingBox();
    expect(cartBox).not.toBeNull();
    expect(cartBox!.height).toBeCloseTo(160, 0);
  }

  await product.click();
  if (desktop) {
    await page.getByRole("button", { name: /Pay ₱145\.00/ }).click();
  } else {
    await page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "Pay", exact: true }).click();
  }
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
});
