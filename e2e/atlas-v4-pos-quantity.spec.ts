import { expect, test } from "@playwright/test";
import { apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

test("Atlas V4 chooses pieces before adding to sale and explicitly removes a line", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const email = await registerOperationalBusiness(page, {
    ownerName: "Quantity QA Owner",
    email: `v4-quantity-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Quantity QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Quantity Milk", priceMinor: 13500, stock: 30 });

  await page.goto("/pos");
  const quantityTrigger = page.getByRole("button", { name: /Quantity Milk ₱135\.00/ });
  await quantityTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Choose pieces" });
  await expect(dialog).toBeVisible();
  const pieces = dialog.getByRole("spinbutton", { name: "Pieces" });
  await pieces.fill("0");
  expect(await pieces.evaluate((element) => (element as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  await pieces.fill("1000");
  expect(await pieces.evaluate((element) => (element as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await pieces.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(quantityTrigger).toBeFocused();
  await quantityTrigger.click();
  await pieces.fill("3");
  await expect(dialog.getByText("Line total: ₱405.00")).toBeVisible();
  await dialog.getByRole("button", { name: "Add to sale" }).click();
  await expect(dialog).toBeHidden();

  if (testInfo.project.name === "desktop") {
    const cart = page.getByRole("complementary", { name: "Cart" });
    const line = cart.getByRole("listitem").filter({ hasText: "Quantity Milk" });
    await expect(line.getByText("Qty 3 × ₱135.00", { exact: true })).toBeVisible();
    await expect(line.getByText("₱405.00", { exact: true })).toBeVisible();
    await cart.getByRole("button", { name: "Remove Quantity Milk" }).click();
    await expect(cart.getByText("Cart is empty. Tap products to add.")).toBeVisible();
  } else {
    const cartBar = page.getByRole("region", { name: testInfo.project.name === "tablet" ? "Tablet cart" : "Mobile cart" });
    await cartBar.getByRole("button", { name: "View cart" }).click();
    const cart = page.getByRole("dialog", { name: "Tablet cart details" });
    await expect(cart.getByText("Quantity Milk")).toBeVisible();
    await expect(cart.getByText("3 × ₱135.00 = ₱405.00")).toBeVisible();
    await cart.getByRole("button", { name: "Remove Quantity Milk" }).click();
    await expect(cart.getByText("Cart is empty. Tap products to add.")).toBeVisible();
    await cart.getByRole("button", { name: "Close cart" }).click();
  }

  // Reopening a product must require quantity confirmation again.
  await page.getByRole("button", { name: /Quantity Milk ₱135\.00/ }).click();
  await confirmPosQuantity(page, 1);
  if (testInfo.project.name === "desktop") {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByRole("heading", { name: "Cart (1)" })).toBeVisible();
  } else {
    const cartBar = page.getByRole("region", { name: testInfo.project.name === "tablet" ? "Tablet cart" : "Mobile cart" });
    await expect(cartBar.getByText("1 item in cart", { exact: true })).toBeVisible();
  }
});
