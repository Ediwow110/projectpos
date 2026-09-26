import { expect, test, type Locator } from "@playwright/test";
import { apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

type Box = { x: number; y: number; width: number; height: number };

async function expectBox(locator: Locator, expected: Box): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeCloseTo(expected.x, 0);
  expect(box!.y).toBeCloseTo(expected.y, 0);
  expect(box!.width).toBeCloseTo(expected.width, 0);
  expect(box!.height).toBeCloseTo(expected.height, 0);
}

test("POS matches canonical Figma frame geometry", async ({ page, request }, testInfo) => {
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  const productVisual = product.locator('[data-ui="product-visual"]');

  if (desktop) {
    await expectBox(page.locator("header").first(), { x: 214, y: 40, width: 1212, height: 60 });
    await expectBox(page.locator("aside").first().locator(":scope > div"), { x: 24, y: 40, width: 178, height: 944 });
    await expectBox(page.locator("main").first(), { x: 214, y: 118, width: 1212, height: 866 });
    await expectBox(search, { x: 232, y: 136, width: 650, height: 54 });
    await expectBox(page.getByRole("button", { name: "Scan F2" }), { x: 892, y: 136, width: 82, height: 54 });
    await expectBox(page.getByRole("button", { name: "All", exact: true }), { x: 232, y: 206, width: 58, height: 34 });
    await expectBox(product, { x: 232, y: 260, width: 176, height: 152 });
    await expectBox(productVisual, { x: 244, y: 272, width: 152, height: 62 });
    await expectBox(product.locator('[data-ui="product-add"]'), { x: 368, y: 374, width: 28, height: 28 });
    await expectBox(page.getByRole("complementary", { name: "Cart" }), { x: 974, y: 118, width: 452, height: 866 });
    await expectBox(page.getByRole("complementary", { name: "Cart" }).getByRole("button", { name: "Hold" }), {
      x: 1256,
      y: 134,
      width: 90,
      height: 34,
    });
    await expectBox(page.getByRole("complementary", { name: "Cart" }).getByRole("button", { name: "Clear sale", exact: true }), {
      x: 1354,
      y: 134,
      width: 42,
      height: 34,
    });

    await product.click();
    await page.getByRole("button", { name: /Pay ₱145\.00/ }).click();
    const payment = page.locator('[data-ui="payment-workspace"]');
    await expectBox(payment, { x: 214, y: 118, width: 1212, height: 866 });
    await expectBox(payment.getByRole("button", { name: "Cash", exact: true }), { x: 260, y: 384, width: 176, height: 52 });
    await expectBox(payment.getByRole("button", { name: "Card", exact: true }), { x: 450, y: 384, width: 176, height: 52 });
    await expectBox(payment.getByLabel("Cash received"), { x: 260, y: 574, width: 556, height: 66 });
    await expectBox(payment.getByRole("button", { name: /Complete payment/ }), { x: 260, y: 786, width: 556, height: 64 });
    return;
  }

  await expectBox(page.locator("header").first(), { x: 40, y: 30, width: 944, height: 62 });
  await expectBox(page.locator("main").first(), { x: 40, y: 116, width: 944, height: 1090 });
  await expectBox(search, { x: 68, y: 140, width: 888, height: 54 });
  await expectBox(page.getByRole("button", { name: "All items" }), { x: 68, y: 212, width: 80, height: 34 });
  await expectBox(product, { x: 68, y: 268, width: 280, height: 220 });
  await expectBox(productVisual, { x: 82, y: 282, width: 252, height: 100 });
  await expectBox(page.getByRole("region", { name: "Tablet cart" }), { x: 0, y: 1206, width: 1024, height: 160 });
  await expectBox(page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "View cart" }), {
    x: 28,
    y: 1294,
    width: 180,
    height: 48,
  });
  await expectBox(page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "Pay", exact: true }), {
    x: 706,
    y: 1286,
    width: 290,
    height: 56,
  });
});
