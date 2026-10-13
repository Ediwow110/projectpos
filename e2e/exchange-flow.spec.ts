import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, createStaffMember, registerOperationalBusiness, seedProduct, signIn, signOut } from "./helpers";

test("owner exchanges a cash sale for a higher-priced replacement and sees the linked transaction", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Exchange Owner",
    email: `exchange-owner-${stamp}@example.com`,
    password,
    businessName: `Exchange Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const originalName = `Original Shirt ${stamp}`;
  const replacementName = `Replacement Shirt ${stamp}`;
  const originalProductId = await seedProduct(request, headers, { name: originalName, priceMinor: 2500, stock: 10 });
  await seedProduct(request, headers, { name: replacementName, priceMinor: 3000, stock: 10 });

  const register = await request.post(`${API}/api/v1/registers`, {
    headers,
    data: { name: `Exchange Counter ${stamp}` },
  });
  expect(register.ok()).toBe(true);
  const registerId = ((await register.json()) as { id: string }).id;
  const opened = await request.post(`${API}/api/v1/registers/${registerId}/open`, {
    headers,
    data: { registerId, openingFloatMinor: 0 },
  });
  expect(opened.ok()).toBe(true);

  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: {
      lines: [{ productId: originalProductId, qty: 1 }],
      registerId,
    },
  });
  expect(draft.ok()).toBe(true);
  const draftBody = await draft.json() as { id: string; totalMinor: number };
  const completed = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `exchange-original-${stamp}` },
    data: {
      saleId: draftBody.id,
      registerId,
      payments: [{ method: "cash", amountMinor: draftBody.totalMinor }],
    },
  });
  expect(completed.ok()).toBe(true);
  const originalSale = await completed.json() as { id: string; receiptNo: string };

  await page.goto(`/sales/${originalSale.id}`);
  await expect(page.getByRole("heading", { name: `Sale ${originalSale.receiptNo}` })).toBeVisible();
  await page.getByRole("button", { name: "Exchange items", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Exchange items" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("region", { name: "Items to return" }).getByRole("spinbutton").fill("1");
  await dialog.getByLabel("Search replacement products").fill(replacementName);
  const replacementRegion = dialog.getByRole("region", { name: "Replacement products" });
  await expect(replacementRegion.getByText(replacementName, { exact: true })).toBeVisible();
  await replacementRegion.getByRole("spinbutton").fill("1");
  await dialog.getByLabel("Reason for exchange").fill("Customer needs a different size");
  await expect(dialog.getByText("Collect ₱5.00", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Complete exchange", exact: true }).click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("status")).toContainText("Exchange completed. Collect ₱5.00.");
  const history = page.getByRole("region", { name: "Exchange history" });
  await expect(history).toContainText("COLLECT");
  await expect(history).toContainText("₱5.00");
  const replacementLink = history.getByRole("link", { name: /Open replacement sale/i });
  await expect(replacementLink).toBeVisible();
  await replacementLink.click();
  await expect(page.getByRole("region", { name: "Exchange origin" })).toContainText(originalSale.receiptNo);
  await expect(page.getByRole("link", { name: "Open original sale" })).toHaveAttribute("href", `/sales/${originalSale.id}`);

  const detail = await request.get(`${API}/api/v1/sales/${originalSale.id}`, { headers });
  expect(detail.ok()).toBe(true);
  const detailBody = await detail.json() as {
    status: string;
    exchanges: Array<{ netMinor: number; direction: string; replacementSaleId: string }>;
  };
  expect(detailBody.status).toBe("REFUNDED");
  expect(detailBody.exchanges).toEqual([
    expect.objectContaining({ netMinor: 500, direction: "COLLECT" }),
  ]);
});

test("cashier exchange concern is manager-approved before the existing exchange executes", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerPassword = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Exchange Case Owner", email: `exchange-case-owner-${stamp}@example.com`, password: ownerPassword,
    businessName: `Exchange Case Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, ownerPassword, page);
  const managerEmail = `exchange-case-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Exchange Case Manager", role: "manager" });
  const cashierEmail = `exchange-case-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Exchange Case Cashier", role: "cashier" });
  const originalName = `Case Original ${stamp}`;
  const replacementName = `Case Replacement ${stamp}`;
  const originalProductId = await seedProduct(request, ownerHeaders, { name: originalName, priceMinor: 2500, stock: 5 });
  await seedProduct(request, ownerHeaders, { name: replacementName, priceMinor: 3000, stock: 5 });
  const registerResponse = await request.post(`${API}/api/v1/registers`, { headers: ownerHeaders, data: { name: `Case Exchange Till ${stamp}` } });
  expect(registerResponse.ok()).toBe(true);
  const registerId = ((await registerResponse.json()) as { id: string }).id;
  const opened = await request.post(`${API}/api/v1/registers/${registerId}/open`, { headers: ownerHeaders, data: { registerId, openingFloatMinor: 0 } });
  expect(opened.ok()).toBe(true);
  const draftResponse = await request.post(`${API}/api/v1/sales/drafts`, { headers: ownerHeaders, data: { lines: [{ productId: originalProductId, qty: 1 }], registerId } });
  expect(draftResponse.ok()).toBe(true);
  const draft = await draftResponse.json() as { id: string; totalMinor: number };
  const completeResponse = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...ownerHeaders, "Idempotency-Key": `exchange-case-sale-${stamp}` },
    data: { saleId: draft.id, registerId, payments: [{ method: "cash", amountMinor: draft.totalMinor }] },
  });
  expect(completeResponse.ok()).toBe(true);
  const sale = await completeResponse.json() as { id: string; receiptNo: string };
  const saleDetailResponse = await request.get(`${API}/api/v1/sales/${sale.id}`, { headers: ownerHeaders });
  expect(saleDetailResponse.ok()).toBe(true);
  const saleDetail = await saleDetailResponse.json() as { items: Array<{ id: string }> };
  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword);
  const concernResponse = await request.post(`${API}/api/v1/customer-concerns`, {
    headers: { ...cashierHeaders, "Idempotency-Key": `exchange-case-${stamp}` },
    data: { saleId: sale.id, items: [{ saleItemId: saleDetail.items[0]!.id, qty: 1 }], reason: "DAMAGED", outcome: "EXCHANGE", note: "Customer requested a size replacement." },
  });
  expect(concernResponse.status()).toBe(201);
  const concern = (await concernResponse.json() as { concern: { id: string } }).concern;

  await signOut(page);
  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/customer-concerns");
  await expect(page.getByRole("heading", { name: "Customer case inbox" })).toBeVisible();
  await page.getByLabel("Case type").selectOption("EXCHANGE");
  const card = page.locator("section[aria-label='Customer case results']").filter({ hasText: sale.receiptNo });
  await expect(card).toContainText("PENDING");
  await card.getByLabel("Decision note").fill("Approved replacement after review.");
  await card.getByRole("button", { name: "Authorize request" }).click();
  await expect(page.getByText("No cases match these filters.")).toBeVisible();
  await page.getByLabel("Case status").selectOption("ALL");
  await expect(card).toContainText("APPROVED");
  await expect(card.getByRole("link", { name: "Open approved exchange" })).toBeVisible();
  await card.getByRole("link", { name: "Open approved exchange" }).click();
  await expect(page.getByRole("heading", { name: `Sale ${sale.receiptNo}` })).toBeVisible();
  await page.getByRole("button", { name: "Exchange items", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Exchange items" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("region", { name: "Items to return" }).getByRole("spinbutton").fill("1");
  await dialog.getByLabel("Search replacement products").fill(replacementName);
  const replacements = dialog.getByRole("region", { name: "Replacement products" });
  await expect(replacements.getByText(replacementName, { exact: true })).toBeVisible();
  await replacements.getByRole("spinbutton").fill("1");
  await dialog.getByLabel("Reason for exchange").fill("Customer requested a size replacement.");
  await dialog.getByRole("button", { name: "Complete exchange", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("status")).toContainText("Exchange completed. Collect ₱5.00.");

  const { headers: managerHeaders } = await apiAuthedContext(request, managerEmail, manager.tempPassword);
  const concernStatus = await request.get(`${API}/api/v1/customer-concerns/${concern.id}`, { headers: managerHeaders });
  expect(concernStatus.ok()).toBe(true);
  expect(await concernStatus.json()).toMatchObject({ status: "RESOLVED", outcome: "EXCHANGE" });
  const finalSale = await request.get(`${API}/api/v1/sales/${sale.id}`, { headers: managerHeaders });
  expect(finalSale.ok()).toBe(true);
  expect(await finalSale.json()).toMatchObject({ status: "REFUNDED", exchanges: [expect.objectContaining({ direction: "COLLECT", netMinor: 500 })] });
});
