import { expect, test } from "@playwright/test";
import { apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

/** Computed visual contrast for normal-sized UI text, including the orange primary CTA. */
async function contrastRatio(page: import("@playwright/test").Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((node) => {
    const rgb = (input: string) => {
      const values = input.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      if (values.length !== 3) throw new Error(`Unrecognized CSS color ${input}`);
      return values.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    };
    const lightness = (color: string) => { const [r, g, b] = rgb(color); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const styles = getComputedStyle(node);
    let base = "rgb(255, 255, 255)";
    for (let current: Element | null = node; current; current = current.parentElement) {
      const candidate = getComputedStyle(current).backgroundColor;
      if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
        base = candidate;
        break;
      }
    }
    const a = lightness(styles.color);
    const b = lightness(base);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

test("P5 visual accessibility: V4 text contrast, payment disclosure and Escape recovery", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = await registerOperationalBusiness(page, {
    ownerName: "Atlas Contrast QA",
    email: `atlas-contrast-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Contrast Isolated QA",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Contrast Coffee", priceMinor: 13500, stock: 10 });
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: "Contrast Coffee ₱135.00" })).toBeVisible();

  for (const selector of [
    '[data-ui="atlas-pos-products"] > header > p',
    '[data-ui="atlas-pos-products"] button[aria-label="Contrast Coffee ₱135.00"] > span > span:last-child > span:last-child',
    '[data-ui="atlas-pos-cart"] button[aria-label^="Pay ₱"]',
  ]) expect(await contrastRatio(page, selector), `At least 4.5:1 contrast for ${selector}`).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: "Contrast Coffee ₱135.00" }).click();
  await confirmPosQuantity(page, 2);
  const opener = page.locator('[data-ui="atlas-pos-cart"] button[aria-label^="Pay ₱"]');
  await opener.click();
  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment).toBeVisible();
  expect(await contrastRatio(page, '[data-ui="payment-workspace"] > div > p:nth-of-type(2)')).toBeGreaterThanOrEqual(4.5);

  const disclosure = payment.getByRole("button", { name: "Other payment methods" });
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  const panel = page.locator("#additional-payment-methods");
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeHidden();
  await disclosure.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(payment).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(payment).toBeVisible();
});

test("P5 reflow: 320px equivalent viewport keeps all POS cart actions usable", async ({ page, request }) => {
  test.setTimeout(160_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await registerOperationalBusiness(page, {
    ownerName: "Atlas Reflow QA",
    email: `atlas-reflow-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Reflow Isolated QA",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Compact Oat Milk", priceMinor: 13500, stock: 10 });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/pos");
  const product = page.getByRole("button", { name: "Compact Oat Milk ₱135.00" });
  await expect(product).toBeVisible();
  const productBox = await product.boundingBox();
  expect(productBox).not.toBeNull();
  expect(productBox!.x).toBeGreaterThanOrEqual(0);
  expect(productBox!.x + productBox!.width).toBeLessThanOrEqual(321);
  await product.click();
  await confirmPosQuantity(page, 2);

  const tray = page.getByRole("region", { name: "Mobile cart" });
  for (const control of ["View cart", "Held 0", "Pay"]) {
    const button = tray.getByRole("button", { name: control, exact: true });
    await expect(button).toBeVisible();
    const rect = await button.boundingBox();
    expect(rect, `${control} must have a rendered hit target`).not.toBeNull();
    expect(rect!.x, `${control} left boundary`).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width, `${control} right boundary`).toBeLessThanOrEqual(321);
    expect(rect!.height, `${control} minimum target height`).toBeGreaterThanOrEqual(44);
  }
  await tray.getByRole("button", { name: "View cart" }).click();
  const drawer = page.getByRole("dialog", { name: "Tablet cart details" });
  await expect(drawer).toBeVisible();
  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(drawerBounds!.x + drawerBounds!.width).toBeLessThanOrEqual(321);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
