import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness } from "./helpers";

test("device fleet enrolls, revokes, and signs out a device-bound current session", async ({ page, request }) => {
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Device Owner",
    email: "device-owner@example.com",
    password,
    businessName: "Device Fleet Store",
  });
  const auth = await apiAuthedContext(request, email, password, page);

  await page.goto("/devices");
  await expect(page.getByRole("heading", { name: "Device Fleet" })).toBeVisible();
  await page.getByLabel("Device label").fill("Front Till");
  await page.getByRole("button", { name: "Register this device" }).click();
  const frontRow = page.getByRole("row").filter({ hasText: "Front Till" });
  await expect(frontRow).toContainText("Active");
  await expect(frontRow).toContainText("This device");

  const currentDeviceId = await page.evaluate(() => window.localStorage.getItem("pos-device-id"));
  expect(currentDeviceId).toBeTruthy();

  const back = await request.post(`${API}/api/v1/devices`, {
    headers: auth.headers,
    data: { label: "Back Office" },
  });
  expect(back.ok()).toBe(true);
  await page.reload();

  const backRow = page.getByRole("row").filter({ hasText: "Back Office" });
  await expect(backRow).toContainText("Active");
  await backRow.getByRole("button", { name: "Revoke Back Office" }).click();
  await expect(page.getByRole("dialog", { name: "Revoke device?" })).toContainText(
    "If this is the current device, you may need to sign in again.",
  );
  await page.getByRole("dialog", { name: "Revoke device?" }).getByRole("button", { name: "Revoke device" }).click();
  await expect(backRow).toContainText("Revoked");
  await expect(page).toHaveURL(/\/devices$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  await page.goto("/devices");
  const frontAfterLogin = page.getByRole("row").filter({ hasText: "Front Till" });
  await expect(frontAfterLogin).toContainText("This device");
  await frontAfterLogin.getByRole("button", { name: "Revoke Front Till" }).click();
  await page.getByRole("dialog", { name: "Revoke device?" }).getByRole("button", { name: "Revoke device" }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pos-device-id"))).toBeNull();
});
