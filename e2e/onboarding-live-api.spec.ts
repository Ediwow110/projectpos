import { expect, test } from "@playwright/test";
import { DashboardPage } from "./pages/DashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";

test("signed-out direct onboarding returns to sign in", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("real browser, web app, and API preserve onboarding gates and progress", async ({ page, context }) => {
  const email = `onboarding-live-${Date.now()}@example.test`;
  const onboarding = new OnboardingPage(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Live QA Owner");
  await page.getByLabel("Business name").fill("Live QA Store");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (12+ characters)").fill("correct-horse-12");
  await page.getByRole("button", { name: "Create business" }).click();

  await onboarding.expectRequiredSetup();
  const profile = await page.evaluate(() => fetch("/api/v1/me").then((response) => response.json()));
  expect(profile.email).toBe(email);

  for (const path of ["/", "/inventory", "/products"]) {
    await page.goto(path);
    await onboarding.expectRequiredSetup();
    await page.reload();
    await onboarding.expectRequiredSetup();
  }
  const secondTab = await context.newPage();
  await secondTab.goto("/inventory");
  await new OnboardingPage(secondTab).expectRequiredSetup();
  await secondTab.close();

  const bypass = await page.evaluate(async () => {
    const csrfResponse = await fetch("/api/v1/auth/csrf");
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const response = await fetch("/api/v1/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ step: "taxCurrency", state: "skipped" }),
    });
    return { status: response.status, body: await response.json() as { code?: string } };
  });
  expect(bypass.status).toBe(400);
  expect(bypass.body.code).toBe("ONBOARDING_REQUIRED_STEP");

  await expect(page.getByRole("button", { name: "Save currency & tax" })).toBeVisible();
  await onboarding.saveTaxConfiguration();
  await expect(page.getByText("Receipt setup", { exact: true })).toBeVisible();
  await onboarding.confirmReceiptSetup();

  await expect(page.getByText("First products", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to dashboard" }).click();
  await new DashboardPage(page).expectEmptyState();

  await onboarding.goto();
  await expect(page.getByRole("heading", { name: "First products" })).toBeVisible();
  await onboarding.skipOptionalStep();
  await expect(page.getByText("Employees", { exact: true })).toBeVisible();
  await onboarding.skipOptionalStep();
  await new DashboardPage(page).expectEmptyState();

  const persisted = await page.evaluate(() => fetch("/api/v1/onboarding").then((response) => response.json()));
  expect(persisted.steps).toMatchObject({
    businessDetails: "done",
    taxCurrency: "done",
    receiptSetup: "done",
    products: "skipped",
    employees: "skipped",
  });
  expect(pageErrors).toEqual([]);
});

test("new owner can add a product and record opening stock through the real inventory flow", async ({ page }) => {
  const email = `inventory-onboarding-${Date.now()}@example.test`;
  const productName = `Opening Stock QA ${Date.now()}`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Inventory QA Owner");
  await page.getByLabel("Business name").fill("Inventory QA Store");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (12+ characters)").fill("correct-horse-12");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Currency & tax" })).toBeVisible();
  const onboarding = new OnboardingPage(page);
  await onboarding.saveTaxConfiguration();
  await expect(page.getByRole("heading", { name: "Receipt setup" })).toBeVisible();
  await onboarding.confirmReceiptSetup();
  await expect(page.getByRole("heading", { name: "First products" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark step complete" })).toBeEnabled();
  await page.getByRole("link", { name: "Open products →" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page.getByRole("button", { name: "Skip tour", exact: true }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("Selling price (PHP)").fill("25.00");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `${productName} was added` })).toBeVisible();

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await page.getByRole("link", { name: productName, exact: true }).click();
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  const productId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "+ Record movement" }).click();
  const movementType = page.getByLabel("Movement type");
  await movementType.selectOption("opening_stock");
  await page.getByLabel("Quantity").fill("17");
  await page.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Opening stock movement recorded." })).toBeVisible();
  const openingMovement = page.getByRole("row").filter({ hasText: "Opening stock" });
  await expect(openingMovement).toContainText("+17");

  await page.goto("/inventory");
  const productRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: productName, exact: true }) });
  await expect(productRow).toContainText("17");
  await expect(productRow).toContainText("OK");

  const quickMovementType = page.getByLabel("Movement type");
  const quickOptions = await quickMovementType.locator("option").allTextContents();
  expect(quickOptions).not.toContain("Sale");
  expect(quickOptions).not.toContain("Transfer in");
  expect(quickOptions).not.toContain("Transfer out");
  await page.getByLabel("Product ID or barcode").fill(productId);
  await quickMovementType.selectOption("damage");
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Reason").fill("Damaged during QA");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(productRow).toContainText("15");
});
