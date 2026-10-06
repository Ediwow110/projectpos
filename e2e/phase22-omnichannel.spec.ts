import { expect, test } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  registerOperationalBusiness,
} from "./helpers";

test("phase22 omnichannel smoke: guest pickup -> accept -> ready -> POS tender -> collect", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const suffix = testInfo.project.name + "-" + Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Omnichannel Owner",
    email: "phase22-omni-" + suffix + "@example.com",
    password,
    businessName: "Omnichannel Store " + suffix,
  });
  const auth = await apiAuthedContext(request, email, password, page);

  const branchResponse = await request.post(API + "/api/v1/branches", {
    headers: auth.headers,
    data: { name: "Pickup Hub " + suffix },
  });
  expect(branchResponse.ok()).toBe(true);
  const branch = (await branchResponse.json()) as { id: string };
  const productResponse = await request.post(API + "/api/v1/products", {
    headers: auth.headers,
    data: { name: "Omni Coffee " + suffix, priceMinor: 12500, costMinor: 6000 },
  });
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()) as { id: string };
  expect((await request.post(API + "/api/v1/inventory/movements", {
    headers: auth.headers,
    data: { productId: product.id, branchId: branch.id, type: "opening_stock", qtyDelta: 10 },
  })).ok()).toBe(true);
  expect((await request.patch(API + "/api/v1/business/settings", {
    headers: auth.headers,
    data: {
      onlineOrderingEnabled: true,
      onlinePickupBranchIds: [branch.id],
      onlineFulfillmentBranchId: branch.id,
      deliveryFlatFeeMinor: 5000,
    },
  })).ok()).toBe(true);
  const business = await request.get(API + "/api/v1/business", { headers: auth.headers });
  const storefrontKey = ((await business.json()) as { storefrontKey: string }).storefrontKey;

  const registerResponse = await request.post(API + "/api/v1/registers", {
    headers: auth.headers,
    data: { name: "Pickup Register " + suffix, branchId: branch.id },
  });
  expect(registerResponse.ok()).toBe(true);
  const register = (await registerResponse.json()) as { id: string };
  expect((await request.post(API + "/api/v1/registers/" + register.id + "/open", {
    headers: auth.headers,
    data: { registerId: register.id, openingFloatMinor: 0 },
  })).ok()).toBe(true);

  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
  await page.goto("/order?storefront=" + storefrontKey);
  await page.getByLabel("Store location").selectOption(branch.id);
  await expect(page.getByText("Omni Coffee " + suffix)).toBeVisible();
  await page.getByRole("button", { name: "Add to order" }).click();
  await page.getByLabel("Name").fill("Omni Guest");
  await page.getByLabel("Email").fill("omni-guest@example.com");
  await page.getByLabel("Contact number").fill("+639171234567");
  await page.getByRole("button", { name: "Submit pickup order" }).click();
  await expect(page.getByRole("heading", { name: "Awaiting staff confirmation" })).toBeVisible({ timeout: 30_000 });
  const guestStatusUrl = page.url();
  expect(new URL(guestStatusUrl).hash).toBe("");
  expect(consoleMessages.join("\n")).not.toContain("token=");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  if (await tour.isVisible().catch(() => false)) {
    await tour.getByRole("button", { name: "Skip tour" }).click();
  }

  await page.goto("/orders");
  const orderRow = page.getByRole("row").filter({ hasText: "Omni Guest" });
  await expect(orderRow).toBeVisible();
  await orderRow.getByRole("link").click();
  await expect(page.getByText("omni-guest@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Accept order" }).click();
  await expect(page.getByText("Accept order completed.")).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Ready fulfillment completed.")).toBeVisible();
  await page.getByLabel("Register").selectOption(register.id);
  await page.getByRole("button", { name: "Collect order" }).click();
  await expect(page.getByText("Collect order completed.")).toBeVisible();
  await expect(page.getByText("COMPLETED", { exact: true }).first()).toBeVisible();
  expect(consoleMessages).toEqual([]);
});

test("phase22 prepaid browser handoff remains honest when the local provider is disabled", async ({ page }) => {
  await page.goto("/order-status?payment=success");
  await expect(page.getByRole("heading", { name: "Payment return received" })).toBeVisible();
  await expect(page.getByText(/does not confirm that payment succeeded/i)).toBeVisible();
  await expect(page.getByText("Payment confirmed.", { exact: true })).toHaveCount(0);
});
