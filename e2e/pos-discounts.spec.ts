import { expect, test, type Page } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  clickPosPay,
  expectOnePosCartItem,
  posCartRegion,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

async function createCounterWithOpenShift(page: Page, name: string): Promise<void> {
  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  const registerDialog = page.getByRole("dialog", { name: "Create register" });
  await registerDialog.getByLabel("Register name").fill(name);
  await registerDialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  const shiftDialog = page.getByRole("dialog", { name: "Open shift" });
  await shiftDialog.getByLabel("Register").selectOption({ label: name });
  await shiftDialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();
}

async function selectPosRegister(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 768) {
    await page.getByLabel("Mobile register").selectOption({ label: name });
  } else {
    await page.getByLabel("Register", { exact: true }).selectOption({ label: name });
  }
}

async function openDiscounts(page: Page): Promise<ReturnType<Page["getByRole"]>> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1280) {
    await posCartRegion(page).getByRole("button", { name: "Discounts", exact: true }).click();
  } else {
    await posCartRegion(page).getByRole("button", { name: "View cart", exact: true }).click();
    await page.getByRole("dialog", { name: "Tablet cart details" }).getByRole("button", { name: "Discounts", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Sale discounts" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectPosStatus(page: Page, text: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText(text, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByText(text, { exact: true })).toBeVisible();
  }
}

test("seller applies line and order discounts at the non-override thresholds and receipt stays authoritative", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Discount Owner",
    email: `discount-owner-${stamp}@example.com`,
    password,
    businessName: `Discount Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, password, page);
  const productName = `Discount Coffee ${stamp}`;
  await seedProduct(request, headers, { name: productName, priceMinor: 2500, stock: 10 });
  await createCounterWithOpenShift(page, "Discount Counter");

  await page.goto("/pos");
  await selectPosRegister(page, "Discount Counter");
  await page.getByLabel("Search product, SKU or scan barcode").fill(productName);
  await page.getByRole("button", { name: `${productName} ₱25.00` }).click();
  await expectOnePosCartItem(page);

  const discountDialog = await openDiscounts(page);
  await discountDialog.getByLabel("Order discount (PHP)").fill("2.00");
  await discountDialog.getByLabel(new RegExp(`Line discount — ${productName} \\(PHP\\)`)).fill("5.00");
  await discountDialog.getByRole("button", { name: "Apply discounts" }).click();
  await expect(discountDialog).toBeHidden();

  await clickPosPay(page, "18.00");
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expectPosStatus(page, "Sale completed.");

  const sales = await request.get(`${API}/api/v1/sales?limit=20`, { headers });
  expect(sales.ok()).toBe(true);
  const completed = ((await sales.json()) as { items: Array<{ id: string; status: string; totalMinor: number }> }).items
    .find((sale) => sale.status === "COMPLETED" && sale.totalMinor === 1800);
  expect(completed).toBeTruthy();
  const receipt = await request.get(`${API}/api/v1/receipts/${completed!.id}`, { headers });
  expect(receipt.ok()).toBe(true);
  const receiptBody = await receipt.json() as {
    discountMinor: number;
    totalMinor: number;
    items: Array<{ name: string; lineDiscountMinor: number; lineTotalMinor: number }>;
  };
  expect(receiptBody.discountMinor).toBe(200);
  expect(receiptBody.totalMinor).toBe(1800);
  expect(receiptBody.items.find((item) => item.name === productName)).toMatchObject({
    lineDiscountMinor: 500,
    lineTotalMinor: 2000,
  });
});

test("cashier completes an over-threshold discount after one-use owner approval", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const ownerPassword = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Discount Auth Owner",
    email: `discount-auth-owner-${stamp}@example.com`,
    password: ownerPassword,
    businessName: `Discount Auth Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, ownerPassword, page);
  const approvalPin = "482615";
  const memberships = await request.get(`${API}/api/v1/memberships`, { headers });
  expect(memberships.ok()).toBe(true);
  const ownerMembership = ((await memberships.json()) as { items: Array<{ id: string; email: string; role: string }> }).items
    .find((member) => member.email === ownerEmail && member.role === "owner");
  expect(ownerMembership).toBeTruthy();
  const setPin = await request.post(`${API}/api/v1/memberships/${ownerMembership!.id}/approval-pin`, {
    headers,
    data: { pin: approvalPin },
  });
  expect(setPin.ok()).toBe(true);
  const productName = `Auth Coffee ${stamp}`;
  await seedProduct(request, headers, { name: productName, priceMinor: 2500, stock: 10 });
  await createCounterWithOpenShift(page, "Auth Counter");

  const cashierEmail = `discount-cashier-${process.env.TEST_WORKER_INDEX ?? "w"}-${stamp}@example.com`;
  const membership = await request.post(`${API}/api/v1/memberships`, {
    headers,
    data: { name: "Discount Cashier", email: cashierEmail, role: "cashier" },
  });
  expect(membership.ok()).toBe(true);
  const tempPassword = ((await membership.json()) as { tempPassword?: string }).tempPassword ?? "";
  expect(tempPassword.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(cashierEmail);
  await page.getByLabel("Password").fill(tempPassword);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible({ timeout: 30_000 });
  await tour.getByRole("button", { name: "Skip tour" }).click();

  await page.goto("/pos");
  await selectPosRegister(page, "Auth Counter");
  await page.getByLabel("Search product, SKU or scan barcode").fill(productName);
  await page.getByRole("button", { name: `${productName} ₱25.00` }).click();
  await expectOnePosCartItem(page);

  const discountDialog = await openDiscounts(page);
  await discountDialog.getByLabel("Order discount (PHP)").fill("3.00");
  await discountDialog.getByRole("button", { name: "Apply discounts" }).click();
  await expect(discountDialog).toBeHidden();

  await clickPosPay(page, "22.00");
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expect(page.getByRole("dialog", { name: "Payment" })).toHaveCount(0);

  const approvalDialog = page.getByRole("dialog", { name: "Manager approval" });
  await expect(approvalDialog).toBeVisible();
  await approvalDialog.getByLabel("Manager email").fill(ownerEmail);
  await approvalDialog.getByLabel("Approval PIN").fill("111111");
  await approvalDialog.getByRole("button", { name: "Approve & continue" }).click();
  await expect(approvalDialog.getByRole("alert")).toContainText("Manager credentials could not be verified");
  await expect(approvalDialog).toBeVisible();

  await approvalDialog.getByLabel("Approval PIN").fill(approvalPin);
  await approvalDialog.getByRole("button", { name: "Approve & continue" }).click();
  await expect(approvalDialog).toBeHidden({ timeout: 30_000 });
  await expectPosStatus(page, "Sale completed.");

  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, tempPassword, page);
  const sales = await request.get(`${API}/api/v1/sales?limit=20`, { headers: cashierHeaders });
  expect(sales.ok()).toBe(true);
  const completed = ((await sales.json()) as { items: Array<{ status: string; totalMinor: number }> }).items
    .find((sale) => sale.status === "COMPLETED" && sale.totalMinor === 2200);
  expect(completed).toBeTruthy();

  const browserStorage = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  expect(browserStorage).not.toContain(ownerPassword);
  expect(browserStorage).not.toContain(approvalPin);
});
