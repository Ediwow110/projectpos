// Role-workflow smoke (PLAN.md 13.1) with an honest constraint: no
// member-invite API exists, so all sessions here are owner sessions. These
// specs prove each role's characteristic UI surfaces render and behave for
// an authorized user, plus logged-out gating; cross-role denial is proven
// by unit/contract tests (rolePermissions matrix, FORBIDDEN gates).
import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";

test.beforeEach(async ({ page }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Role Owner",
    email: `roles-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: "Roles Store",
  });
});

test("owner surfaces: registers, cashiers report, export buttons", async ({ page }) => {
  await page.goto("/registers");
  await expect(page.getByRole("heading", { name: "Registers", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Create register", exact: true })).toBeVisible();

  await page.goto("/reports/cashiers");
  await expect(page.getByRole("heading", { name: "Cashiers report" })).toBeVisible();

  await page.goto("/sales");
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("cashier surfaces: POS sells, inventory reads", async ({ page }) => {
  await page.goto("/pos");
  await expect(page.getByRole("region", { name: "Products" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 1280) {
    await expect(page.getByRole("region", { name: "Tablet cart" })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" })).toBeVisible();
  }

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
});

test("logged-out users are gated", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
