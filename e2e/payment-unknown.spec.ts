import { expect, test } from "@playwright/test";
import { API, registerBusiness, apiAuthedContext, seedProduct } from "./helpers";

test("unknown provider outcome stays visibly unresolved and blocks false success", async ({ page, request }) => {
  const stamp = Date.now();
  const email = "e2e-unknown-" + stamp + "@example.com";
  const password = "correct-horse-12";

  await registerBusiness(page, {
    ownerName: "Unknown Payment Owner",
    email,
    password,
    businessName: "Unknown Payment Store",
  });

  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, { name: "Unknown Cola", priceMinor: 2500, stock: 10 });

  await page.goto("/pos");
  await page.getByLabel("Search product, SKU or scan barcode").fill("Unknown Cola");
  await page.getByRole("button", { name: /Unknown Cola ₱25\.00/ }).click();
  const tabletPos = (page.viewportSize()?.width ?? 1440) < 1280;

  if (tabletPos) {
    await page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "Pay", exact: true }).click();
  } else {
    await page.getByRole("button", { name: /Pay ₱25\.00/ }).click();
  }
  await expect(page.getByRole("button", { name: "GCash", exact: true })).toBeDisabled();

  // PAYMENT_UNKNOWN remains available as a privileged recovery path for
  // genuinely uncertain legacy/manual provider outcomes, but normal POS
  // Card/GCash/Maya/QR Ph now goes through PayMongo Hosted Checkout instead.
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draft.ok()).toBe(true);
  const draftBody = await draft.json() as { id: string; totalMinor: number };
  const unknown = await request.post(`${API}/api/v1/sales/complete`, {
    headers: { ...headers, "Idempotency-Key": `unknown-e2e-${stamp}` },
    data: {
      saleId: draftBody.id,
      payments: [{ method: "gcash", amountMinor: draftBody.totalMinor, providerRef: `unknown-e2e-${stamp}` }],
    },
  });
  expect(unknown.status()).toBe(202);

  await page.goto(`/sales/${draftBody.id}`);
  await expect(page.getByRole("heading", { name: "Payment outcome is unknown" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Sale summary" }).getByText("PAYMENT_UNKNOWN", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark succeeded", exact: true }).click();
  const reconcileDialog = page.getByRole("dialog", { name: "Mark payment as succeeded?" });
  await expect(reconcileDialog).toContainText("Confirm the outcome from the payment provider or settlement records");
  await reconcileDialog.getByRole("button", { name: "Confirm succeeded", exact: true }).click();
  await expect(page.getByText("Payment reconciled as succeeded.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sale summary" }).getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View receipt" })).toBeVisible();
});
