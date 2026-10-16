import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

test("canceled hosted-checkout return stays pending and never reports payment success", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `paymongo-return-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerOperationalBusiness(page, {
    ownerName: "Checkout Return Owner",
    email,
    password,
    businessName: `Checkout Return Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, {
    name: `Return Test Product ${stamp}`,
    priceMinor: 2500,
    stock: 5,
  });
  const draftResponse = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draftResponse.ok()).toBe(true);
  const draft = await draftResponse.json() as { id: string; status: string };
  const detailResponse = await request.get(`${API}/api/v1/sales/${draft.id}`, { headers });
  expect(detailResponse.ok()).toBe(true);

  // The local E2E API has no PayMongo credentials. Simulate only the provider-backed
  // pending detail returned after checkout; keep all identity and page calls real.
  await page.route(`**/api/v1/sales/${draft.id}`, async (route) => {
    const response = await route.fetch();
    const sale = await response.json() as Record<string, unknown>;
    const totalMinor = sale["totalMinor"] as number;
    await route.fulfill({
      response,
      body: JSON.stringify({
        ...sale,
        status: "PENDING_PAYMENT",
        payments: [{ id: "fixture-pending-payment", method: "gcash", amountMinor: totalMinor, status: "PENDING" }],
      }),
    });
  });

  await page.goto(`/sales/${draft.id}?paymongo=cancelled`);
  await expect(page.getByRole("heading", { name: "Waiting for PayMongo payment" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Checkout returned as canceled or closed");
  await expect(page.getByRole("status")).toContainText("still pending in NexPOS");
  await expect(page.getByRole("status")).toContainText("does not confirm that a charge failed");
  await expect(page.getByRole("region", { name: "Sale summary" }).getByText("PENDING_PAYMENT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);

  const persisted = await request.get(`${API}/api/v1/sales/${draft.id}`, { headers });
  expect(persisted.ok()).toBe(true);
  expect((await persisted.json() as { status: string }).status).toBe(draft.status);

  // A provider "success" URL can be opened directly or replayed. It is not
  // signed settlement evidence and must not finalize the local sale.
  await page.goto(`/sales/${draft.id}?paymongo=success`);
  await expect(page.getByRole("heading", { name: "Waiting for PayMongo payment" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("the redirect does not confirm payment");
  await expect(page.getByRole("region", { name: "Sale summary" })
    .getByText("PENDING_PAYMENT", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);
  const afterRedirect = await request.get(`${API}/api/v1/sales/${draft.id}`, { headers });
  expect(afterRedirect.ok()).toBe(true);
  expect((await afterRedirect.json() as { status: string }).status).toBe(draft.status);
});
