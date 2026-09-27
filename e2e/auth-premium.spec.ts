import { expect, test } from "@playwright/test";
import { API } from "./helpers";

test("password recovery is discoverable from login", async ({ page }) => {
  await page.goto("/login");

  const recovery = page.getByRole("link", { name: "Forgot password?" });
  await expect(recovery).toBeVisible();
  await recovery.click();

  await expect(page).toHaveURL("/password-reset");
  await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

test("privacy-first login signs into the real business without exposing metrics before auth", async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const email = `e2e-login-${testInfo.project.name}-${stamp}@example.com`;
  const password = "correct-horse-12";
  const businessName = "Login E2E Store " + stamp;

  const registered = await request.post(API + "/api/v1/auth/register", {
    data: {
      ownerName: "Login E2E Owner",
      email,
      password,
      businessName,
    },
  });
  expect(registered.ok()).toBe(true);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("Private workspace")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("₱");
  await expect(page.locator("body")).not.toContainText(businessName);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();

  await expect(page).toHaveURL("/", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) >= 1280) {
    await expect(page.getByRole("banner").getByText(businessName)).toBeVisible();
  } else {
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Dashboard" })).toBeVisible();
  }
});
