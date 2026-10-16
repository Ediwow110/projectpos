import { expect, test } from "@playwright/test";

test("Atlas V4 login keeps secure sign-in and mobile layout usable", async ({ page }) => {
  await page.goto("/login");
  const entry = page.locator('[data-ui="atlas-v4-login"]');
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(entry.getByRole("link", { name: "NexPOS home" })).toBeVisible();
  await expect(entry.getByLabel("Email")).toBeVisible();
  await expect(entry.getByLabel("Password")).toBeVisible();
  await expect(entry.getByRole("button", { name: "Sign in securely" })).toBeVisible();
  await expect(entry).toHaveCSS("background-color", "rgb(247, 248, 245)");
  await expect(entry.getByRole("button", { name: "Sign in securely" })).toHaveCSS("background-color", "rgb(41, 51, 45)");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThan(3);
  await entry.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL("/register");
});

test("Atlas V4 registration keeps actual owner form and privacy checks", async ({ page }) => {
  await page.goto("/register");
  const entry = page.locator('[data-ui="atlas-v4-register"]');
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("heading", { name: "Create your business" })).toBeVisible();
  await expect(entry).toHaveCSS("background-color", "rgb(247, 248, 245)");
  await expect(entry.getByLabel("Your name")).toBeVisible();
  await expect(entry.getByLabel("Business name")).toBeVisible();
  await expect(entry.getByLabel("Email")).toBeVisible();
  await expect(entry.getByRole("button", { name: "Create business" })).toHaveCSS("background-color", "rgb(41, 51, 45)");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThan(3);
  await entry.getByRole("button", { name: "Create business" }).click();
  await expect(entry.getByRole("alert")).toContainText("VALIDATION");
});
