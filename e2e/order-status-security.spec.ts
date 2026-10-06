import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

type GuestOrderSeed = {
  storefrontKey: string;
  branchId: string;
  productId: string;
  statusToken: string;
  checkoutCookie: string;
  orderId: string;
};

function cookieFrom(headers: Array<{ name: string; value: string }>): string {
  return headers
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0])
    .join("; ");
}

async function setupGuestOrder(
  page: Page,
  request: APIRequestContext,
  suffix: string,
): Promise<GuestOrderSeed> {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Status Owner",
    email: "status-owner-" + suffix + "@example.com",
    password,
    businessName: "Status Store " + suffix,
  });
  const auth = await apiAuthedContext(request, email, password, page);
  const branchResponse = await request.post(API + "/api/v1/branches", {
    headers: auth.headers,
    data: { name: "Status Branch " + suffix },
  });
  expect(branchResponse.ok()).toBe(true);
  const branch = (await branchResponse.json()) as { id: string };
  const productResponse = await request.post(API + "/api/v1/products", {
    headers: auth.headers,
    data: { name: "Status Product " + suffix, priceMinor: 9000, costMinor: 4000 },
  });
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()) as { id: string };
  expect((await request.post(API + "/api/v1/inventory/movements", {
    headers: auth.headers,
    data: { productId: product.id, branchId: branch.id, type: "opening_stock", qtyDelta: 5 },
  })).ok()).toBe(true);
  expect((await request.patch(API + "/api/v1/business/settings", {
    headers: auth.headers,
    data: {
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: [branch.id],
      onlineFulfillmentBranchId: branch.id,
      deliveryFlatFeeMinor: 0,
    },
  })).ok()).toBe(true);
  const business = await request.get(API + "/api/v1/business", { headers: auth.headers });
  const storefrontKey = ((await business.json()) as { storefrontKey: string }).storefrontKey;

  const origin = "http://localhost:3100";
  const created = await request.post(API + "/api/v1/public/orders", {
    headers: { Origin: origin, "Idempotency-Key": "security-create-" + suffix },
    data: { storefrontKey },
  });
  expect(created.ok()).toBe(true);
  const checkoutCookie = cookieFrom(created.headersArray());
  const orderId = ((await created.json()) as { id: string }).id;
  expect((await request.patch(API + "/api/v1/public/orders/" + orderId + "/draft", {
    headers: { Origin: origin, Cookie: checkoutCookie },
    data: { branchId: branch.id, fulfillmentMode: "PICKUP", lines: [{ productId: product.id, qty: 1 }] },
  })).ok()).toBe(true);
  const submitted = await request.post(API + "/api/v1/public/orders/" + orderId + "/submit", {
    headers: {
      Origin: origin,
      Cookie: checkoutCookie,
      "Idempotency-Key": "security-submit-" + suffix,
    },
    data: {
      branchId: branch.id,
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      contactName: "Status Guest",
      email: "status-guest@example.com",
      phone: "+639171234567",
    },
  });
  expect(submitted.ok()).toBe(true);
  const statusToken = ((await submitted.json()) as { statusToken: string }).statusToken;
  await page.context().clearCookies();
  return { storefrontKey, branchId: branch.id, productId: product.id, statusToken, checkoutCookie, orderId };
}

test("status token is scrubbed before the API response and never reaches browser storage or console", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const seeded = await setupGuestOrder(page, request, testInfo.project.name + "-" + Date.now());
  const consoleText: string[] = [];
  page.on("console", (message) => consoleText.push(message.text()));
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });
  let requestStarted = false;
  await page.route("**/api/v1/public/orders/status", async (route) => {
    requestStarted = true;
    await statusGate;
    await route.continue();
  });

  await page.goto("/order-status#token=" + seeded.statusToken);
  await expect.poll(() => requestStarted).toBe(true);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).toBe("http://localhost:3100/order-status");
  const storedWhilePending = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(storedWhilePending.local).not.toContain(seeded.statusToken);
  expect(storedWhilePending.session).not.toContain(seeded.statusToken);
  expect(consoleText.join("\n")).not.toContain(seeded.statusToken);

  releaseStatus();
  await expect(page.getByRole("heading", { name: "Awaiting staff confirmation" })).toBeVisible();
  expect(consoleText.join("\n")).not.toContain(seeded.statusToken);
});

test("a checkout cookie for one guest order cannot mutate another guest order", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const first = await setupGuestOrder(page, request, "first-" + testInfo.project.name + "-" + Date.now());
  const second = await setupGuestOrder(page, request, "second-" + testInfo.project.name + "-" + Date.now());
  const attempted = await request.patch(API + "/api/v1/public/orders/" + second.orderId + "/draft", {
    headers: { Origin: "http://localhost:3100", Cookie: first.checkoutCookie },
    data: { branchId: second.branchId, fulfillmentMode: "PICKUP", lines: [{ productId: second.productId, qty: 1 }] },
  });
  expect(attempted.status()).toBe(404);
});

test("provider return never claims payment success without a secure status token", async ({ page }) => {
  await page.goto("/order-status?payment=success");
  await expect(page.getByRole("heading", { name: "Payment return received" })).toBeVisible();
  await expect(page.getByText(/does not confirm that payment succeeded/i)).toBeVisible();
  await expect(page.getByText("PAID", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Payment confirmed.", { exact: true })).toHaveCount(0);
});
