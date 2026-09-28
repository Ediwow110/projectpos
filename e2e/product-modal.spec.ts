import { expect, test } from "@playwright/test";
import { registerOperationalBusiness } from "./helpers";

test("product creation uses an in-workspace modal and deep link stays safe", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await registerOperationalBusiness(page, {
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

  await page.getByRole("button", { name: /Import CSV/ }).click();
  const importDialog = page.getByRole("dialog", { name: "Import products from CSV" });
  await importDialog.getByLabel("CSV content").fill(
    `name,sku,price,cost,reorder_level,track_inventory\nImported Tea ${stamp},TEA-${stamp},89.00,35.00,3,true`,
  );
  await importDialog.getByRole("button", { name: "Import products", exact: true }).click();
  await expect(importDialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("1 product imported.");
  await expect(page.getByRole("link", { name: `Imported Tea ${stamp}`, exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export current page/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^nexpos-products-page-1\.csv$/);
});
