import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API, apiAuthedContext, confirmPosQuantity, registerOperationalBusiness, seedProduct } from "./helpers";

const OUT = join(".superpowers", "sdd", "2026-09-25-premium-ui-implementation", "visual-audit");

async function settle(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => document.fonts.ready);
  await page.waitForTimeout(200);
}

test("capture Figma-sized POS surfaces", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  await mkdir(OUT, { recursive: true });
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
  await registerOperationalBusiness(page, {
    ownerName: "Visual Audit Owner",
    email: `visual-${testInfo.project.name}-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: "NexPOS Market",
  });
  const { headers } = await apiAuthedContext(request, "", "", page);

  for (const name of ["Coffee", "Drinks", "Snacks", "Pantry"]) {
    const category = await request.post(`${API}/api/v1/categories`, { headers, data: { name } });
    expect(category.ok()).toBe(true);
  }
  for (const [name, priceMinor, stock] of [
    ["Iced Latte", 14500, 30],
    ["Fresh Milk", 12000, 20],
    ["Bread Loaf", 11000, 12],
    ["Mineral Water", 4500, 48],
    ["Potato Chips", 7500, 8],
    ["Brown Sugar", 9200, 15],
    ["Dish Soap", 12500, 8],
    ["Instant Noodles", 1800, 64],
    ["Chocolate Bar", 8500, 16],
  ] as const) {
    await seedProduct(request, headers, { name, priceMinor, stock });
  }
  for (const [step, state] of [
    ["taxCurrency", "done"],
    ["receiptSetup", "done"],
    ["products", "skipped"],
    ["employees", "skipped"],
  ] as const) {
    const patched = await request.patch(`${API}/api/v1/onboarding`, { headers, data: { step, state } });
    expect(patched.ok()).toBe(true);
  }

  await page.goto("/pos");
  await expect(page.getByLabel("Search product, SKU or scan barcode")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Iced Latte ₱145\.00/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Iced Latte ₱145\.00/ }).click();
  await confirmPosQuantity(page);
  await settle(page);
  await page.screenshot({
    path: join(
      OUT,
      desktop
        ? "polished-pos-desktop.jpg"
        : tablet
          ? "polished-pos-tablet.jpg"
          : "polished-pos-mobile.jpg",
    ),
    type: "jpeg",
    quality: 82,
  });

  if (desktop) {
    await page.getByRole("button", { name: /Pay ₱145\.00/ }).click();
    await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
    await settle(page);
    await page.screenshot({
      path: join(OUT, "polished-payment.jpg"),
      type: "jpeg",
      quality: 82,
    });
  }
});
