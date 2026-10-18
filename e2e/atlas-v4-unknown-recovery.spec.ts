import { expect, test } from "@playwright/test";
import {
  apiAuthedContext,
  clickPosPay,
  confirmPosQuantity,
  createCounterWithOpenShift,
  registerOperationalBusiness,
  seedProduct,
  selectPosRegister,
} from "./helpers";

test("Atlas V4 POS unknown response exposes evidence review but no final receipt or second payment", async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = await registerOperationalBusiness(page, {
    ownerName: "Unknown Recovery QA",
    email: `recovery-qa-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Unknown Recovery QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Recovery Milk", priceMinor: 2500, stock: 5 });
  await createCounterWithOpenShift(page, "Recovery QA Counter");
  await page.goto("/pos");
  await selectPosRegister(page, "Recovery QA Counter");
  await page.getByRole("button", { name: /Recovery Milk ₱25\.00/ }).click();
  await confirmPosQuantity(page);
  await clickPosPay(page, "25.00");

  // Simulate an ambiguous completion response at the network boundary.
  // No second charge, settlement, or final receipt is created by the mock.
  let unresolvedSaleId: string | null = null;
  await page.route("**/api/v1/sales/complete", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { saleId?: string };
    unresolvedSaleId = body.saleId ?? null;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        sale: { id: unresolvedSaleId, status: "PAYMENT_UNKNOWN", payments: [] },
      }),
    });
  });
  await page.getByRole("button", { name: "Complete Payment" }).click();
  const unknown = page.getByRole("dialog", { name: "Payment not yet confirmed" });
  await expect(unknown).toBeVisible();
  await expect(unknown).toHaveAttribute("data-ui", "atlas-flow-modal");
  await expect(unknown.getByText("Never charge again without checking evidence.")).toBeVisible();
  await expect(unknown.getByText("Status: UNKNOWN")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Payment complete" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);

  await unknown.getByRole("button", { name: "Close", exact: true }).click();
  await expect(unknown).toBeHidden();
  const cart = (page.viewportSize()?.width ?? 1440) >= 1280
    ? page.getByRole("complementary", { name: "Cart" })
    : page.getByRole("region", { name: "Tablet payment status" });
  if ((page.viewportSize()?.width ?? 1440) >= 1280) {
    await expect(cart.getByRole("button", { name: /Pay ₱25\.00/ })).toBeDisabled();
  }
  const recoveryLink = cart.getByRole("link", { name: "Review unknown payment" });
  await expect(recoveryLink).toBeVisible();
  await recoveryLink.click();
  expect(unresolvedSaleId).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/sales/${unresolvedSaleId}$`));
});
