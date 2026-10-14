// Role-workflow smoke (PLAN.md 13.1). Owner coverage validates privileged
// surfaces; cashier coverage creates a real membership and signs in as that
// user so browser tests exercise role-specific UI instead of reusing owner.
import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, posCartRegion, registerOperationalBusiness } from "./helpers";

let ownerEmail = "";
test.beforeEach(async ({ page }) => {
  const stamp = Date.now();
  ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Role Owner",
    email: `roles-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: "Roles Store",
  });
});

test("owner surfaces: registers, cashiers report, export buttons", async ({ page }) => {
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "+ Add team member", exact: true }).click();
  await page.getByLabel("Name").fill("Counter Cashier");
  await page.getByLabel("Email").fill(`counter-${Date.now()}@example.com`);
  await page.getByLabel("Role").selectOption("cashier");
  await page.getByRole("button", { name: "Create team member", exact: true }).click();
  const credentials = page.getByRole("dialog", { name: "Temporary password" });
  await expect(credentials).toBeVisible();
  await expect(credentials).toContainText("Counter Cashier");

  await page.goto("/registers");
  await expect(page.getByRole("heading", { name: "Registers", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Create register", exact: true })).toBeVisible();

  await page.goto("/reports/cashiers");
  await expect(page.getByRole("heading", { name: "Cashiers report" })).toBeVisible();

  await page.goto("/sales");
  const exportButton = page.getByRole("button", { name: "Export CSV" });
  await expect(exportButton).toBeVisible();
  const exportResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/sales/export?format=csv"),
  );
  await exportButton.click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["content-type"]).toContain("text/csv");
});

test("cashier session can sell and read inventory without owner controls", async ({ page, request }, testInfo) => {
  const ownerAuth = await apiAuthedContext(request, ownerEmail, "correct-horse-12", page);
  const cashierEmail = `cashier-${testInfo.project.name}-${Date.now()}@example.com`;
  const created = await request.post(`${API}/api/v1/memberships`, {
    headers: ownerAuth.headers,
    data: { email: cashierEmail, name: "Role Cashier", role: "cashier" },
  });
  expect(created.ok()).toBe(true);
  const membership = (await created.json()) as { tempPassword?: string };
  expect(membership.tempPassword).toBeTruthy();

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(cashierEmail);
  await page.getByLabel("Password").fill(membership.tempPassword!);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveURL(/\/onboarding/);

  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog", { name: "Open your shift" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Open your shift" })).toHaveCount(0);

  await page.goto("/pos");
  await expect(page.getByRole("region", { name: "Products" })).toBeVisible();
  await expect(posCartRegion(page)).toBeVisible();

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();

  await page.goto("/registers");
  await expect(page.getByRole("button", { name: "+ Create register", exact: true })).toHaveCount(0);
  await expect(page.getByText("Only owners and managers can create or archive registers.")).toBeVisible();

  await page.goto("/sales");
  await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
});

test("logged-out users are gated", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
