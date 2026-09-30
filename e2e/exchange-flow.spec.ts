import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

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
