import { expect, test } from "@playwright/test";

const liveWeb = "http://localhost:3102";

test("real browser, web app, and API preserve onboarding gates and progress", async ({ page }) => {
  const email = `onboarding-live-${Date.now()}@example.test`;
  await page.goto(`${liveWeb}/register`);
  await page.getByLabel("Your name").fill("Live QA Owner");
  await page.getByLabel("Business name").fill("Live QA Store");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (12+ characters)").fill("correct-horse-12");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await expect(page.getByText("Complete required setup to open the dashboard.")).toBeVisible();

  await page.goto(`${liveWeb}/`);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();

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

  await expect(page.getByRole("button", { name: "Mark step complete" })).toBeVisible();
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await expect(page.getByText("Receipt setup", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark step complete" }).click();

  await expect(page.getByText("First products", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Back to dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to dashboard" }).click();
  await expect(page).toHaveURL(`${liveWeb}/`);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  await page.goto(`${liveWeb}/onboarding`);
  await expect(page.getByRole("heading", { name: "First products" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Employees", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(`${liveWeb}/`);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  const persisted = await page.evaluate(() => fetch("/api/v1/onboarding").then((response) => response.json()));
  expect(persisted.steps).toMatchObject({
    businessDetails: "done",
    taxCurrency: "done",
    receiptSetup: "done",
    products: "skipped",
    employees: "skipped",
  });
});

test("new owner can add a product and record opening stock through the real inventory flow", async ({ page }) => {
  const email = `inventory-onboarding-${Date.now()}@example.test`;
  const productName = `Opening Stock QA ${Date.now()}`;
  await page.goto(`${liveWeb}/register`);
  await page.getByLabel("Your name").fill("Inventory QA Owner");
  await page.getByLabel("Business name").fill("Inventory QA Store");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (12+ characters)").fill("correct-horse-12");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Currency & tax" })).toBeVisible();
  for (const nextStep of ["Receipt setup", "First products"]) {
    await page.getByRole("button", { name: "Mark step complete" }).click();
    await expect(page.getByRole("heading", { name: nextStep })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Mark step complete" })).toBeEnabled();
  await page.getByRole("link", { name: "Open products →" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page.getByRole("button", { name: "Skip tour", exact: true }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("Selling price (PHP)").fill("25.00");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `${productName} was added` })).toBeVisible();

  await page.goto(`${liveWeb}/inventory`);
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

  await page.goto(`${liveWeb}/inventory`);
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
