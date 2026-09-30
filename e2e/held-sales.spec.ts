import { expect, test, type Page } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  clickPosPay,
  expectOnePosCartItem,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

async function holdCurrentSale(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1280) {
    await page.getByRole("complementary", { name: "Cart" }).getByRole("button", { name: "Hold", exact: true }).click();
    return;
  }
  const tray = page.getByRole("region", { name: width < 768 ? "Mobile cart" : "Tablet cart" });
  await tray.getByRole("button", { name: "View cart" }).click();
  await page.getByRole("dialog", { name: "Tablet cart details" }).getByRole("button", { name: "Hold", exact: true }).click();
}

async function openHeldSales(page: Page, count: number): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  const name = `Held ${count}`;
  if (width >= 1280) {
    await page.getByRole("complementary", { name: "Cart" }).getByRole("button", { name, exact: true }).click();
    return;
  }
  const tray = page.getByRole("region", { name: width < 768 ? "Mobile cart" : "Tablet cart" });
  await tray.getByRole("button", { name, exact: true }).click();
}

test("seller can hold, find, resume, and complete the original draft", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const email = `held-sales-${stamp}@example.com`;
  const password = "correct-horse-12";
  const productName = `Held Coffee ${stamp}`;

  await registerOperationalBusiness(page, {
    ownerName: "Held Sales Owner",
    email,
    password,
    businessName: `Held Sales Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, { name: productName, priceMinor: 2500, stock: 10 });

  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  const registerDialog = page.getByRole("dialog", { name: "Create register" });
  await registerDialog.getByLabel("Register name").fill("Held Counter");
  await registerDialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Held Counter", { exact: true })).toBeVisible();

  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  const shiftDialog = page.getByRole("dialog", { name: "Open shift" });
  await shiftDialog.getByLabel("Register").selectOption({ label: "Held Counter" });
  await shiftDialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();

  await page.goto("/pos");
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 768) {
    await page.getByLabel("Mobile register").selectOption({ label: "Held Counter" });
  } else {
    await page.getByLabel("Register", { exact: true }).selectOption({ label: "Held Counter" });
  }
  await page.getByLabel("Search product, SKU or scan barcode").fill(productName);
  const productButton = page.getByRole("button", { name: `${productName} ₱25.00` });
  await productButton.click();
  await expectOnePosCartItem(page);

  await holdCurrentSale(page);
  if (width < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText("Sale held. Open Held sales to resume it later.")).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByText("Sale held. Open Held sales to resume it later.")).toBeVisible();
  }
  await openHeldSales(page, 1);

  const heldDialog = page.getByRole("dialog", { name: "Held sales" });
  await expect(heldDialog).toBeVisible();
  await expect(heldDialog.getByText(productName + " ×1")).toBeVisible();
  await expect(heldDialog.getByText("₱25.00")).toBeVisible();
  await heldDialog.getByRole("button", { name: "Resume sale" }).click();
  await expect(heldDialog).toBeHidden();
  if (width < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText("Held sale resumed. Its saved cart is locked until payment or re-hold.")).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByText("Held sale resumed. Its saved cart is locked until payment or re-hold.")).toBeVisible();
  }
  await expect(productButton).toBeDisabled();
  await expectOnePosCartItem(page);

  const heldAfterResume = await request.get(`${API}/api/v1/sales/held`, { headers });
  expect(heldAfterResume.ok()).toBe(true);
  expect(((await heldAfterResume.json()) as { items: unknown[] }).items).toHaveLength(0);

  await clickPosPay(page, "25.00");
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();
  if (width < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText("Sale completed.")).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByText("Sale completed.")).toBeVisible();
  }

  const balances = await request.get(`${API}/api/v1/inventory/balances`, { headers });
  expect(balances.ok()).toBe(true);
  const balanceRows = ((await balances.json()) as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  expect(balanceRows.find((row) => row.productId === productId)?.qtyOnHand).toBe(9);
});
