import { expect, test } from "@playwright/test";
import { apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

test("POS shell and responsive geometry match the current navigation contract", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const desktop = testInfo.project.name === "desktop";
  const tablet = testInfo.project.name === "tablet";
  await page.setViewportSize(
    desktop
      ? { width: 1440, height: 1024 }
      : tablet
        ? { width: 1024, height: 1366 }
        : { width: 390, height: 844 },
  );

  const stamp = Date.now();
  const email = `fidelity-${testInfo.project.name}-${stamp}@example.com`;
  await registerOperationalBusiness(page, {
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

  await expect(page.locator('[data-ui="atlas-pos-shell"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "New sale", level: 1 })).toBeVisible();
  await expect(main).toBeVisible();

  if (desktop) {
    await expect(header).toBeHidden();
    await expect(sidebar).toBeVisible();
    await expect(mobileNav).toBeHidden();
    const sidebarBox = await sidebar.boundingBox();
    const mainBox = await main.boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(77);
    expect(sidebarBox!.width).toBeLessThanOrEqual(79);
    expect(mainBox!.x).toBeGreaterThanOrEqual(77);
    expect(mainBox!.width).toBeGreaterThan(1100);
    const v4Cart = page.locator('[data-ui="atlas-pos-cart"]');
    await expect(v4Cart).toBeVisible();
    await expect(v4Cart).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.locator('[data-ui="atlas-pos-products"]')).toHaveCSS("background-color", "rgb(247, 248, 245)");
    expect((await v4Cart.boundingBox())!.width).toBeCloseTo(456, 0);
    expect((await product.boundingBox())!.height).toBeCloseTo(151, 0);
  } else if (tablet) {
    await expect(header).toBeHidden();
    await expect(sidebar).toBeHidden();
    await expect(page.locator('[data-ui="atlas-mobile-header"]')).toBeVisible();
    await expect(mobileNav).toBeHidden();
    await page.getByRole("button", { name: "Open workspace menu" }).click();
    await expect(mobileNav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(mobileNav).toBeHidden();
    const mainBox = await main.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mainBox!.x).toBeCloseTo(0, 0);
    expect(mainBox!.width).toBeCloseTo(page.viewportSize()!.width, 0);
    const tabletCart = page.getByRole("region", { name: "Tablet cart" });
    await expect(tabletCart).toBeVisible();
    await expect(tabletCart).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const cartBox = await tabletCart.boundingBox();
    expect(cartBox).not.toBeNull();
    expect(cartBox!.height).toBeCloseTo(160, 0);
  } else {
    await expect(header).toBeHidden();
    await expect(sidebar).toBeHidden();
    await expect(page.locator('[data-ui="atlas-mobile-header"]')).toBeVisible();
    await expect(mobileNav).toBeHidden();
    await page.getByRole("button", { name: "Open workspace menu" }).click();
    await expect(mobileNav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(mobileNav).toBeHidden();
    const mainBox = await main.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(mainBox!.x).toBeCloseTo(0, 0);
    expect(mainBox!.width).toBeCloseTo(390, 0);
    await expect(page.getByRole("region", { name: "Tablet cart" })).toBeHidden();
    const mobileCart = page.getByRole("region", { name: "Mobile cart" });
    await expect(mobileCart).toBeVisible();
    await expect(mobileCart).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const mobileCartBox = await mobileCart.boundingBox();
    expect(mobileCartBox).not.toBeNull();
    expect(mobileCartBox!.height).toBeGreaterThanOrEqual(100);
  }

  await product.click();
  await confirmPosQuantity(page);
  if (desktop) {
    await page.getByRole("button", { name: /Pay ₱145\.00/ }).click();
  } else if (tablet) {
    await page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "Pay", exact: true }).click();
  } else {
    await page.getByRole("region", { name: "Mobile cart" }).getByRole("button", { name: "Pay", exact: true }).click();
  }
  const paymentDialog = page.getByRole("dialog", { name: "Payment" });
  await expect(paymentDialog).toBeVisible();
  if (desktop) {
    await expect(page.locator('[data-ui="atlas-pos-products"]')).toBeVisible();
    await expect(paymentDialog.getByRole("heading", { name: "Choose a payment method" })).toBeVisible();
    await paymentDialog.getByRole("button", { name: "Other payment methods" }).click();
  }
  const details = page.locator('[data-ui="payment-workspace"]');
  await expect(details.getByRole("heading", { name: "Take payment" })).toBeVisible();
  await expect(details.getByRole("button", { name: "Cash", exact: true })).toBeVisible();
  const morePaymentMethods = details.getByRole("button", { name: /Other payment methods/ });
  await expect(morePaymentMethods).toHaveAttribute("aria-expanded", "false");
  await morePaymentMethods.click();
  await expect(details.getByRole("button", { name: /Fewer payment methods/ })).toHaveAttribute("aria-expanded", "true");
  await expect(details.getByRole("button", { name: "QR Ph", exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "QR Ph", exact: true })).toBeDisabled();
});
