import { expect, test } from "@playwright/test";
import { registerBusiness, apiAuthedContext, seedProduct } from "./helpers";

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
  await seedProduct(request, headers, { name: "Unknown Cola", priceMinor: 2500, stock: 10 });

  await page.goto("/pos");
  await page.getByLabel("Search product, SKU or scan barcode").fill("Unknown Cola");
  await page.getByRole("button", { name: /Unknown Cola ₱25\.00/ }).click();
  const tabletPos = (page.viewportSize()?.width ?? 1440) < 1280;

  await page.route("**/api/v1/sales/complete", async (route) => {
    const req = route.request();
    const body = req.postDataJSON() as {
      saleId: string;
      payments: Array<{ method: string; amountMinor: number; providerRef?: string }>;
      registerId?: string;
    };
    const modified = {
      ...body,
      payments: body.payments.map((payment, index) =>
        index === 0 ? { ...payment, providerRef: "unknown-e2e-" + stamp } : payment,
      ),
    };
    const response = await route.fetch({
      method: req.method(),
      headers: { ...req.headers(), "content-type": "application/json" },
      postData: JSON.stringify(modified),
    });
    await route.fulfill({ response });
  });

  if (tabletPos) {
    await page.getByRole("region", { name: "Tablet cart" }).getByRole("button", { name: "Pay", exact: true }).click();
  } else {
    await page.getByRole("button", { name: /Pay ₱25\.00/ }).click();
  }
  await page.getByRole("button", { name: "GCash" }).click();
  await page.getByRole("button", { name: "Complete Payment" }).click();

  const unknownStatus = tabletPos
    ? page.getByRole("region", { name: "Tablet payment status" })
    : page.getByRole("complementary", { name: "Cart" });
  await expect(unknownStatus.getByText(/Payment status unknown\. Do not retry blindly/)).toBeVisible();
  await expect(page.getByText("Sale completed.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);
  if (tabletPos) {
    await expect(page.getByRole("region", { name: "Tablet cart" }).getByText("1 item in cart", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Cart (1)" })).toBeVisible();
  }

  await unknownStatus.getByRole("link", { name: "Review unknown payment" }).click();
  await expect(page).toHaveURL(/\/sales\/[^/]+$/, { timeout: 60_000 });
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
