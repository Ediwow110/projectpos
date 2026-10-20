import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

type Headers = Record<string, string>;
type Count = { id: string; status: string; version: number; lines: Array<{ id: string; productId: string; expectedQtySnapshot: number; countedQty: number | null; varianceQty: number | null }> };

async function post(request: APIRequestContext, headers: Headers, path: string, body: unknown, key?: string): Promise<{ response: Awaited<ReturnType<APIRequestContext["post"]>>; json: any }> {
  const response = await request.post(`${API}${path}`, { headers: { ...headers, ...(key ? { "Idempotency-Key": key } : {}) }, data: body });
  let json: any = null;
  try { json = await response.json(); } catch { /* empty response */ }
  return { response, json };
}

async function createCount(request: APIRequestContext, headers: Headers, productId: string, name: string): Promise<Count> {
  const created = await post(request, headers, "/api/v1/inventory/counts", { name, scopeType: "PARTIAL", branchId: null, productIds: [productId] }, crypto.randomUUID());
  expect(created.response.status()).toBe(201);
  return created.json as Count;
}

async function progressCount(request: APIRequestContext, headers: Headers, count: Count, countedQty: number): Promise<{ approved: Count; post: any }> {
  const started = await post(request, headers, `/api/v1/inventory/counts/${count.id}/start`, { expectedVersion: count.version });
  expect(started.response.ok()).toBe(true);
  const line = (started.json as Count).lines[0]!;
  const updated = await request.patch(`${API}/api/v1/inventory/counts/${count.id}/lines`, { headers, data: { expectedVersion: (started.json as Count).version, lines: [{ lineId: line.id, countedQty }] } });
  expect(updated.ok()).toBe(true);
  const updatedJson = await updated.json() as Count;
  const submitted = await post(request, headers, `/api/v1/inventory/counts/${count.id}/submit`, { expectedVersion: updatedJson.version });
  expect(submitted.response.ok()).toBe(true);
  const approved = await post(request, headers, `/api/v1/inventory/counts/${count.id}/approve`, { expectedVersion: (submitted.json as Count).version });
  expect(approved.response.ok()).toBe(true);
  const approvedCount = approved.json as Count;
  const posted = await post(request, headers, `/api/v1/inventory/counts/${count.id}/post`, { expectedVersion: approvedCount.version }, crypto.randomUUID());
  expect(posted.response.status()).toBe(201);
  return { approved: approvedCount, post: posted.json };
}

async function balance(request: APIRequestContext, headers: Headers, productId: string): Promise<number> {
  const response = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers });
  expect(response.ok()).toBe(true);
  const body = await response.json() as { items: Array<{ productId: string; qtyOnHand: number }> };
  return body.items.find((item) => item.productId === productId)?.qtyOnHand ?? 0;
}

async function movementHistory(request: APIRequestContext, headers: Headers, productId: string): Promise<Array<{ type: string; qtyDelta: number; referenceType?: string }>> {
  const response = await request.get(`${API}/api/v1/inventory/products/${productId}/movements?page=1&pageSize=100`, { headers });
  expect(response.ok()).toBe(true);
  return (await response.json() as { items: Array<{ type: string; qtyDelta: number; referenceType?: string }> }).items;
}

