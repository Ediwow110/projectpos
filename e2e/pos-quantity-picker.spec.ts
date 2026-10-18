import { expect, test } from "@playwright/test";

import { apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

test("product quantity is chosen before cart insertion and individual lines can be removed", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Quantity QA Owner",
    email: `quantity-${testInfo.project.name}-${stamp}@example.com`,
    password,
    businessName: "Quantity QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "Quantity QA Coffee", priceMinor: 2500, stock: 20 });
  await page.goto("/pos");

  const product = page.getByRole("button", { name: /Quantity QA Coffee ₱25\.00/ });
  await expect(product).toBeVisible();
  await product.click();
  const picker = page.getByRole("dialog", { name: "Choose pieces" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("spinbutton", { name: "Pieces" })).toBeFocused();
  await expect(picker.getByText("Line total: ₱25.00")).toBeVisible();
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toBeHidden();

  await product.click();
  await picker.getByRole("spinbutton", { name: "Pieces" }).fill("4");
  await expect(picker.getByText("Line total: ₱100.00")).toBeVisible();
  await picker.getByRole("button", { name: "Add to sale" }).click();
  await expect(picker).toBeHidden();

  const desktop = (page.viewportSize()?.width ?? 1440) >= 1280;
  if (desktop) {
    const cart = page.getByRole("complementary", { name: "Cart" });
    await expect(page.getByRole("heading", { name: "Cart (4)" })).toBeVisible();
    await expect(cart.getByText("₱100.00").first()).toBeVisible();
    await cart.getByRole("button", { name: "Remove Quantity QA Coffee" }).click();
    await expect(cart.getByText("Cart is empty. Tap products to add.")).toBeVisible();
  } else {
    const tray = page.getByRole("region", { name: testInfo.project.name === "mobile" ? "Mobile cart" : "Tablet cart" });
    await expect(tray.getByText("4 items in cart")).toBeVisible();
    await tray.getByRole("button", { name: "View cart" }).click();
    const drawer = page.getByRole("dialog", { name: "Tablet cart details" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Remove Quantity QA Coffee" }).click();
    await expect(drawer.getByText("Cart is empty. Tap products to add.")).toBeVisible();
  }
});
