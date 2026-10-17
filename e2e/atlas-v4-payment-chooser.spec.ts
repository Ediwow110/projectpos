import { expect, test } from "@playwright/test";
import { apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

test("Atlas V4 desktop payment chooser selects a method without bypassing hosted checkout gates", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = await registerOperationalBusiness(page, {
    ownerName: "Payment Chooser QA",
    email: `v4-payment-chooser-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Payment Chooser QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Chooser Milk", priceMinor: 13500, stock: 10 });

  await page.goto("/pos");
  await page.getByRole("button", { name: /Chooser Milk ₱135\.00/ }).click();
  const cart = page.getByRole("complementary", { name: "Cart" });
  const payButton = cart.getByRole("button", { name: /Pay ₱135\.00/ });
  await payButton.click();

  const chooser = page.getByRole("dialog", { name: "Payment" });
  await expect(chooser).toHaveAttribute("data-ui", "atlas-v4-payment-chooser");
  await expect(chooser.getByRole("heading", { name: "Choose a payment method" })).toBeVisible();
  await expect(chooser).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect((await chooser.boundingBox())?.width).toBeCloseTo(530, 0);
  await expect(chooser.getByRole("button", { name: "Cash", exact: true })).toBeEnabled();
  await expect(chooser.getByRole("button", { name: "Card", exact: true })).toBeDisabled();
  await expect(chooser.getByRole("button", { name: "QR Ph", exact: true })).toBeDisabled();
  await expect(cart).toBeVisible();
  await expect(chooser.getByRole("button", { name: "Back to sale" })).toBeFocused();

  // Tab stays inside the modal, skipping disabled provider options.
  await page.keyboard.press("Shift+Tab");
  await expect(chooser.getByRole("button", { name: "Other payment methods" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(chooser.getByRole("button", { name: "Cash", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(chooser.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(chooser.getByRole("button", { name: "Cash", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(chooser).toBeHidden();
  await expect(payButton).toBeFocused();
  await payButton.click();
  await chooser.getByRole("button", { name: "Back to sale" }).click();
  await expect(chooser).toBeHidden();
  await expect(payButton).toBeFocused();
  await expect(cart.getByText("Qty 1 × ₱135.00", { exact: true })).toBeVisible();
  await payButton.click();
  await chooser.getByRole("button", { name: "Continue" }).click();
  const details = page.getByRole("dialog", { name: "Payment" });
  await expect(details.getByRole("heading", { name: "Take payment" })).toBeVisible();
  await expect(details.getByRole("heading", { name: "Take payment" })).toBeFocused();
  await expect(details.getByText("₱135.00", { exact: true }).first()).toBeVisible();
  await details.getByRole("button", { name: "Back to sale" }).click();
  await expect(cart).toBeVisible();
  await expect(payButton).toBeFocused();

  // Alternative tenders remain reachable even though Figma emphasizes three choices.
  await payButton.click();
  await chooser.getByRole("button", { name: "Other payment methods" }).click();
  await expect(page.getByRole("dialog", { name: "Payment" }).getByRole("heading", { name: "Take payment" })).toBeVisible();
  await details.getByRole("button", { name: "Back to sale" }).click();
  await payButton.click();

  // Shrinking the viewport must never strand the cashier in a hidden chooser.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('[data-ui="atlas-v4-payment-chooser"]')).toHaveCount(0);
  const tabletDetails = page.getByRole("dialog", { name: "Payment" });
  await expect(tabletDetails.getByRole("heading", { name: "Payment", exact: true })).toBeVisible();
  await expect(tabletDetails.getByRole("heading", { name: "Payment", exact: true })).toBeFocused();
  await tabletDetails.getByRole("button", { name: "Close payment" }).click();
  await expect(page.getByRole("region", { name: "Tablet cart" })).toBeVisible();
});
