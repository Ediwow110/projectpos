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

test("privacy-first login routes a new business into onboarding without exposing metrics before auth", async ({ page, request }, testInfo) => {
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

  await expect(page).toHaveURL("/onboarding", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
});

test("successful email verification returns to a fresh sign-in state", async ({ page }) => {
  await page.route("**/api/v1/auth/verify-email/challenge", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
  });
  await page.route("**/api/v1/auth/verify-email", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verified: true }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/verify-email?token=test-verification-token");
  await expect(page.getByText("Email verified. Redirecting you to secure sign in…")).toBeVisible();
  await expect(page).toHaveURL("/login?verified=1", { timeout: 10_000 });
  await expect(page.getByRole("status")).toContainText("Email verified");
});
