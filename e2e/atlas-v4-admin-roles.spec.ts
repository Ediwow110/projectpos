import { expect, test } from "@playwright/test";
import { apiAuthedContext, createStaffMember, registerOperationalBusiness, signIn } from "./helpers";

const WIDTHS = [390, 820, 1024, 1280, 1440] as const;

test("Atlas V4 administration provides owner and manager-specific controls at five widths", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Atlas P4 Owner",
    email: `atlas-p4-owner-${stamp}@example.com`,
    password,
    businessName: "Atlas P4 QA",
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const managerEmail = `atlas-p4-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, headers, {
    email: managerEmail, name: "Atlas P4 Manager", role: "manager",
  });
  const cashierEmail = `atlas-p4-cashier-${stamp}@example.com`;
  const inventoryEmail = `atlas-p4-inventory-${stamp}@example.com`;
  const cashier = await createStaffMember(request, headers, {
    email: cashierEmail, name: "Atlas P4 Cashier", role: "cashier",
  });
  const inventory = await createStaffMember(request, headers, {
    email: inventoryEmail, name: "Atlas P4 Inventory", role: "inventory",
  });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Owner administration", level: 1 })).toBeVisible();
    await expect(page.locator('[data-ui="atlas-owner-shell"]')).toBeVisible();
    await expect(page.locator('section[aria-label="Administration destinations"]')).toContainText("Team & permissions");
    await expect(page.locator('section[aria-label="Administration destinations"]')).toContainText("Owner controls");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `Owner administration overflow at ${width}px`).toBeLessThanOrEqual(2);
  }

  await signIn(page, managerEmail, manager.tempPassword);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Manager operations", level: 1 })).toBeVisible();
    await expect(page.locator('[data-ui="atlas-manager-shell"]')).toBeVisible();
    const destinations = page.locator('section[aria-label="Administration destinations"]');
    await expect(destinations.getByRole("link", { name: /Approval inbox/ })).toBeVisible();
    await expect(destinations.getByRole("link", { name: /Stock operations/ })).toBeVisible();
    await expect(destinations.locator('a[href="/admin/owner-controls"]')).toHaveCount(0);
    await expect(destinations.locator('a[href="/team"]')).toHaveCount(0);
    await expect(destinations.locator('a[href="/admin/support"]')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `Manager administration overflow at ${width}px`).toBeLessThanOrEqual(2);
    if (width >= 1280) {
      await expect(page.getByRole("navigation", { name: "Manager navigation" })).toBeVisible();
    } else {
      const menu = page.getByRole("button", { name: "Open workspace menu" });
      await expect(menu).toBeVisible();
      await menu.click();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
    }
  }

  for (const staff of [
    { email: cashierEmail, password: cashier.tempPassword },
    { email: inventoryEmail, password: inventory.tempPassword },
  ]) {
    await signIn(page, staff.email, staff.password);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administration & Help", level: 1 })).toBeVisible();
    await expect(page.getByText("Administration access is not available for this role")).toBeVisible();
    await expect(page.getByRole("region", { name: "Administration destinations" })).toHaveCount(0);
    await expect(page.locator('[data-ui="atlas-owner-shell"], [data-ui="atlas-manager-shell"]')).toHaveCount(0);
  }
});
