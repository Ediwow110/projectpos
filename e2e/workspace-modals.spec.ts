import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

test("workspace create and consequential actions use consistent dialogs", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const email = `workspace-${testInfo.project.name}-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerBusiness(page, {
    ownerName: "Workspace Owner",
    email,
    password,
    businessName: `Workspace Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, { name: `Workflow Coffee ${stamp}`, priceMinor: 15000, stock: 20 });

  await page.goto("/categories");
  await page.getByRole("button", { name: "+ Add category", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add category" });
  await dialog.getByLabel("Category name").fill("Drinks");
  await dialog.getByLabel("Description (optional)").fill("Beverages for POS sale");
  await dialog.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(page.getByText("Drinks", { exact: true })).toBeVisible();

  await page.goto("/customers");
  await page.getByRole("button", { name: "+ Add customer", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add customer" });
  await dialog.getByLabel("Name").fill("Modal Customer");
  await dialog.getByLabel("Phone (optional)").fill("09171234567");
  await dialog.getByRole("button", { name: "Create customer", exact: true }).click();
  await expect(page.getByRole("link", { name: /Modal Customer/ })).toBeVisible();

  await page.goto("/branches");
  for (const [name, type] of [["North Store", "store"], ["Central Warehouse", "warehouse"]] as const) {
    await page.getByRole("button", { name: "+ Add branch", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Add branch" });
    await dialog.getByLabel("Branch name").fill(name);
    await dialog.getByLabel("Type").selectOption(type);
    await dialog.getByRole("button", { name: "Create branch", exact: true }).click();
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  const branchesResponse = await request.get(`${API}/api/v1/branches`, { headers });
  expect(branchesResponse.ok()).toBe(true);
  const branchRows = ((await branchesResponse.json()) as { items: Array<{ id: string; name: string }> }).items;
  const northBranchId = branchRows.find((branch) => branch.name === "North Store")?.id;
  expect(northBranchId).toBeTruthy();
  const branchStock = await request.post(`${API}/api/v1/inventory/movements`, {
    headers,
    data: { productId, type: "receive", qtyDelta: 10, branchId: northBranchId },
  });
  expect(branchStock.ok()).toBe(true);

  await page.goto("/expenses");
  await page.getByRole("button", { name: "+ Record expense", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Record expense" });
  await dialog.getByLabel("Category").fill("Transport");
  await dialog.getByLabel("Amount (PHP)").fill("50.00");
  await dialog.getByLabel("Method").selectOption("other");
  await dialog.getByLabel("Description (optional)").fill("Delivery fare");
  await dialog.getByRole("button", { name: "Record expense", exact: true }).click();
  await expect(page.getByText("Transport", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Void", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Void expense" });
  await dialog.getByLabel("Reason").fill("Duplicate receipt");
  await dialog.getByRole("button", { name: "Void expense", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Transport expense was voided.");

  await page.goto(`/inventory/${productId}`);
  await page.getByRole("button", { name: "+ Record movement", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Record inventory movement" });
  await dialog.getByLabel("Movement type").selectOption("receive");
  await dialog.getByLabel(/^Quantity/).fill("3");
  await dialog.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Receive movement recorded.")).toBeVisible();

  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create register" });
  await dialog.getByLabel("Register name").fill("Workflow Counter");
  await dialog.getByLabel("Branch").selectOption({ label: "North Store" });
  await dialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Workflow Counter", { exact: true })).toBeVisible();

  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Open shift" });
  await dialog.getByLabel("Register").selectOption({ label: "Workflow Counter" });
  await dialog.getByLabel("Opening float (PHP)").fill("100.00");
  await dialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();
  await page.getByRole("button", { name: "Cash movement", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Record cash movement" });
  await dialog.getByLabel("Movement type").selectOption("cash_deposit");
  await dialog.getByLabel("Amount (PHP)").fill("25.00");
  await dialog.getByLabel("Reason").fill("Float top up");
  await dialog.getByRole("button", { name: "Record movement", exact: true }).click();
  await expect(page.getByText("Cash movement recorded.")).toBeVisible();

  await page.goto("/transfers");
  await page.getByRole("button", { name: "+ New transfer", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create stock transfer" });
  await dialog.getByLabel("From branch").selectOption({ label: "North Store" });
  await dialog.getByLabel("To branch").selectOption({ label: "Central Warehouse" });
  await dialog.getByLabel("Product").selectOption({ label: `Workflow Coffee ${stamp}` });
  await dialog.getByLabel("Qty").fill("2");
  await dialog.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("Transfer draft created.")).toBeVisible();

  const transfers = await request.get(`${API}/api/v1/transfers`, { headers });
  expect(transfers.ok()).toBe(true);
  const created = ((await transfers.json()) as { items: Array<{ id: string; status: string }> }).items.find((item) => item.status === "DRAFT");
  expect(created).toBeTruthy();
  await page.goto(`/transfers/${created!.id}`);
  await page.getByRole("button", { name: "Dispatch", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Dispatch transfer?" });
  await dialog.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
  await expect(page.getByText("Transfer dispatch completed.")).toBeVisible();
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Receive transfer?" });
  await dialog.getByRole("button", { name: "Receive transfer", exact: true }).click();
  await expect(page.getByText("Transfer receive completed.")).toBeVisible();
});
