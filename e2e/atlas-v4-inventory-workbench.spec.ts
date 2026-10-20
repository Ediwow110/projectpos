import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, seedProduct, signIn } from "./helpers";

test("inventory staff get the Atlas V4 workbench, real stock, and role-scoped navigation", async ({ page, request }, testInfo) => {
  test.setTimeout(150_000);
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Inventory Workbench QA",
    email: `inventory-workbench-owner-${testInfo.project.name}-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Inventory Workbench QA",
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Low QA Milk", priceMinor: 2500, stock: 1 });
  const staffEmail = `inventory-workbench-staff-${testInfo.project.name}-${Date.now()}@example.com`;
  const staff = await createStaffMember(request, headers, { name: "Warehouse QA", email: staffEmail, role: "inventory" });
  await signIn(page, staffEmail, staff.tempPassword);
  await page.goto("/inventory");
  await expect(page.locator('[data-ui="atlas-inventory-shell"]')).toBeVisible();
  const workbench = page.getByRole("region", { name: "Inventory workbench" });
  await expect(workbench.getByRole("heading", { name: "Inventory workbench" })).toBeVisible();
  // QA product starts with the API's default reorder level of 0, so a single
  // unit is healthy. Never assert a fabricated low-stock alert from its name.
  await expect(workbench.getByText("No low or out-of-stock products on this page.")).toBeVisible();
  await expect(page.getByRole("table").getByRole("link", { name: "Low QA Milk" })).toBeVisible();
  await expect(workbench.getByText("Products on this page", { exact: true })).toBeVisible();
  await expect(workbench.getByRole("link", { name: "Start a count" })).toHaveAttribute("href", "/inventory/counts");
  await expect(workbench.getByRole("link", { name: "Review reorder suggestions" })).toHaveAttribute("href", "/inventory/replenishment");
  await expect(page.locator("#inventory-balances")).toBeAttached();

  if (testInfo.project.name === "desktop") {
    const aside = page.locator('[data-ui="shell-sidebar"]');
    expect((await aside.boundingBox())?.width).toBeCloseTo(226, 0);
    const nav = page.getByRole("navigation", { name: "Inventory controls" });
    await expect(nav.getByRole("link", { name: "My work" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Counts", exact: true })).toHaveAttribute("href", "/inventory/counts");
    await nav.getByRole("link", { name: "Stock levels" }).click();
    await expect(page).toHaveURL(/\/inventory#inventory-balances$/);
  } else {
    await expect(page.locator('[data-ui="atlas-mobile-header"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Open workspace menu" })).toBeVisible();
  }
  const dimensions = await page.evaluate(() => ({
    full: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.full).toBeLessThanOrEqual(dimensions.viewport + 2);
});
