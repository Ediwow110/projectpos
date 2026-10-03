import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

test("owner completes procurement foundation flow without changing stock", async ({ page, request }) => {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Procurement E2E Owner",
    email: "procurement-e2e-owner@example.com",
    password,
    businessName: "Procurement E2E Store",
  });
  const auth = await apiAuthedContext(request, email, password, page);
  const productA = await seedProduct(request, auth.headers, { name: "E2E Coffee", priceMinor: 2500, stock: 8 });
  const productB = await seedProduct(request, auth.headers, { name: "E2E Tea", priceMinor: 1800, stock: 7 });
  const before = await request.get(`${API}/api/v1/inventory/balances`, { headers: auth.headers });
  expect(before.ok()).toBe(true);
  const beforeBalances = await before.json();

  const supplierResponse = await request.post(`${API}/api/v1/suppliers`, {
    headers: { ...auth.headers, "Idempotency-Key": "e2e-supplier-create" },
    data: { name: "E2E Supplier", code: "E2E-SUPPLIER" },
  });
  expect(supplierResponse.status()).toBe(201);
  const supplier = (await supplierResponse.json()).supplier as { id: string };
  const mapping = await request.post(`${API}/api/v1/suppliers/${supplier.id}/products`, {
    headers: auth.headers,
    data: { productId: productA, supplierSku: "E2E-COF", unitCostMinor: 125, isPreferred: true },
  });
  expect(mapping.ok()).toBe(true);
  const draftResponse = await request.post(`${API}/api/v1/purchase-orders`, {
    headers: { ...auth.headers, "Idempotency-Key": "e2e-po-create" },
    data: { supplierId: supplier.id, lines: [{ productId: productA, quantity: 2 }, { productId: productB, quantity: 1, unitCostMinor: 300 }] },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = (await draftResponse.json()).purchaseOrder as { id: string; version: number; poNumber: string; totalMinor: number };
  expect(draft.totalMinor).toBe(550);

  await page.goto("/purchase-orders");
  await expect(page.getByRole("heading", { name: "Purchase orders", exact: true })).toBeVisible();
  await expect(page.getByText(draft.poNumber, { exact: true })).toBeVisible();
  await page.goto(`/purchase-orders/${draft.id}`);
  await expect(page.getByText("Commercial procurement record.")).toBeVisible();

  const ordered = await request.post(`${API}/api/v1/purchase-orders/${draft.id}/order`, {
    headers: { ...auth.headers, "Idempotency-Key": "e2e-po-order" },
    data: { expectedVersion: draft.version },
  });
  expect(ordered.ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("This order is locked until the future receiving phase.")).toBeVisible();

  const after = await request.get(`${API}/api/v1/inventory/balances`, { headers: auth.headers });
  expect(after.ok()).toBe(true);
  expect(await after.json()).toEqual(beforeBalances);
});