async function fillCountInUi(page: Page, count: Count, countName: string, countedQty: number): Promise<void> {
  await page.goto(`/inventory/counts/${count.id}`);
  await expect(page.getByRole("heading", { name: countName, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start counting" }).click();
  const input = page.getByRole("spinbutton", { name: /Counted quantity/ });
  await expect(input).toBeVisible();
  await input.fill(String(countedQty));
  const saved = page.waitForResponse((response) => response.url().includes(`/api/v1/inventory/counts/${count.id}/lines`) && response.request().method() === "PATCH");
  await input.press("Tab");
  expect((await saved).status()).toBe(200);
  await expect(input).toHaveValue(String(countedQty));
}

test("Phase 18 count lifecycle, replenishment, RBAC, and responsive surfaces", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Phase 18 E2E Owner",
    email: `phase18-owner-${testInfo.project.name}-${Date.now()}@example.com`,
    password,
    businessName: `Phase 18 E2E Store ${testInfo.project.name}`,
  });
  const auth = await apiAuthedContext(request, email, password, page);

  const negativeName = `QA PH18 Count ${Date.now()}`;
  const negativeProduct = await seedProduct(request, auth.headers, { name: negativeName, priceMinor: 2500, stock: 10 });
  const createdResponse = page.waitForResponse((response) => response.url().includes("/api/v1/inventory/counts") && response.request().method() === "POST");
  await page.goto("/inventory/counts");
  await page.getByLabel("Scope").selectOption("PARTIAL");
  await page.getByLabel("Count name").fill("Negative variance browser count");
  await page.getByRole("checkbox", { name: negativeName }).check();
  await page.getByRole("button", { name: "Create count" }).click();
  const created = await (await createdResponse).json() as Count;
  await fillCountInUi(page, created, "Negative variance browser count", 8);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("SUBMITTED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve count" }).click();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible();
  const approvedBeforePost = await (await request.get(`${API}/api/v1/inventory/counts/${created.id}`, { headers: auth.headers })).json() as Count;
  let postKey = "";
  page.on("request", (browserRequest) => {
    if (browserRequest.url().includes(`/api/v1/inventory/counts/${created.id}/post`)) postKey = browserRequest.headers()["idempotency-key"] ?? "";
  });
  await page.getByRole("button", { name: "Post stock count" }).click();
  await expect(page.getByText("POSTED", { exact: true })).toBeVisible();
  expect(postKey).not.toBe("");
  expect(await balance(request, auth.headers, negativeProduct)).toBe(8);
  const negativeMovements = (await movementHistory(request, auth.headers, negativeProduct)).filter((movement) => movement.type === "stock_count");
  expect(negativeMovements).toHaveLength(1);
  expect(negativeMovements[0]).toMatchObject({ qtyDelta: -2, referenceType: "InventoryCount" });
  const replay = await post(request, auth.headers, `/api/v1/inventory/counts/${created.id}/post`, { expectedVersion: approvedBeforePost.version }, postKey);
  expect(replay.response.status()).toBe(200);
  expect(replay.json.replayed).toBe(true);
  expect((await movementHistory(request, auth.headers, negativeProduct)).filter((movement) => movement.type === "stock_count")).toHaveLength(1);

  const zeroProduct = await seedProduct(request, auth.headers, { name: `QA PH18 Zero ${Date.now()}`, priceMinor: 2500, stock: 8 });
  const zero = await createCount(request, auth.headers, zeroProduct, "Zero variance browser API count");
  await progressCount(request, auth.headers, zero, 8);
  expect(await balance(request, auth.headers, zeroProduct)).toBe(8);
  expect((await movementHistory(request, auth.headers, zeroProduct)).filter((movement) => movement.type === "stock_count")).toHaveLength(0);

  const positiveProduct = await seedProduct(request, auth.headers, { name: `QA PH18 Positive ${Date.now()}`, priceMinor: 2500, stock: 8 });
  const positive = await createCount(request, auth.headers, positiveProduct, "Positive variance browser API count");
  await progressCount(request, auth.headers, positive, 10);
  expect(await balance(request, auth.headers, positiveProduct)).toBe(10);
  expect((await movementHistory(request, auth.headers, positiveProduct)).filter((movement) => movement.type === "stock_count")[0]).toMatchObject({ qtyDelta: 2 });

  const staleProduct = await seedProduct(request, auth.headers, { name: `QA PH18 Stale ${Date.now()}`, priceMinor: 2500, stock: 10 });
  const stale = await createCount(request, auth.headers, staleProduct, "Stale browser API count");
  const staleStarted = await post(request, auth.headers, `/api/v1/inventory/counts/${stale.id}/start`, { expectedVersion: stale.version });
  expect(staleStarted.response.ok()).toBe(true);
  const changed = await post(request, auth.headers, "/api/v1/inventory/movements", { productId: staleProduct, type: "adjustment", qtyDelta: -1, reason: "Phase 18 stale fixture" });
  expect(changed.response.status()).toBe(201);
  const staleLine = (staleStarted.json as Count).lines[0]!;
  const stalePatch = await request.patch(`${API}/api/v1/inventory/counts/${stale.id}/lines`, { headers: auth.headers, data: { expectedVersion: (staleStarted.json as Count).version, lines: [{ lineId: staleLine.id, countedQty: 10 }] } });
  expect(stalePatch.ok()).toBe(true);
  const staleSubmit = await post(request, auth.headers, `/api/v1/inventory/counts/${stale.id}/submit`, { expectedVersion: (await stalePatch.json() as Count).version });
  expect(staleSubmit.response.status()).toBe(409);
  expect(staleSubmit.json.error?.code ?? staleSubmit.json.code).toBe("COUNT_STALE");
  expect(await balance(request, auth.headers, staleProduct)).toBe(9);
  expect((await movementHistory(request, auth.headers, staleProduct)).filter((movement) => movement.type === "stock_count")).toHaveLength(0);

  const supplierCreated = await post(request, auth.headers, "/api/v1/suppliers", { name: `QA PH18 Supplier ${Date.now()}`, code: `QA-PH18-${Date.now()}` }, crypto.randomUUID());
  expect(supplierCreated.response.status()).toBe(201);
  const supplierId = supplierCreated.json.supplier.id as string;
  const replenishmentProduct = await post(request, auth.headers, "/api/v1/products", { name: "QA Phase 18 Replenishment Product", sku: `QA-PH18-REPLENISH-${Date.now()}`, costMinor: 1000, priceMinor: 2000, reorderLevel: 5, trackInventory: true, isActive: true });
  expect(replenishmentProduct.response.status()).toBe(201);
  const replenishmentId = replenishmentProduct.json.id as string;
  const stocked = await post(request, auth.headers, "/api/v1/inventory/movements", { productId: replenishmentId, type: "opening_stock", qtyDelta: 2 });
  expect(stocked.response.status()).toBe(201);
  const mapping = await post(request, auth.headers, `/api/v1/suppliers/${supplierId}/products`, { productId: replenishmentId, supplierSku: "QA-PH18-REPLENISH", unitCostMinor: 1000, isPreferred: true });
  expect(mapping.response.ok()).toBe(true);
  const recommendation = await request.get(`${API}/api/v1/inventory/replenishment`, { headers: auth.headers });
  expect(recommendation.ok()).toBe(true);
  const row = (await recommendation.json() as { items: Array<{ productId: string; onHand: number; onOrderQty: number; reorderLevel: number; suggestedQty: number; supplierId: string | null }> }).items.find((item) => item.productId === replenishmentId);
  expect(row).toMatchObject({ onHand: 2, onOrderQty: 0, reorderLevel: 5, suggestedQty: 8, supplierId });
  await page.goto("/inventory/replenishment");
  await expect(page.getByRole("heading", { name: "Replenishment", exact: true })).toBeVisible();
  await expect(page.getByRole("table").getByText("QA Phase 18 Replenishment Product", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select QA Phase 18 Replenishment Product" }).check();
  await page.getByRole("button", { name: "Create draft PO" }).click();
  await expect(page).toHaveURL(/\/purchase-orders\//);
  const poId = page.url().split("/").pop()!;
  const po = await request.get(`${API}/api/v1/purchase-orders/${poId}`, { headers: auth.headers });
  expect(po.ok()).toBe(true);
  expect((await po.json() as { status: string }).status).toBe("DRAFT");
  expect(await balance(request, auth.headers, replenishmentId)).toBe(2);
  const ordered = await post(request, auth.headers, `/api/v1/purchase-orders/${poId}/order`, { expectedVersion: (await po.json() as { version: number }).version }, crypto.randomUUID());
  expect(ordered.response.ok()).toBe(true);
  const suppressed = await request.get(`${API}/api/v1/inventory/replenishment`, { headers: auth.headers });
  expect((await suppressed.json() as { items: Array<{ productId: string }> }).items.some((item) => item.productId === replenishmentId)).toBe(false);
  expect(await balance(request, auth.headers, replenishmentId)).toBe(2);

  const cashierEmail = `phase18-cashier-${Date.now()}@example.com`;
  const membership = await post(request, auth.headers, "/api/v1/memberships", { name: "Phase 18 Cashier", email: cashierEmail, role: "cashier" });
  expect(membership.response.status()).toBe(201);
  const cashierLogin = await request.post(`${API}/api/v1/auth/login`, { data: { email: cashierEmail, password: membership.json.tempPassword } });
  expect(cashierLogin.ok()).toBe(true);
  const cashierBody = await cashierLogin.json() as { csrfToken: string };
  const cashierCookie = cashierLogin.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie").map((header) => header.value.split(";")[0]).join("; ");
  const cashierHeaders: Headers = { Cookie: cashierCookie, "X-CSRF-Token": cashierBody.csrfToken };
  const cashierPost = await post(request, cashierHeaders, `/api/v1/inventory/counts/${stale.id}/post`, { expectedVersion: 1 }, crypto.randomUUID());
  expect(cashierPost.response.status()).toBe(403);
  const cashierDraft = await post(request, cashierHeaders, "/api/v1/inventory/replenishment/draft-po", { branchId: null, supplierId, lines: [{ productId: replenishmentId, quantity: 1 }] }, crypto.randomUUID());
  expect(cashierDraft.response.status()).toBe(403);

  for (const width of [390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/inventory/counts");
    await expect(page.getByRole("heading", { name: "Stock counts", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
