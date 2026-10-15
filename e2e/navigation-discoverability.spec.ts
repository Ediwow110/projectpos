import { expect, test, type Page } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness, signOut } from "./helpers";

async function openWorkspaceDestination(page: Page, label: string, href: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1280) {
    const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
    await expect(sidebar).toBeVisible();
    const direct = sidebar.getByRole("link", { name: label, exact: true });
    if (await direct.isVisible()) {
      await direct.click();
    } else {
      const details = sidebar.locator('[data-ui="atlas-workspace-destinations"]');
      const disclosure = details.getByText("All workspace destinations", { exact: true });
      await expect(disclosure).toBeVisible();
      if ((await details.getAttribute("open")) === null) await disclosure.click();
      await sidebar.getByRole("navigation", { name: "All workspace destinations" }).getByRole("link", { name: label, exact: true }).click();
    }
  } else {
    const atlasButton = page.locator('[data-ui="atlas-mobile-header"]');
    const legacyMore = page.getByRole("button", { name: /More workspace navigation/ });
    // The AppShell variant can change across routes after URL navigation.
    // Wait for a visible control rather than sampling the old shell too soon.
    await expect.poll(async () =>
      await atlasButton.isVisible() || await legacyMore.isVisible(),
    ).toBe(true);
    const moreButton = await atlasButton.isVisible()
      ? atlasButton.getByRole("button", { name: "Open workspace menu" })
      : legacyMore;
    await expect(moreButton).toBeVisible();
    if ((await moreButton.getAttribute("aria-expanded")) !== "true") await moreButton.click();
    const menu = page.locator("#workspace-more-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: label, exact: true }).click();
  }
  await expect(page).toHaveURL(
    new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
    { timeout: 15_000 },
  );
}

test("owner can discover operational and administration routes and restart Help", async ({ page }) => {
  await registerOperationalBusiness(page, {
    ownerName: "Navigation Owner",
    email: "navigation-owner@example.com",
    password: "correct-horse-12",
    businessName: "Navigation Store",
  });

  const destinations = [
    ["Categories", "/categories"],
    ["Registers", "/registers"],
    ["Transfers", "/transfers"],
    ["Expenses", "/expenses"],
    ["Suppliers", "/suppliers"],
    ["Purchase Orders", "/purchase-orders"],
    ["Team", "/team"],
    ["Devices", "/devices"],
    ["Administration / Help", "/admin"],
  ] as const;

  for (const [label, href] of destinations) {
    await openWorkspaceDestination(page, label, href);
  }

  await page.locator("main").getByRole("button", { name: "Restart system tour" }).click();
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();
});

test("cashier navigation hides owner management destinations", async ({ page, request }) => {
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Role Owner",
    email: "navigation-role-owner@example.com",
    password,
    businessName: "Role Navigation Store",
  });
  const auth = await apiAuthedContext(request, ownerEmail, password, page);
  const cashierEmail = `cashier-${process.env.TEST_WORKER_INDEX ?? "w"}-${Date.now()}@example.com`;
  const created = await request.post(`${API}/api/v1/memberships`, {
    headers: auth.headers,
    data: { name: "Navigation Cashier", email: cashierEmail, role: "cashier" },
  });
  expect(created.ok()).toBe(true);
  const tempPassword = ((await created.json()) as { tempPassword?: string }).tempPassword;
  expect(tempPassword).toBeTruthy();

  await signOut(page);
  await page.getByLabel("Email").fill(cashierEmail);
  await page.getByLabel("Password").fill(tempPassword!);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const firstRunTour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(firstRunTour).toBeVisible({ timeout: 30_000 });
  await firstRunTour.getByRole("button", { name: "Skip tour" }).click();
  await expect(firstRunTour).toBeHidden();

  await expect(page.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Suppliers", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Purchase Orders", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Administration / Help", exact: true })).toHaveCount(0);
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1280) {
    const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
    await expect(sidebar.getByRole("link", { name: "Devices", exact: true })).toBeVisible();
  } else {
    const atlasButton = page.locator('[data-ui="atlas-mobile-header"]');
    const legacyMore = page.getByRole("button", { name: /More workspace navigation/ });
    await expect.poll(async () =>
      await atlasButton.isVisible() || await legacyMore.isVisible(),
    ).toBe(true);
    const moreButton = await atlasButton.isVisible()
      ? atlasButton.getByRole("button", { name: "Open workspace menu" })
      : legacyMore;
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect(page.locator("#workspace-more-menu").getByRole("link", { name: "Devices", exact: true })).toBeVisible();
  }
});
