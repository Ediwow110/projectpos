import { expect, test } from "@playwright/test";

test("Atlas V4 Phase D guest and platform surfaces remain responsive and permission-aware", async ({ page }, testInfo) => {
  const screens = [
    { route: "/order-help", heading: "Need help with an order?", shell: "atlas-guest-help" },
    { route: "/platform/tenant-health", heading: "Platform tenant health", shell: "atlas-platform-shell" },
    { route: "/platform/support-access", heading: "Time-limited support access", shell: "atlas-platform-shell" },
  ] as const;
  for (const screen of screens) {
    await page.goto(screen.route);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1, exact: true })).toBeVisible();
    await expect(page.locator(`[data-ui="${screen.shell}"]`)).toBeVisible();
    const width = page.viewportSize()?.width ?? 1440;
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${screen.route} overflow`).toBeLessThanOrEqual(width + 2);
    await page.screenshot({ path: `test-results/atlas-v4-phase-d-${screen.route.slice(1).replaceAll("/", "-")}-${testInfo.project.name}.png`, fullPage: false });
  }
  await page.goto("/order-help");
  await expect(page.getByRole("link", { name: "NexPOS storefront" })).toBeVisible();
  const choices = page.getByRole("region", { name: "Order support paths" });
  for (const text of ["Find an existing order", "Report a problem", "Payment concerns", "Store contact"]) {
    await expect(choices.getByRole("link", { name: new RegExp(text) })).toHaveAttribute("href", "/order-status");
  }
  await page.goto("/platform/tenant-health");
  await expect(page.getByLabel("Operator key")).toHaveAttribute("type", "password");
  await expect(page.getByLabel("Owner consent token")).toHaveAttribute("type", "password");
  await expect(page.getByRole("region", { name: "Tenant diagnostics" })).toHaveCount(0);
  await page.goto("/platform/support-access");
  await expect(page.getByText("An operator cannot issue owner consent.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Owner consent controls" })).toHaveAttribute("href", "/admin/support");
});

test("Atlas V4 verified guest support submits and returns keyboard focus to order status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/public/orders/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: "qa-status-order-0001",
      status: "SUBMITTED",
      paymentStatus: "UNPAID",
      fulfillmentMode: "PICKUP",
      paymentMode: "PAY_AT_PICKUP",
      currency: "PHP",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      confirmedAt: null,
      completedAt: null,
      subtotalMinor: 10000,
      discountMinor: 0,
      taxMinor: 0,
      deliveryFeeMinor: 0,
      deliveryTaxMinor: 0,
      totalMinor: 10000,
      lines: [],
      fulfillments: [],
    }),
  }));
  await page.route("**/api/v1/public/support/cases", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ caseId: "qa-case-001", status: "OPEN" }),
  }));
  await page.route("**/api/v1/public/support/history", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.goto("/order-status#token=qa-synthetic-status-token");
  const summary = page.getByRole("heading", { name: "Awaiting staff confirmation" });
  await expect(summary).toBeVisible();
  await expect(page).toHaveURL(/\/order-status$/);
  await page.getByLabel("Describe the issue").fill("The carton arrived damaged during pickup.");
  await page.getByRole("button", { name: "Submit support request" }).click();
  await expect(page.getByRole("heading", { name: "Support request received" })).toBeVisible();
  await page.getByRole("button", { name: "Back to order status" }).click();
  await expect(summary).toBeFocused();
});
