import { expect, test, type Page } from "@playwright/test";

import {
  apiAuthedContext,
  clickPosPay,
  confirmPosQuantity,
  posCartRegion,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

// Native-click regression on the Atlas V4 two-pane grid and 78px sale rail.
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

async function expectCartActionReachable(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const pay = document.querySelector<HTMLButtonElement>('[data-ui="atlas-pos-cart"] button[aria-label^="Pay ₱"]');
    if (!pay) return { found: false, right: 0, viewport: window.innerWidth, hit: "missing" };
    const rect = pay.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      found: true,
      right: rect.x + rect.width,
      viewport: window.innerWidth,
      hit: hit === pay || (hit instanceof Node && pay.contains(hit)) ? "pay" : (hit as Element | null)?.tagName ?? "none",
    };
  });
  expect(geometry.found, "desktop Pay action exists").toBe(true);
  expect(
    geometry.right,
    `Pay action (right=${geometry.right}) must fit inside viewport ${geometry.viewport}`,
  ).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.hit, "Pay action must be the hit-test target, not an overlapping pane").toBe("pay");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal document overflow").toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test(`pos cart controls accept native pointer clicks at ${viewport.width}px`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    const stamp = Date.now();
    const password = "correct-horse-12";
    const email = await registerOperationalBusiness(page, {
      ownerName: "Responsive Owner",
      email: `e2e-responsive-${stamp}@example.com`,
      password,
      businessName: "Responsive Layout QA",
    });
    const { headers } = await apiAuthedContext(request, email, password, page);
    await seedProduct(request, headers, { name: `Responsive B ${stamp}`, priceMinor: 2000, stock: 10 });
    await seedProduct(request, headers, { name: `Responsive A ${stamp}`, priceMinor: 1000, stock: 10 });

    await page.goto("/pos");
    // Non-alphabetical add order exercises cart ordering alongside layout.
    await page.getByRole("button", { name: new RegExp(`Responsive B ${stamp}.*₱20\\.00`) }).click();
    await confirmPosQuantity(page);
    await page.getByRole("button", { name: new RegExp(`Responsive A ${stamp}.*₱10\\.00`) }).click();
    await confirmPosQuantity(page);
    await expect(page.getByRole("heading", { name: "Cart (2)" })).toBeVisible();

    // Quantity controls: native clicks, previously intercepted by the products pane.
    await page.getByRole("button", { name: `Increase Responsive A ${stamp}` }).click();
    await expect(page.getByText(/Qty 2 × ₱10\.00/).first()).toBeVisible();
    await page.getByRole("button", { name: `Decrease Responsive A ${stamp}` }).click();
    await expect(page.getByText(/Qty 1 × ₱10\.00/).first()).toBeVisible();

    await expectCartActionReachable(page);

    // Discounts dialog opens natively and cancels cleanly (no sale).
    await posCartRegion(page).getByRole("button", { name: "Discounts", exact: true }).click();
    const discounts = page.getByRole("dialog", { name: "Sale discounts" });
    await expect(discounts).toBeVisible();
    await discounts.getByRole("button", { name: "Cancel" }).click();
    await expect(discounts).toBeHidden();

    // Payment UI opens natively; Back to sale closes without completing any transaction.
    await clickPosPay(page, "30.00");
    const payment = page.getByRole("dialog", { name: "Payment" });
    await expect(payment).toBeVisible();
    await payment.getByRole("button", { name: "Back to sale" }).click();
    await expect(payment).toBeHidden();

    await expectCartActionReachable(page);
  });
}
