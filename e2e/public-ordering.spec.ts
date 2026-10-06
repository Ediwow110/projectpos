import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

async function setupPublicStorefront(
  page: Page,
  request: APIRequestContext,
  suffix: string,
): Promise<{ storefrontKey: string; branchName: string; productName: string }> {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Public Order Owner",
    email: "public-order-" + suffix + "@example.com",
    password,
    businessName: "Public Order Store " + suffix,
  });
  const auth = await apiAuthedContext(request, email, password, page);
  const branchName = "Pickup " + suffix;
  const branchResponse = await request.post(API + "/api/v1/branches", {
    headers: auth.headers,
    data: { name: branchName },
  });
  expect(branchResponse.ok()).toBe(true);
  const branch = (await branchResponse.json()) as { id: string };

  const productName = "Guest Coffee " + suffix;
  const productResponse = await request.post(API + "/api/v1/products", {
    headers: auth.headers,
    data: { name: productName, priceMinor: 12500, costMinor: 6000 },
  });
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()) as { id: string };
  const stock = await request.post(API + "/api/v1/inventory/movements", {
    headers: auth.headers,
    data: { productId: product.id, branchId: branch.id, type: "opening_stock", qtyDelta: 8 },
  });
  expect(stock.ok()).toBe(true);

  const settings = await request.patch(API + "/api/v1/business/settings", {
    headers: auth.headers,
    data: {
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: [branch.id],
      onlineFulfillmentBranchId: branch.id,
      deliveryFlatFeeMinor: 5000,
    },
  });
  expect(settings.ok()).toBe(true);
  const business = await request.get(API + "/api/v1/business", { headers: auth.headers });
  expect(business.ok()).toBe(true);
  const body = (await business.json()) as { storefrontKey: string | null };
  expect(body.storefrontKey).toMatch(/^[a-f0-9]{32}$/);

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  return { storefrontKey: body.storefrontKey!, branchName, productName };
}

test("guest pickup checkout keeps branch availability authoritative and lands on secure status", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const suffix = testInfo.project.name + "-" + Date.now();
  const setup = await setupPublicStorefront(page, request, suffix);

  await page.goto("/order?storefront=" + setup.storefrontKey);
  await expect(page.getByRole("heading", { name: new RegExp("^Order from Public Order Store") })).toBeVisible();
  await expect(page.getByText(setup.productName)).toHaveCount(0);

  await page.getByLabel("Store location").selectOption({ label: setup.branchName });
  await expect(page.getByText(setup.productName)).toBeVisible();
  await page.getByRole("button", { name: "Add to order" }).click();
  await page.getByLabel("Name").fill("Guest Buyer");
  await page.getByLabel("Email").fill("guest@example.com");
  await page.getByLabel("Contact number").fill("+639171234567");
  await page.getByRole("button", { name: "Submit pickup order" }).click();

  await expect(page).toHaveURL(new RegExp("/order-status$"), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Awaiting staff confirmation" })).toBeVisible();
  await expect(page.getByText("Payment has not been collected yet.")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }))).toEqual({ local: [], session: [] });
});

test("delivery requires prepaid payment in the public UI", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const suffix = "delivery-" + testInfo.project.name + "-" + Date.now();
  const setup = await setupPublicStorefront(page, request, suffix);

  await page.goto("/order?storefront=" + setup.storefrontKey);
  await page.getByRole("button", { name: "Delivery" }).click();
  await page.getByLabel("Store location").selectOption({ label: setup.branchName });
  await expect(page.getByRole("button", { name: "Pay at pickup" })).toHaveCount(0);
  await expect(page.getByLabel("Payment method")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to secure payment" })).toBeVisible();
});
