import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, createStaffMember, registerOperationalBusiness, seedProduct, signIn } from "./helpers";

test("owner branch assignment limits staff UI and blocks cross-branch API reads", async ({ page, request }) => {
  test.setTimeout(150_000);
  const password = "correct-horse-12";
  const stamp = Date.now();
  const owner = await registerOperationalBusiness(page, {
    ownerName: "Branch Owner", email: "scope-owner-" + stamp + "@example.com",
    password, businessName: "Branch Safety Test",
  });
  const auth = await apiAuthedContext(request, owner, password, page);
  const north = await request.post(API + "/api/v1/branches", {
    headers: auth.headers, data: { name: "North branch" },
  });
  const south = await request.post(API + "/api/v1/branches", {
    headers: auth.headers, data: { name: "South branch" },
  });
  expect(north.status()).toBe(201);
  expect(south.status()).toBe(201);
  const northId = ((await north.json()) as { id: string }).id;
  const southId = ((await south.json()) as { id: string }).id;
  const registerIds: Record<string, string> = {};
  for (const item of [
    { name: "North till", branchId: northId },
    { name: "Extra North till", branchId: northId },
    { name: "South till", branchId: southId },
  ]) {
    const register = await request.post(API + "/api/v1/registers", { headers: auth.headers, data: item });
    expect(register.status()).toBe(201);
    registerIds[item.name] = ((await register.json()) as { id: string }).id;
  }
  const productId = await seedProduct(request, auth.headers, {
    name: `Branch scope item ${stamp}`, priceMinor: 500, stock: 10,
  });
  const createDraft = async (branchId: string, registerId: string) => {
    const response = await request.post(API + "/api/v1/sales/drafts", {
      headers: auth.headers,
      data: { branchId, registerId, lines: [{ productId, qty: 1 }], orderDiscountMinor: 0 },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { receiptNo: string };
  };
  const northReceipt = await createDraft(northId, registerIds["North till"]!);
  const otherNorthRegisterReceipt = await createDraft(northId, registerIds["Extra North till"]!);
  const southReceipt = await createDraft(southId, registerIds["South till"]!);
  const otherRegisterReceiptResponse = await request.get(
    `${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(otherNorthRegisterReceipt.receiptNo)}`,
    { headers: auth.headers },
  );
  expect(otherRegisterReceiptResponse.ok()).toBe(true);
  const otherRegisterReceiptData = await otherRegisterReceiptResponse.json() as {
    saleId: string; items: Array<{ id: string }>;
  };
  expect(otherRegisterReceiptData.items[0]?.id).toBeTruthy();
  const staffEmail = "scope-cashier-" + stamp + "@example.com";
  const staff = await createStaffMember(request, auth.headers, {
    email: staffEmail, name: "Scoped Cashier", role: "cashier",
  });
  await page.goto("/team");
  // Desktop uses a table row; small screens render accessible employee cards.
  const member = page.getByRole("row").filter({ hasText: staffEmail }).or(
    page.getByRole("region", { name: "Mobile employee access" }).getByRole("article").filter({ hasText: staffEmail }),
  );
  await expect(member).toBeVisible();
  await member.getByRole("button", { name: "Branch access" }).click();
  const dialog = page.getByRole("dialog", { name: "Assign staff branch access" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Unrestricted/ }).uncheck();
  await dialog.getByRole("checkbox", { name: "North branch" }).check();
  await dialog.getByLabel("Confirm owner password").fill(password);
  await dialog.getByRole("button", { name: "Verify & save branches" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await member.getByRole("button", { name: "Register access" }).click();
  const registerDialog = page.getByRole("dialog", { name: "Assign staff registers" });
  await expect(registerDialog).toBeVisible();
  await registerDialog.getByRole("checkbox", { name: "All registers within permitted branches" }).uncheck();
  await registerDialog.getByRole("checkbox", { name: "North till", exact: true }).check();
  await registerDialog.getByLabel("Confirm owner password").fill(password);
  await registerDialog.getByRole("button", { name: "Verify & save registers" }).click();
  await expect(registerDialog).toBeHidden({ timeout: 30_000 });

  await signIn(page, staffEmail, staff.tempPassword);
  const staffAuth = await apiAuthedContext(request, staffEmail, staff.tempPassword, page);
  const [inScopeReceipt, otherRegisterReceipt, otherBranchReceipt] = await Promise.all([
    request.get(`${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(northReceipt.receiptNo)}`, { headers: staffAuth.headers }),
    request.get(`${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(otherNorthRegisterReceipt.receiptNo)}`, { headers: staffAuth.headers }),
    request.get(`${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(southReceipt.receiptNo)}`, { headers: staffAuth.headers }),
  ]);
  expect(inScopeReceipt.status()).toBe(200);
  expect(otherRegisterReceipt.status()).toBe(403);
  expect(otherBranchReceipt.status()).toBe(403);
  const crossRegisterConcern = await request.post(`${API}/api/v1/customer-concerns`, {
    headers: { ...staffAuth.headers, "Idempotency-Key": `cross-register-concern-${stamp}` },
    data: {
      saleId: otherRegisterReceiptData.saleId,
      items: [{ saleItemId: otherRegisterReceiptData.items[0]!.id, qty: 1 }],
      reason: "DAMAGED",
      outcome: "REFUND",
    },
  });
  expect(crossRegisterConcern.status()).toBe(403);
  for (const receipt of [otherNorthRegisterReceipt, southReceipt]) {
    await page.goto(`/customer-concerns/new/${encodeURIComponent(receipt.receiptNo)}`);
    const intake = page.locator("main");
    await expect(intake.getByRole("alert")).toContainText("No matching receipt is available within your current access.");
    await expect(intake.getByText("RECEIPT VERIFIED")).toHaveCount(0);
    await expect(intake.getByRole("group", { name: "Items and quantities" })).toHaveCount(0);
  }
  const branchSelect = page.locator('select[aria-label="Active branch"]:visible');
  await expect(branchSelect).toHaveValue(northId);
  await page.goto("/pos");
  const registers = page.locator(
    'select[aria-label="Register"]:visible, select[aria-label="Mobile register"]:visible',
  );
  await expect(registers).toContainText("North till");
  await expect(registers).not.toContainText("South till");
  await expect(registers).not.toContainText("Extra North till");
  const check = await page.evaluate(async (remoteId) => {
    const [branches, reports, inventory, sales, shifts, inventoryReport, forbiddenReport, crossBranchReport] = await Promise.all([
      fetch("/api/v1/branches", { credentials: "include" }),
      fetch("/api/v1/reports/sales", { credentials: "include" }),
      fetch("/api/v1/inventory/balances?branchId=" + encodeURIComponent(remoteId), { credentials: "include" }),
      fetch("/api/v1/sales", { credentials: "include" }),
      fetch("/api/v1/shifts", { credentials: "include" }),
      fetch("/api/v1/reports/inventory", { credentials: "include" }),
      fetch("/api/v1/reports/payments", { credentials: "include" }),
      fetch("/api/v1/reports/sales?branchId=" + encodeURIComponent(remoteId), { credentials: "include" }),
    ]);
    const values = (await branches.json()) as { items: Array<{ id: string }> };
    return {
      branchStatus: branches.status,
      branchIds: values.items.map((item) => item.id),
      reportStatus: reports.status,
      inventoryStatus: inventory.status,
      salesStatus: sales.status,
      shiftsStatus: shifts.status,
      inventoryReportStatus: inventoryReport.status,
      forbiddenReportStatus: forbiddenReport.status,
      crossBranchReportStatus: crossBranchReport.status,
    };
  }, southId);
  expect(check.branchStatus).toBe(200);
  expect(check.branchIds).toEqual([northId]);
  // Report entitlement is plan-dependent; branch guard must not deny the
  // explicitly audited reports, regardless of whether billing permits them.
  expect(check.reportStatus).toBe(403);
  expect(check.inventoryReportStatus).not.toBe(403);
  expect(check.inventoryReportStatus).toBeLessThan(500);
  expect(check.forbiddenReportStatus).toBe(403);
  expect(check.crossBranchReportStatus).toBe(403);
  expect(check.inventoryStatus).toBe(403);
  expect(check.salesStatus).toBe(200);
  expect(check.shiftsStatus).toBe(200);
});
