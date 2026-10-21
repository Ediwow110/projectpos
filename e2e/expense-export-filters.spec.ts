import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

test("the expenses CSV follows the filter on the screen", async ({ page, request }) => {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Expenses Owner",
    email: "expenses-export-owner@example.com",
    password,
    businessName: "Ledger Store",
  });
  const auth = await apiAuthedContext(request, email, password, page);

  for (const expense of [
    { category: "Rent", amountMinor: 125000, method: "cash", description: "Studio rent" },
    { category: "Utilities", amountMinor: 4500, method: "cash", description: "Power bill" },
  ]) {
    const created = await request.post(`${API}/api/v1/expenses`, { headers: auth.headers, data: expense });
    expect(created.status(), expense.category).toBe(201);
  }

  await page.goto("/expenses");
  await page.getByPlaceholder("Ice, transport…").fill("Rent");
  await expect(page.getByRole("row").filter({ hasText: "Studio rent" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Power bill" })).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const csv = readFileSync(await download.path(), "utf8");

  expect(csv).toContain(",Rent,");
  expect(csv).not.toContain("Utilities");
  expect(csv).not.toContain("truncated");
});
