import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

test("active branch persists and scopes POS registers plus inventory", async ({ page, request }) => {
  const email = await registerOperationalBusiness(page, {
    ownerName: "Branch Scope Owner",
    email: "branch-scope-" + Date.now() + "@example.com",
    password: "correct-horse-12",
    businessName: "Branch Scope Store",
  });
  const auth = await apiAuthedContext(request, email, "correct-horse-12", page);

  const northResponse = await request.post(API + "/api/v1/branches", {
    headers: auth.headers,
    data: { name: "North Store" },
  });
  expect(northResponse.ok()).toBe(true);
  const north = (await northResponse.json()) as { id: string };

  const southResponse = await request.post(API + "/api/v1/branches", {
    headers: auth.headers,
    data: { name: "South Store" },
  });
  expect(southResponse.ok()).toBe(true);
  const south = (await southResponse.json()) as { id: string };

  for (const [name, branchId] of [["North Till", north.id], ["South Till", south.id]] as const) {
    const register = await request.post(API + "/api/v1/registers", {
      headers: auth.headers,
      data: { name, branchId },
    });
    expect(register.ok()).toBe(true);
  }

  const productResponse = await request.post(API + "/api/v1/products", {
    headers: auth.headers,
    data: { name: "Scoped Coffee", priceMinor: 15000, costMinor: 7000 },
  });
  expect(productResponse.ok()).toBe(true);
  const product = (await productResponse.json()) as { id: string };
  for (const [branchId, qtyDelta] of [[north.id, 3], [south.id, 7]] as const) {
    const stock = await request.post(API + "/api/v1/inventory/movements", {
      headers: auth.headers,
      data: { productId: product.id, branchId, type: "opening_stock", qtyDelta },
    });
    expect(stock.ok()).toBe(true);
  }

  await page.reload();
  const branchSelect = page.locator('select[aria-label="Active branch"]:visible');
  await expect(branchSelect).toHaveValue("");
  await branchSelect.selectOption(north.id);
  await expect(branchSelect).toHaveValue(north.id);
  await page.reload();
  await expect(page.locator('select[aria-label="Active branch"]:visible')).toHaveValue(north.id);

  await page.goto("/pos");
  const posBranchSelect = page.locator('select[aria-label="Active branch"]:visible');
  await expect(posBranchSelect).toHaveCount(1);
  const registers = page.locator(
    'select[aria-label="Register"]:visible, select[aria-label="Mobile register"]:visible',
  );
  await expect(registers).toHaveCount(1);
  await expect(registers).toContainText("North Till");
  await expect(registers).not.toContainText("South Till");
  await registers.selectOption({ label: "North Till" });

  await posBranchSelect.selectOption(south.id);
  await expect(registers).toHaveValue("");
  await expect(registers).toContainText("South Till");
  await expect(registers).not.toContainText("North Till");

  await posBranchSelect.selectOption(north.id);

  await page.goto("/inventory");
  const row = page.getByRole("row").filter({ hasText: "Scoped Coffee" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).toHaveText("3");

  const inventoryBranchSelect = page.locator('select[aria-label="Active branch"]:visible');
  await inventoryBranchSelect.selectOption("");
  const allBranchRows = page.getByRole("row").filter({ hasText: "Scoped Coffee" });
  await expect(allBranchRows).toHaveCount(2);
  await expect(allBranchRows.nth(0).getByRole("cell").nth(1)).toHaveText("3");
  await expect(allBranchRows.nth(1).getByRole("cell").nth(1)).toHaveText("7");
  await expect(page.getByText("Main branch", { exact: true })).toHaveCount(0);

  await inventoryBranchSelect.selectOption(south.id);
  const archived = await request.patch(API + `/api/v1/branches/${south.id}`, {
    headers: auth.headers,
    data: { isActive: false },
  });
  expect(archived.ok()).toBe(true);

  await page.reload();
  await expect(page.locator('select[aria-label="Active branch"]:visible')).toHaveValue("");
});
