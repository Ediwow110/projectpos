import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

test("Orders queue and empty/detail states remain usable at supported widths", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const suffix = testInfo.project.name + "-" + Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "Responsive Owner",
    email: "order-responsive-" + suffix + "@example.com",
    password: "correct-horse-12",
    businessName: "Responsive Store " + suffix,
  });
  await apiAuthedContext(request, email, "correct-horse-12", page);

  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();
  await expect(page.getByLabel("Order status")).toBeVisible();
  await expect(page.getByLabel("Fulfillment")).toBeVisible();
  await expect(page.getByText("No Orders match these filters")).toBeVisible();
  const bodyWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(bodyWidth.scrollWidth).toBeLessThanOrEqual(bodyWidth.clientWidth + 1);

  const missing = await request.get(API + "/api/v1/orders/not-a-real-order", {
    headers: (await apiAuthedContext(request, email, "correct-horse-12", page)).headers,
  });
  expect(missing.status()).toBe(404);
  await page.goto("/orders/not-a-real-order");
  await expect(page.getByText("Order could not be loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
