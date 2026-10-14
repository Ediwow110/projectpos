import { expect, test, type Page } from "@playwright/test";
import {
  API,
  apiAuthedContext,
  clickPosPay,
  createCounterWithOpenShift,
  expectOnePosCartItem,
  posCartRegion,
  registerOperationalBusiness,
  seedProduct,
  selectPosRegister,
} from "./helpers";

async function completeCustomerValueSale(page: Page, registerName: string, productName: string,
  customerName: string, method: "Store credit" | "Loyalty"): Promise<void> {
  await page.goto("/pos");
  await selectPosRegister(page, registerName);
  await page.getByLabel("Search product, SKU or scan barcode").fill(productName);
  await page.getByRole("button", { name: `${productName} ₱25.00` }).click();
  await expectOnePosCartItem(page);

  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await posCartRegion(page).getByRole("button", { name: "View cart" }).click();
    await page.getByRole("dialog", { name: "Tablet cart details" })
      .getByRole("button", { name: "Add customer" }).click();
  } else {
    await posCartRegion(page).getByRole("button", { name: "Assign customer to sale" }).click();
  }
  const customerDialog = page.getByRole("dialog", { name: "Customer assignment" });
  await customerDialog.getByRole("textbox", { name: "Customer", exact: true }).fill(customerName);
  await customerDialog.getByRole("button", { name: customerName, exact: true }).click();
  await expect(customerDialog).toContainText(`Selected: ${customerName}`);
  await customerDialog.getByRole("button", { name: "Use for sale" }).click();

  await clickPosPay(page, "25.00");
  const payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment).toBeVisible();
  await payment.getByRole("button", { name: method, exact: true }).click();
  await payment.getByRole("button", { name: /Complete payment/i }).click();
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" })
      .getByText("Sale completed.")).toBeVisible();
  } else {
    await expect(posCartRegion(page).getByText("Sale completed.")).toBeVisible();
  }
}

test("customer store credit and loyalty are redeemed once through local POS checkout", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Value checkout owner", email: `value-checkout-${stamp}@example.com`, password,
    businessName: `Value checkout store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const customerName = `Value checkout customer ${stamp}`;
  const customerResponse = await request.post(`${API}/api/v1/customers`, {
    headers, data: { name: customerName },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await customerResponse.json() as { id: string };
  const productName = `Value checkout coffee ${stamp}`;
  await seedProduct(request, headers, { name: productName, priceMinor: 2500, stock: 5 });
  const credit = await request.post(`${API}/api/v1/customers/${customer.id}/store-credit/adjust`, {
    headers: { ...headers, "Idempotency-Key": `value-credit-${stamp}` },
    data: { amountMinor: 2500, reason: "Verified local checkout balance" },
  });
  expect(credit.ok()).toBe(true);
  const registerName = `Value counter ${stamp}`;
  await createCounterWithOpenShift(page, registerName);

  await completeCustomerValueSale(page, registerName, productName, customerName, "Store credit");
  const afterCredit = await request.get(`${API}/api/v1/customers/${customer.id}/stored-value`, { headers });
  expect(afterCredit.ok()).toBe(true);
  await expect(afterCredit.json()).resolves.toMatchObject({ storeCreditMinor: 0 });

  const program = await request.post(`${API}/api/v1/loyalty/program`, {
    headers, data: { enabled: true, earnAmountMinor: 100000, earnPoints: 1,
      redeemPoints: 100, redeemValueMinor: 2500, minimumRedeemPoints: 100 },
  });
  expect(program.ok()).toBe(true);
  const loyalty = await request.post(`${API}/api/v1/customers/${customer.id}/loyalty/adjust`, {
    headers: { ...headers, "Idempotency-Key": `value-loyalty-${stamp}` },
    data: { amountMinor: 100, reason: "Verified local checkout points" },
  });
  expect(loyalty.ok()).toBe(true);
  await completeCustomerValueSale(page, registerName, productName, customerName, "Loyalty");
  const afterLoyalty = await request.get(`${API}/api/v1/customers/${customer.id}/stored-value`, { headers });
  expect(afterLoyalty.ok()).toBe(true);
  await expect(afterLoyalty.json()).resolves.toMatchObject({ storeCreditMinor: 0, loyaltyPoints: 0 });
});
