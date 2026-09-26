import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerBusiness, seedProduct } from "./helpers";

test("billing and trial UI stay absent while billing is disabled", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "No Billing Owner",
    email: `no-billing-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `No Billing Store ${stamp}`,
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(/Pro trial/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);

  await page.goto("/platform", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Platform operations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Issue invoice" })).toHaveCount(0);
});

test("billing-disabled businesses are not capped to the old free-plan register limit", async ({ page }) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Uncapped Owner",
    email: `uncapped-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Uncapped Store ${stamp}`,
  });

  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create register" });
  await dialog.getByLabel("Register name").fill("Counter 1");
  await dialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Counter 1")).toBeVisible();

  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create register" });
  await dialog.getByLabel("Register name").fill("Counter 2");
  await dialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText("Counter 2")).toBeVisible();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("the customer display shows the last completed sale", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-display-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerBusiness(page, {
    ownerName: "Display Owner",
    email,
    password,
    businessName: `Display Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  await seedProduct(request, headers, { name: "Display Cola", priceMinor: 2500, stock: 10 });

  const register = await request.post(`${API}/api/v1/registers`, {
    headers,
    data: { name: "Front counter" },
  });
  expect(register.ok()).toBe(true);
  const registerId = ((await register.json()) as { id: string }).id;
  const open = await request.post(`${API}/api/v1/registers/${registerId}/open`, {
    headers,
    data: { registerId, openingFloatMinor: 0 },
  });
  expect(open.ok()).toBe(true);

  const products = await request.get(`${API}/api/v1/products?page=1&pageSize=1`, { headers });
  expect(products.ok()).toBe(true);
  const productId = ((await products.json()) as { items: Array<{ id: string }> }).items[0]!.id;
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }], registerId },
  });
  expect(draft.ok()).toBe(true);
  const draftBody = (await draft.json()) as { id: string; totalMinor: number };
  const done = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `display-sale-${stamp}` },
    data: { saleId: draftBody.id, registerId, payments: [{ method: "cash", amountMinor: draftBody.totalMinor }] },
  });
  expect(done.ok()).toBe(true);
  const receiptNo = ((await done.json()) as { receiptNo: string }).receiptNo;

  const token = await request.post(`${API}/api/v1/display/tokens`, {
    headers,
    data: { registerId },
  });
  expect(token.ok()).toBe(true);
  const displayToken = ((await token.json()) as { token: string }).token;

  await page.goto(`/display?registerId=${registerId}&token=${encodeURIComponent(displayToken)}`);
  await expect(page.getByRole("heading", { name: `Display Store ${stamp}` })).toBeVisible();
  await expect(page.getByText(`Last sale ${receiptNo}: 25.00`)).toBeVisible();
});
