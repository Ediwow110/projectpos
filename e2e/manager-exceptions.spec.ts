import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

const OWNER_PASSWORD = "correct-horse-12";

test("owner exception center links real unknown-payment and stock-count records without executing them", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const email = await registerOperationalBusiness(page, {
    ownerName: "Exception Center Owner",
    email: `exception-center-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Exception Center Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, OWNER_PASSWORD, page);
  const productName = `Exception Product ${stamp}`;
  const productId = await seedProduct(request, headers, { name: productName, priceMinor: 2500, stock: 10 });

  const draftResponse = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draftResponse.ok()).toBe(true);
  const draft = await draftResponse.json() as { id: string; receiptNo: string; totalMinor: number };
  const unknownPayment = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `exception-unknown-${stamp}` },
    data: { saleId: draft.id, payments: [{ method: "gcash", amountMinor: draft.totalMinor, providerRef: `unknown-exception-${stamp}` }] },
  });
  const unknownPaymentBody = await unknownPayment.json() as { code?: string };
  expect(unknownPayment.status(), JSON.stringify(unknownPaymentBody)).toBe(202);

  const createCount = await request.post(`${API}/api/v1/inventory/counts`, {
    headers: { ...headers, "Idempotency-Key": `exception-count-${stamp}` },
    data: { name: `Exception count ${stamp}`, scopeType: "PARTIAL", branchId: null, productIds: [productId] },
  });
  expect(createCount.status()).toBe(201);
  const count = await createCount.json() as { id: string; version: number; lines: Array<{ id: string }> };
  const start = await request.post(`${API}/api/v1/inventory/counts/${count.id}/start`, {
    headers, data: { expectedVersion: count.version },
  });
  expect(start.ok()).toBe(true);
  const started = await start.json() as { version: number; lines: Array<{ id: string }> };
  const lineUpdate = await request.patch(`${API}/api/v1/inventory/counts/${count.id}/lines`, {
    headers,
    data: { expectedVersion: started.version, lines: [{ lineId: started.lines[0]!.id, countedQty: 8 }] },
  });
  expect(lineUpdate.ok()).toBe(true);
  const updated = await lineUpdate.json() as { version: number };
  const submitted = await request.post(`${API}/api/v1/inventory/counts/${count.id}/submit`, {
    headers, data: { expectedVersion: updated.version },
  });
  expect(submitted.ok()).toBe(true);

  await page.goto("/exceptions");
  await expect(page.getByRole("heading", { name: "Operational exception center" })).toBeVisible();
  const paymentException = page.locator("article").filter({ hasText: "Payment status unknown" }).filter({ hasText: draft.receiptNo });
  await expect(paymentException).toContainText("confirm before retry");
  await expect(paymentException.getByRole("link", { name: "Review record: Payment status unknown" })).toHaveAttribute("href", `/sales/${draft.id}`);
  const countException = page.locator("article").filter({ hasText: "Stock count variance" }).filter({ hasText: productName });
  await expect(countException).toContainText("2 short");
  await expect(countException.getByRole("link", { name: "Review record: Stock count variance" })).toHaveAttribute("href", `/inventory/counts/${count.id}`);
  await expect(page.getByText("This center is read-only.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const saleStatus = await request.get(`${API}/api/v1/sales/${draft.id}`, { headers });
  expect(saleStatus.ok()).toBe(true);
  expect((await saleStatus.json() as { status: string }).status).toBe("PAYMENT_UNKNOWN");
  const countStatus = await request.get(`${API}/api/v1/inventory/counts/${count.id}`, { headers });
  expect(countStatus.ok()).toBe(true);
  expect((await countStatus.json() as { status: string }).status).toBe("SUBMITTED");
});
