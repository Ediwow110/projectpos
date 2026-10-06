import { expect, test } from "@playwright/test";

import { registerOperationalBusiness } from "./helpers";

test("owner creates and deactivates a cashier while temporary credentials are display-once", async ({ page }) => {
  const ownerPassword = "correct-horse-12";
  await registerOperationalBusiness(page, {
    ownerName: "Team Owner",
    email: "team-owner@example.com",
    password: ownerPassword,
    businessName: "Team Management Store",
  });

  await page.goto("/team");

  const ownerRow = page.getByRole("row").filter({ hasText: "Team Owner" });
  await ownerRow.getByRole("button", { name: "Set approval PIN" }).click();
  const pinDialog = page.getByRole("dialog", { name: "Set approval PIN" });
  await pinDialog.getByLabel("Six-digit approval PIN").fill("482615");
  await pinDialog.getByLabel("Confirm approval PIN").fill("482615");
  await pinDialog.getByRole("button", { name: "Set PIN", exact: true }).click();
  await expect(pinDialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("approval PIN was enrolled");
  await expect(ownerRow.getByRole("button", { name: "Rotate approval PIN" })).toBeVisible();

  await page.getByRole("button", { name: "+ Add team member" }).click();

  const cashierEmail = `team-cashier-${process.env.TEST_WORKER_INDEX ?? "w"}-${Date.now()}@example.com`;
  await page.getByLabel("Name").fill("Team Cashier");
  await page.getByLabel("Email").fill(cashierEmail);
  await page.getByLabel("Role").selectOption("cashier");
  await page.getByRole("button", { name: "Create team member" }).click();

  const credentialDialog = page.getByRole("dialog", { name: "Temporary password" });
  await expect(credentialDialog).toBeVisible();
  const passwordValue = credentialDialog.locator('[data-ui="temporary-password-value"]');
  const tempPassword = (await passwordValue.textContent())?.trim() ?? "";
  expect(tempPassword.length).toBeGreaterThan(0);
  await expect(credentialDialog.getByRole("button", { name: "Copy temporary password" })).toBeVisible();
  await credentialDialog.getByRole("button", { name: "Close temporary password" }).click();
  await expect(credentialDialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("dialog", { name: "Temporary password" })).toHaveCount(0);
  await expect(page.locator('[data-ui="temporary-password-value"]')).toHaveCount(0);

  const memberRow = page.getByRole("row").filter({ hasText: cashierEmail });
  await expect(memberRow).toBeVisible();
  await memberRow.getByRole("button", { name: "Deactivate" }).click();
  const confirm = page.getByRole("dialog", { name: "Deactivate team member?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Deactivate" }).click();
  await expect(memberRow).toBeVisible();
  await expect(memberRow).toContainText("Deactivated");
  await expect(memberRow.getByRole("button", { name: "Reactivate" })).toBeVisible();

  // Create a second cashier to verify lower-role direct access without reusing
  // the deactivated credentials.
  await page.getByRole("button", { name: "+ Add team member" }).click();
  const restrictedEmail = `team-restricted-${process.env.TEST_WORKER_INDEX ?? "w"}-${Date.now()}@example.com`;
  await page.getByLabel("Name").fill("Restricted Cashier");
  await page.getByLabel("Email").fill(restrictedEmail);
  await page.getByLabel("Role").selectOption("cashier");
  await page.getByRole("button", { name: "Create team member" }).click();
  const restrictedDialog = page.getByRole("dialog", { name: "Temporary password" });
  await expect(restrictedDialog).toBeVisible();
  const restrictedPassword = ((await restrictedDialog.locator('[data-ui="temporary-password-value"]').textContent()) ?? "").trim();
  expect(restrictedPassword.length).toBeGreaterThan(0);
  await restrictedDialog.getByRole("button", { name: "Close temporary password" }).click();
  await expect(restrictedDialog).toBeHidden();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(restrictedEmail);
  await page.getByLabel("Password").fill(restrictedPassword);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible({ timeout: 30_000 });
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();

  await page.goto("/team");
  await expect(page.getByText("Owner access required", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add team member" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
});
