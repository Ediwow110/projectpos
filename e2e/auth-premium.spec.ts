import { expect, test } from "@playwright/test";
import { API } from "./helpers";

test("privacy-first login signs into the real business without exposing metrics before auth", async ({ page, request }) => {
  const stamp = Date.now();
  const email = "e2e-login-" + stamp + "@example.com";
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
