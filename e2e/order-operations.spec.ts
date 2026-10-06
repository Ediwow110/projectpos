import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

function checkoutCookie(headers: Array<{ name: string; value: string }>): string {
  return headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0])
    .join("; ");
}

async function createBranchAndProduct(
  request: APIRequestContext,
  headers: Record<string, string>,
  suffix: string,
): Promise<{ branchId: string; branchName: string; productId: string }> {
  const branchName = "Online " + suffix;
  const branchResponse = await request.post(API + "/api/v1/branches", {
    headers,
    data: { name: branchName },
  });
  expect(branchResponse.ok()).toBe(true);
  const branchId = ((await branchResponse.json()) as { id: string }).id;

  const productResponse = await request.post(API + "/api/v1/products", {
    headers,
    data: { name: "Order Coffee " + suffix, priceMinor: 12500, costMinor: 6000 },
  });
  expect(productResponse.ok()).toBe(true);
  const productId = ((await productResponse.json()) as { id: string }).id;
  expect((await request.post(API + "/api/v1/inventory/movements", {
    headers,
    data: { productId, branchId, type: "opening_stock", qtyDelta: 12 },
  })).ok()).toBe(true);
  return { branchId, branchName, productId };
}

async function enableOrdering(
  request: APIRequestContext,
  headers: Record<string, string>,
  branchId: string,
): Promise<{ storefrontKey: string; businessId: string }> {
  const settings = await request.patch(API + "/api/v1/business/settings", {
    headers,
    data: {
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: [branchId],
      onlineFulfillmentBranchId: branchId,
      deliveryFlatFeeMinor: 4900,
    },
  });
  expect(settings.ok()).toBe(true);
  const business = await request.get(API + "/api/v1/business", { headers });
  expect(business.ok()).toBe(true);
  const body = (await business.json()) as { id: string; storefrontKey: string };
  return { storefrontKey: body.storefrontKey, businessId: body.id };
}

async function submitPayAtPickup(
  request: APIRequestContext,
  input: { storefrontKey: string; branchId: string; productId: string; suffix: string },
): Promise<string> {
  const origin = "http://localhost:3100";
  const created = await request.post(API + "/api/v1/public/orders", {
    headers: { Origin: origin, "Idempotency-Key": "ops-create-" + input.suffix },
    data: { storefrontKey: input.storefrontKey },
  });
  expect(created.ok()).toBe(true);
  const cookie = checkoutCookie(created.headersArray());
  const orderId = ((await created.json()) as { id: string }).id;
  expect((await request.patch(API + "/api/v1/public/orders/" + orderId + "/draft", {
    headers: { Origin: origin, Cookie: cookie },
    data: { branchId: input.branchId, fulfillmentMode: "PICKUP", lines: [{ productId: input.productId, qty: 1 }] },
  })).ok()).toBe(true);
  const submitted = await request.post(API + "/api/v1/public/orders/" + orderId + "/submit", {
    headers: { Origin: origin, Cookie: cookie, "Idempotency-Key": "ops-submit-" + input.suffix },
    data: {
      branchId: input.branchId,
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      contactName: "Ops Guest",
      email: "ops-guest@example.com",
      phone: "+639171234567",
    },
  });
  expect(submitted.ok()).toBe(true);
  return orderId;
}

test("owner configures online ordering and gets a tenant-safe storefront link", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const suffix = "settings-" + testInfo.project.name + "-" + Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "Settings Owner",
    email: "order-settings-" + suffix + "@example.com",
    password: "correct-horse-12",
    businessName: "Settings Store " + suffix,
  });
  const auth = await apiAuthedContext(request, email, "correct-horse-12", page);
  const seeded = await createBranchAndProduct(request, auth.headers, suffix);
  const business = await request.get(API + "/api/v1/business", { headers: auth.headers });
  const businessId = ((await business.json()) as { id: string }).id;

  await page.goto("/admin/online-ordering");
  await expect(page.getByRole("heading", { name: "Online ordering" })).toBeVisible();
  await page.getByLabel("Enable online ordering").check();
  await page.getByRole("checkbox", { name: seeded.branchName }).check();
  await page.getByLabel("Delivery fulfillment branch").selectOption(seeded.branchId);
  await page.getByLabel("Flat delivery fee (PHP)").fill("49.50");
  await page.getByRole("button", { name: "Save online ordering" }).click();
  await expect(page.getByText(/storefront access is active/i)).toBeVisible();

  const link = page.getByLabel("Customer storefront link");
  await expect(link).toBeVisible();
  const value = await link.inputValue();
  expect(value).toContain("/order?storefront=");
  expect(value).not.toContain(businessId);
});

test("owner works a submitted pickup Order through acceptance and ready state", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const suffix = "ops-" + testInfo.project.name + "-" + Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "Ops Owner",
    email: "order-ops-" + suffix + "@example.com",
    password: "correct-horse-12",
    businessName: "Ops Store " + suffix,
  });
  const auth = await apiAuthedContext(request, email, "correct-horse-12", page);
  const seeded = await createBranchAndProduct(request, auth.headers, suffix);
  const online = await enableOrdering(request, auth.headers, seeded.branchId);
  const orderId = await submitPayAtPickup(request, {
    storefrontKey: online.storefrontKey,
    branchId: seeded.branchId,
    productId: seeded.productId,
    suffix,
  });

  await page.goto("/orders");
  const row = page.getByRole("row").filter({ hasText: "Ops Guest" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: orderId.slice(-8).toUpperCase() }).click();
  await expect(page.getByRole("heading", { name: "Order " + orderId.slice(-8).toUpperCase() })).toBeVisible();
  await expect(page.getByText("ops-guest@example.com")).toBeVisible();
  await expect(page.getByText("+639171234567")).toBeVisible();
  await page.getByRole("button", { name: "Accept order" }).click();
  await expect(page.getByText("Accept order completed.")).toBeVisible();
  await expect(page.getByText("CONFIRMED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Pickup fulfillment")).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Ready fulfillment completed.")).toBeVisible();
  await expect(page.getByText("READY", { exact: true }).first()).toBeVisible();
});
