import { expect, test } from "@playwright/test";
import { apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

test("P5: cashier POS has one heading, accessible quantity picker, and keyboard-operable responsive cart", async ({ page, request }, testInfo) => {
  test.setTimeout(210_000);
  const stamp = Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "P5 Accessibility Owner",
    email: `p5-a11y-${testInfo.project.name}-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: "P5 Isolated QA",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Accessible Oat Milk", priceMinor: 13500, stock: 20 });

  for (const width of [390, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width <= 820 ? 844 : 900 });
    await page.goto("/pos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(documentOverflow, `POS must not overflow at ${width}px`).toBeLessThanOrEqual(2);
    const product = page.getByRole("button", { name: /Accessible Oat Milk ₱135\.00/ });
    await expect(product).toBeVisible();
    await product.click();
    const picker = page.getByRole("dialog", { name: "Choose pieces" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("Line total: ₱135.00")).toHaveAttribute("aria-live", "polite");
    await expect(picker.getByRole("spinbutton", { name: "Pieces" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();

    await product.click();
    await confirmPosQuantity(page, 2);
    if (width < 1280) {
      const cart = page.getByRole("region", { name: width < 1024 ? "Mobile cart" : "Tablet cart" });
      const opener = cart.getByRole("button", { name: "View cart" });
      await opener.click();
      const drawer = page.getByRole("dialog", { name: "Tablet cart details" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Close cart" })).toBeFocused();
      for (const label of ["Close cart", "Increase Accessible Oat Milk", "Decrease Accessible Oat Milk"]) {
        const control = drawer.getByRole("button", { name: label });
        const size = await control.boundingBox();
        expect(size, `${label} must have a measurable hit target at ${width}px`).not.toBeNull();
        expect(size!.width, `${label} must have a 44px-wide hit target`).toBeGreaterThanOrEqual(44);
        expect(size!.height, `${label} must have a 44px-high hit target`).toBeGreaterThanOrEqual(44);
      }
      expect(await drawer.evaluate((node) => node.scrollWidth - node.clientWidth), `Cart drawer overflows at ${width}px`).toBeLessThanOrEqual(2);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(opener).toBeFocused();
    } else {
      const cart = page.getByRole("complementary", { name: "Cart" });
      await expect(cart.getByRole("button", { name: "Remove Accessible Oat Milk" })).toBeVisible();
    }
  }
});
