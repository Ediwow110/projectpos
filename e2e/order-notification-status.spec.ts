import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("authorized order staff see truthful delivery status and resend outcomes", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await registerOperationalBusiness(page, {
    ownerName: "Order Delivery QA",
    email: `order-delivery-owner-${testInfo.project.name}-${Date.now()}@example.test`,
    password: "correct-horse-12",
    businessName: "Order Delivery QA",
  });
  const id = "qa-notification-order";
  let outcome: "FAILED" | "NOT_SENT" | "ACCEPTED" = "FAILED";
  let tries = 0;
  await page.route(`**/api/v1/orders/${id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const createdAt = "2026-10-18T00:00:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        order: {
          id, channel: "WEB", fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP",
          branchId: null, customerId: null, contactName: "QA Customer",
          email: "qa@example.test", phone: null, deliveryAddress: null,
          fulfillmentInstructions: null, currency: "PHP", subtotalMinor: 100,
          discountMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, deliveryTaxMinor: 0,
          totalMinor: 100, saleId: null, status: "CONFIRMED", version: 2,
          submittedAt: createdAt, confirmedAt: createdAt, completedAt: null, createdAt,
        },
        lines: [], reservations: [], fulfillments: [], paymentStatus: "UNPAID",
        notificationStatus: {
          state: outcome, event: "CONFIRMED", lastAttemptAt: createdAt,
        },
      }),
    });
  });
  await page.route(`**/api/v1/orders/${id}/access/resend`, async (route) => {
    tries += 1;
    const sent = tries > 1;
    outcome = sent ? "ACCEPTED" : "NOT_SENT";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sent, replayed: false }),
    });
  });
  await page.goto(`/orders/${id}`);
  const delivery = page.getByRole("region", { name: "Status-link delivery history" });
  await expect(delivery.getByText("Last recorded notification attempt failed.")).toBeVisible();
  await page.getByRole("button", { name: "Resend status link" }).click();
  await expect(page.getByRole("alert").getByText("Status link was not sent.", { exact: false })).toBeVisible();
  await expect(delivery.getByText("Last resend did not send a status link.")).toBeVisible();
  await page.getByRole("button", { name: "Resend status link" }).click();
  await expect(page.getByRole("status").getByText("Status link accepted by the email provider.", { exact: false })).toBeVisible();
  await expect(delivery.getByText("Accepted by the email provider; inbox delivery is not confirmed.")).toBeVisible();
  expect(tries).toBe(2);
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 2);
});
