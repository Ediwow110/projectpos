import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

async function createCompletedReceipt(
  page: Page,
  request: APIRequestContext,
  input: { ownerEmail: string; password: string; stamp: number; customerEmail?: string; branchId?: string },
): Promise<{ headers: Record<string, string>; saleId: string; receiptNo: string }> {
  const { headers } = await apiAuthedContext(request, input.ownerEmail, input.password, page);
  const productId = await seedProduct(request, headers, {
    name: `Receipt Item ${input.stamp}`,
    priceMinor: 2500,
    stock: 10,
  });
  if (input.branchId) {
    const branchStock = await request.post(`${API}/api/v1/inventory/movements`, {
      headers,
      data: { productId, branchId: input.branchId, type: "opening_stock", qtyDelta: 10 },
    });
    expect(branchStock.ok()).toBe(true);
  }
  let customerId: string | undefined;
  if (input.customerEmail) {
    const customer = await request.post(`${API}/api/v1/customers`, {
      headers,
      data: { name: `Receipt Customer ${input.stamp}`, email: input.customerEmail },
    });
    expect(customer.ok()).toBe(true);
    customerId = ((await customer.json()) as { id: string }).id;
  }
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: {
      lines: [{ productId, qty: 1 }],
      ...(customerId ? { customerId } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
    },
  });
  expect(draft.ok()).toBe(true);
  const draftBody = await draft.json() as { id: string; totalMinor: number };
  const completed = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `receipt-e2e-sale-${input.stamp}` },
    data: { saleId: draftBody.id, payments: [{ method: "cash", amountMinor: draftBody.totalMinor }] },
  });
  expect(completed.ok()).toBe(true);
  const completeBody = await completed.json() as { receiptNo: string };
  return { headers, saleId: draftBody.id, receiptNo: completeBody.receiptNo };
}

test("completed receipt can be emailed and opened from a secure public share link", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const customerEmail = `receipt-customer-${process.env.TEST_WORKER_INDEX ?? "w"}-${stamp}@example.com`;
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Receipt Delivery Owner",
    email: `receipt-delivery-owner-${stamp}@example.com`,
    password,
    businessName: `Receipt Delivery Store ${stamp}`,
  });
  const { headers, saleId, receiptNo } = await createCompletedReceipt(page, request, {
    ownerEmail,
    password,
    stamp,
    customerEmail,
  });

  await page.goto(`/receipts/${saleId}`);
  await expect(page.getByRole("article", { name: "Receipt" })).toContainText(receiptNo);
  await page.getByRole("button", { name: "Deliver receipt" }).click();
  const delivery = page.getByRole("dialog", { name: "Deliver receipt" });
  await expect(delivery).toBeVisible();
  await expect(delivery).toHaveAttribute("data-ui", "atlas-flow-modal");
  await expect(delivery).toHaveCSS("background-color", "rgb(255, 255, 255)");
  if ((page.viewportSize()?.width ?? 0) >= 600) {
    expect((await delivery.boundingBox())?.width).toBeCloseTo(535, 0);
  }
  await expect(delivery.getByText("Workflow step", { exact: true })).toBeVisible();
  await expect(delivery.getByLabel("Customer email")).toHaveValue(customerEmail);
  await delivery.getByRole("button", { name: "Email receipt", exact: true }).click();
  await expect(delivery.getByRole("status")).toContainText(`Receipt emailed to ${customerEmail}.`);
  await expect(delivery.getByRole("region", { name: "Receipt delivery history" })).toContainText("SENT");

  const deliveries = await request.get(`${API}/api/v1/receipts/${saleId}/deliveries`, { headers });
  expect(deliveries.ok()).toBe(true);
  expect(((await deliveries.json()) as { items: Array<{ recipient: string; status: string }> }).items).toEqual([
    expect.objectContaining({ recipient: customerEmail, status: "SENT" }),
  ]);

  const share = await request.post(`${API}/api/v1/receipts/${saleId}/share`, { headers, data: {} });
  expect(share.ok()).toBe(true);
  const token = ((await share.json()) as { token: string }).token;
  await page.goto(`/receipts/shared/${encodeURIComponent(token)}`);
  await expect(page.getByRole("article", { name: "Shared receipt" })).toContainText(receiptNo);
  await expect(page.getByRole("article", { name: "Shared receipt" })).toContainText("₱25.00");
});

