import { expect, test } from "@playwright/test";

import { createCounterWithOpenShift, registerOperationalBusiness } from "./helpers";

test("a register can issue a customer display link that the display page consumes", async ({ page, context }) => {
  await registerOperationalBusiness(page, {
    ownerName: "Display Owner",
    email: "display-owner@example.com",
    password: "correct-horse-12",
    businessName: "Display Store",
  });
  await createCounterWithOpenShift(page, "Display Till");

  await page.goto("/registers");
  const row = page.getByRole("row").filter({ hasText: "Display Till" });
  await expect(row.getByRole("button", { name: "Customer display" })).toBeVisible();
  await row.getByRole("button", { name: "Customer display" }).click();

  const dialog = page.getByRole("dialog", { name: "Customer display link" });
  await expect(dialog).toBeVisible();
  const link = await dialog.locator('[data-ui="display-link"]').inputValue();
  expect(link).toContain("/display?registerId=");
  expect(link).toMatch(/token=[0-9a-f]{64}/);
  await expect(dialog).toContainText("15 minutes");

  const display = await context.newPage();
  await display.goto(link);
  await expect(display.getByRole("heading", { name: "Display Store" })).toBeVisible();
  await expect(display.getByText("Shift: OPEN")).toBeVisible();
  await expect(display.getByRole("alert")).toHaveCount(0);

  // Closing the dialog must drop the token, not leave it re-renderable.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator('[data-ui="display-link"]')).toHaveCount(0);
  await display.close();
});
