import { expect, test } from "@playwright/test";
import {
  apiAuthedContext,
  clickPosPay,
  confirmPosQuantity,
  posCartRegion,
  registerOperationalBusiness,
  seedProduct,
} from "./helpers";

async function openPaymentForProduct(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  name: string,
): Promise<{ email: string; headers: Record<string, string> }> {
  const stamp = Date.now();
  const email = `pos01-${stamp}@example.com`;
  await registerOperationalBusiness(page, {
    ownerName: "POS01 Failure QA",
    email,
    password: "correct-horse-12",
    businessName: `POS01 Failure Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, "correct-horse-12", page);
  await seedProduct(request, headers, { name, priceMinor: 2500, stock: 10 });
  await page.goto("/pos");
  await page.getByRole("button", { name: new RegExp(name + " ₱25\\.00") }).click();
  await confirmPosQuantity(page);
  await clickPosPay(page, "25.00");
  return { email, headers };
}

test("a stock failure is spoken inside the open payment dialog and double-submit is blocked", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openPaymentForProduct(page, request, "POS01 Stock Cola");

  let completes = 0;
  await page.route("**/api/v1/sales/complete", async (route) => {
    completes += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INSUFFICIENT_STOCK",
        message: "Not enough stock.",
        correlationId: "e2e-pos01-stock",
      }),
    });
  });

  const dialog = page.getByRole("dialog", { name: "Payment", exact: true });
  const pay = dialog.getByRole("button", { name: "Complete Payment" });
  // Two synchronous activations simulate the pre-render double-Enter race.
  await pay.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });

  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("Not enough stock");
  await expect(alert).not.toContainText("INSUFFICIENT_STOCK");
  await expect(alert).toHaveAttribute("data-failure-kind", "stock");
  await expect(alert.getByRole("link", { name: "Check sale status" })).toHaveCount(0);
  expect(completes).toBe(1);
  // Cart status stays suppressed while the dialog owns the transaction.
  await expect(page.getByRole("status").filter({ hasText: "Not enough stock" })).toHaveCount(0);

  await page.keyboard.press("Tab");
  const adjust = alert.getByRole("button", { name: "Back to sale to adjust" });
  await expect(adjust).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(posCartRegion(page).getByRole("button", { name: /Pay/ }).first()).toBeFocused();
});

test("a 500 after submit blocks blind retry and links to the sale record", async ({ page, request }) => {
  test.setTimeout(180_000);
  await openPaymentForProduct(page, request, "POS01 Unknown Cola");

  await page.route("**/api/v1/sales/complete", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "HTTP_ERROR",
        message: "Request failed.",
        correlationId: "e2e-pos01-unknown",
      }),
    });
  });

  const draftResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return path.endsWith("/api/v1/sales/drafts") && response.request().method() === "POST";
  });
  const dialog = page.getByRole("dialog", { name: "Payment", exact: true });
  await dialog.getByRole("button", { name: "Complete Payment" }).click();
  const draft = await (await draftResponse).json() as { id: string };

  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toBeFocused();
  await expect(alert).toHaveAttribute("data-failure-kind", "unknown_outcome");
  await expect(alert).toContainText("Payment status unknown");
  await expect(alert).toContainText("Do not retry payment");
  await expect(alert).not.toContainText("HTTP_ERROR");
  await expect(alert.getByRole("link", { name: "Check sale status" })).toHaveAttribute(
    "href",
    `/sales/${draft.id}`,
  );

  const pay = dialog.getByRole("button", { name: "Complete Payment" });
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveAttribute("aria-describedby", "payment-failure-atlas");
  // No duplicate primary error behind the open dialog.
  await expect(page.getByRole("status").filter({ hasText: "Payment status unknown" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Payment complete" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View receipt" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Payment not yet confirmed" })).toBeVisible();
});