test("owner pairs a printer, tests it, prints a receipt, and requeues an agent-claimed job", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Printer Owner",
    email: `printer-owner-${stamp}@example.com`,
    password,
    businessName: `Printer Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, password, page);
  const branchName = `Printer Branch ${stamp}`;
  const branch = await request.post(`${API}/api/v1/branches`, {
    headers,
    data: { name: branchName, type: "store" },
  });
  expect(branch.ok()).toBe(true);
  const branchId = ((await branch.json()) as { id: string }).id;
  const receipt = await createCompletedReceipt(page, request, {
    ownerEmail,
    password,
    stamp,
    branchId,
  });
  const { saleId, receiptNo } = receipt;

  await page.goto("/printers");
  await page.getByRole("button", { name: "+ Enroll printer" }).click();
  const enroll = page.getByRole("dialog", { name: "Enroll receipt printer" });
  await enroll.getByLabel("Printer name").fill("Front Till Printer");
  await enroll.getByLabel("Branch").selectOption({ label: branchName });
  await enroll.getByLabel("Paper width").selectOption("58");
  await enroll.getByRole("button", { name: "Enroll printer", exact: true }).click();

  const pairing = page.getByRole("dialog", { name: "Printer pairing token" });
  await expect(pairing).toBeVisible();
  const agentToken = ((await pairing.locator('[data-ui="printer-agent-token"]').textContent()) ?? "").trim();
  expect(agentToken).toMatch(/^prn_[0-9a-f]{8}_[0-9a-f]{32}$/);
  await pairing.getByRole("button", { name: "Close pairing token" }).click();
  await expect(pairing).toBeHidden();

  const printerCard = page.getByRole("article").filter({ hasText: "Front Till Printer" });
  await expect(printerCard).toContainText(branchName);
  await printerCard.getByRole("button", { name: "Make default" }).click();
  await expect(printerCard).toContainText("Default");
  await printerCard.getByRole("button", { name: "Test print" }).click();
  await expect(page.getByRole("status")).toContainText("Test print queued");

  const printers = await request.get(`${API}/api/v1/printers`, { headers });
  expect(printers.ok()).toBe(true);
  const printer = ((await printers.json()) as { items: Array<{ id: string; name: string }> }).items.find((item) => item.name === "Front Till Printer");
  expect(printer).toBeTruthy();
  const printerId = printer!.id;

  const testPickup = await request.get(`${API}/api/v1/print-jobs/next?printerId=${printerId}`, {
    headers: { "x-printer-agent": agentToken },
  });
  expect(testPickup.ok()).toBe(true);
  expect(Buffer.from(((await testPickup.json()) as { payload: string }).payload, "base64").toString("ascii")).toContain("NEXPOS PRINTER TEST");

  await expect.poll(async () => {
    const latest = await request.get(`${API}/api/v1/printers`, { headers });
    const body = await latest.json() as { items: Array<{ id: string; agentStatus: string }> };
    return body.items.find((item) => item.id === printerId)?.agentStatus;
  }).toBe("online");

  await page.goto(`/receipts/${saleId}`);
  await page.getByRole("button", { name: "Print to device" }).click();
  const printDialog = page.getByRole("dialog", { name: "Print receipt" });
  await expect(printDialog).toContainText("Front Till Printer");
  await expect(printDialog).toContainText("Default");
  await printDialog.getByRole("button", { name: "Queue receipt" }).click();
  await expect(printDialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Receipt queued to Front Till Printer");

  const receiptPickup = await request.get(`${API}/api/v1/print-jobs/next?printerId=${printerId}`, {
    headers: { "x-printer-agent": agentToken },
  });
  expect(receiptPickup.ok()).toBe(true);
  const receiptJob = await receiptPickup.json() as { id: string; receiptNo: string; payload: string; status: string };
  expect(receiptJob).toMatchObject({ receiptNo, status: "SENT" });
  expect(Buffer.from(receiptJob.payload, "base64").toString("ascii")).toContain(receiptNo);

  await page.goto("/printers");
  const receiptRow = page.getByRole("row").filter({ hasText: `Receipt ${receiptNo}` }).first();
  await expect(receiptRow).toContainText("SENT", { timeout: 20_000 });
  await receiptRow.getByRole("button", { name: "Requeue" }).click();
  await expect(page.getByRole("status")).toContainText("Print job requeued as a new job.");
  await expect(page.getByRole("row").filter({ hasText: `Receipt ${receiptNo}` }).filter({ hasText: "QUEUED" }).first()).toBeVisible();
});
