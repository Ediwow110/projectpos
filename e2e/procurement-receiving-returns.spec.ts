import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

interface PurchaseOrder {
  id: string;
  version: number;
  poNumber: string;
  status: string;
  lines: Array<{ id: string; productId: string }>;
}

interface SupplierReturn {
  id: string;
  version: number;
  status: string;
}

async function quantity(
  request: APIRequestContext,
  headers: Record<string, string>,
  productId: string,
): Promise<number> {
  const response = await request.get(`${API}/api/v1/inventory/balances?pageSize=50`, { headers });
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as { items: Array<{ productId: string; qtyOnHand: number }> };
  const row = data.items.find((item) => item.productId === productId);
  expect(row, `stock row for ${productId}`).toBeTruthy();
  return row!.qtyOnHand;
}

test("purchase receipt and supplier return update stock once despite replay", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Receiving QA Owner",
    email: `receiving-${stamp}@example.com`,
    password,
    businessName: "Receiving QA Business",
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, {
    name: `Receiving QA Product ${stamp}`,
    priceMinor: 2500,
    stock: 8,
  });
  expect(await quantity(request, headers, productId)).toBe(8);

  const supplierResponse = await request.post(`${API}/api/v1/suppliers`, {
    headers: { ...headers, "Idempotency-Key": `recv-supplier-${stamp}` },
    data: { name: "Receiving QA Supplier" },
  });
  expect(supplierResponse.status()).toBe(201);
  const supplier = (await supplierResponse.json()) as { supplier: { id: string } };

  const draftResponse = await request.post(`${API}/api/v1/purchase-orders`, {
    headers: { ...headers, "Idempotency-Key": `recv-po-${stamp}` },
    data: { supplierId: supplier.supplier.id, lines: [{ productId, quantity: 10, unitCostMinor: 125 }] },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = (await draftResponse.json()) as { purchaseOrder: PurchaseOrder };
  const po = draft.purchaseOrder;
  const lineId = po.lines[0]!.id;

  const order = await request.post(`${API}/api/v1/purchase-orders/${po.id}/order`, {
    headers: { ...headers, "Idempotency-Key": `recv-order-${stamp}` },
    data: { expectedVersion: po.version },
  });
  expect(order.ok()).toBe(true);
  expect(await quantity(request, headers, productId)).toBe(8);

  await page.goto(`/purchase-orders/${po.id}`);
  await expect(page.getByText("Receiving lines")).toBeVisible();

  const receiptUrl = `${API}/api/v1/purchase-orders/${po.id}/receipts`;
  const firstReceipt = { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 4 }] };
  const firstKey = `recv-receipt-1-${stamp}`;
  const first = await request.post(receiptUrl, {
    headers: { ...headers, "Idempotency-Key": firstKey },
    data: firstReceipt,
  });
  expect(first.status()).toBe(201);
  const partial = (await first.json()) as { purchaseOrder: PurchaseOrder; replayed: boolean };
  expect(partial.purchaseOrder.status).toBe("PARTIALLY_RECEIVED");
  expect(await quantity(request, headers, productId)).toBe(12);

  const replayFirst = await request.post(receiptUrl, {
    headers: { ...headers, "Idempotency-Key": firstKey },
    data: firstReceipt,
  });
  expect(replayFirst.status()).toBe(200);
  expect(((await replayFirst.json()) as { replayed: boolean }).replayed).toBe(true);
  expect(await quantity(request, headers, productId)).toBe(12);

  const over = await request.post(receiptUrl, {
    headers: { ...headers, "Idempotency-Key": `recv-over-${stamp}` },
    data: { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 7 }] },
  });
  expect(over.ok()).toBe(false);
  expect(await quantity(request, headers, productId)).toBe(12);

  const second = await request.post(receiptUrl, {
    headers: { ...headers, "Idempotency-Key": `recv-receipt-2-${stamp}` },
    data: { lines: [{ purchaseOrderLineId: lineId, quantityReceived: 6 }] },
  });
  expect(second.status()).toBe(201);
  expect(((await second.json()) as { purchaseOrder: PurchaseOrder }).purchaseOrder.status).toBe("RECEIVED");
  expect(await quantity(request, headers, productId)).toBe(18);

  const returnResponse = await request.post(`${API}/api/v1/supplier-returns`, {
    headers: { ...headers, "Idempotency-Key": `recv-return-${stamp}` },
    data: {
      supplierId: supplier.supplier.id,
      purchaseOrderId: po.id,
      reason: "Three damaged items",
      lines: [{ purchaseOrderLineId: lineId, quantity: 3 }],
    },
  });
  expect(returnResponse.status()).toBe(201);
  const createdReturn = (await returnResponse.json()) as { supplierReturn: SupplierReturn };
  expect(await quantity(request, headers, productId)).toBe(18);

  const postUrl = `${API}/api/v1/supplier-returns/${createdReturn.supplierReturn.id}/post`;
  const postKey = `recv-return-post-${stamp}`;
  const postBody = { expectedVersion: createdReturn.supplierReturn.version };
  const posted = await request.post(postUrl, {
    headers: { ...headers, "Idempotency-Key": postKey },
    data: postBody,
  });
  expect(posted.ok()).toBe(true);
  expect(((await posted.json()) as { supplierReturn: SupplierReturn }).supplierReturn.status).toBe("POSTED");
  expect(await quantity(request, headers, productId)).toBe(15);

  const replayReturn = await request.post(postUrl, {
    headers: { ...headers, "Idempotency-Key": postKey },
    data: postBody,
  });
  expect(replayReturn.ok()).toBe(true);
  expect(((await replayReturn.json()) as { replayed: boolean }).replayed).toBe(true);
  expect(await quantity(request, headers, productId)).toBe(15);

  await page.goto("/supplier-returns");
  await expect(page.getByText("Three damaged items")).toBeVisible();
});
