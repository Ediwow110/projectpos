import { expect, test } from "@playwright/test";
import { registerBusiness } from "./helpers";

test("product creation uses an in-workspace modal and deep link stays safe", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await registerBusiness(page, {
    ownerName: "Catalog Owner",
    email: `product-modal-${testInfo.project.name}-${stamp}@example.com`,
    password: "correct-horse-12",
    businessName: `Catalog Store ${stamp}`,
  });

  await page.goto("/products/new");
  await expect(page).toHaveURL(/\/products\?create=1$/);

  const dialog = page.getByRole("dialog", { name: "Add product" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Product name").fill(`Modal Coffee ${stamp}`);
  await dialog.getByLabel("SKU").fill(`MODAL-${stamp}`);
  await dialog.getByLabel("Selling price (PHP)").fill("149.50");
  await dialog.getByLabel("Cost (PHP)").fill("70.25");
  await dialog.getByLabel("Reorder level").fill("5");
  await dialog.getByRole("button", { name: "Add product", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("status")).toContainText(`Modal Coffee ${stamp} was added to the catalog.`);
  await expect(page.getByRole("link", { name: `Modal Coffee ${stamp}`, exact: true })).toBeVisible();

  await page.getByRole("button", { name: "+ Add product", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add product" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add product" })).toBeHidden();
});
