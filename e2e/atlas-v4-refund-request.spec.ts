import { expect, test } from "@playwright/test";
import {
  API,
  apiAuthedContext,
  completePosSale,
  createCounterWithOpenShift,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

test("Atlas V4 refund request stays accessible and does not mutate the original sale on cancel", async ({ page, request }) => {
  test.setTimeout(150_000);
  const email = await registerOperationalBusiness(page, {
    ownerName: "Refund Flow QA",
    email: `refund-flow-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Refund Flow QA Store",
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name: "Refund QA Milk", priceMinor: 2500, stock: 5 });
  await createCounterWithOpenShift(page, "Refund QA Counter");
  const saleId = await completePosSale(page, request, headers, {
    productName: "Refund QA Milk",
    productPriceLabel: "25.00",
    register: "Refund QA Counter",
    payAmount: "25.00",
  });

  await page.goto(`/sales/${saleId}`);
  await page.getByRole("button", { name: "Request refund" }).click();
  const dialog = page.getByRole("dialog", { name: "Request refund" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-ui", "atlas-flow-modal");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  if ((page.viewportSize()?.width ?? 0) >= 600) {
    expect((await dialog.boundingBox())?.width).toBeCloseTo(535, 0);
  }
  const submit = dialog.getByRole("button", { name: "Submit request" });
  await expect(submit).toBeDisabled();
  await dialog.getByPlaceholder("Reason for this refund decision").fill("Item delivered with damaged seal");
  await expect(submit).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  const saleResponse = await request.get(`${API}/api/v1/sales/${saleId}`, { headers });
  expect(saleResponse.ok()).toBe(true);
  const sale = await saleResponse.json() as { status: string; refunds: unknown[] };
  expect(sale.status).toBe("COMPLETED");
  expect(sale.refunds).toHaveLength(0);
});
