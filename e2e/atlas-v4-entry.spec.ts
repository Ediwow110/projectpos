import { expect, test } from "@playwright/test";

test("Atlas V4 desktop sign-in aligns its fields and action with the Figma reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");

  const designY = async (locator: ReturnType<typeof page.locator>, expected: number): Promise<void> => {
    const bounds = await locator.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.y - expected)).toBeLessThanOrEqual(16);
  };

  await designY(page.getByText("Security and simplicity for every shift."), 421);
  await designY(page.getByPlaceholder("you@business.com"), 372);
  await designY(page.getByPlaceholder("Enter password"), 476);
  await designY(page.getByRole("button", { name: "Sign in securely" }), 653);

  const identity = page.locator('[data-ui="atlas-v4-auth-identity"]');
  await expect(identity).not.toContainText("Retail operations");
  const receiptCaption = await identity.getByText("Your business. Your team. Your customers.").boundingBox();
  expect(receiptCaption?.height).toBeGreaterThan(30);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Sign in securely" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});

test("Atlas V4 login keeps secure sign-in and mobile layout usable", async ({ page }) => {
  await page.goto("/login");
  const entry = page.locator('[data-ui="atlas-v4-login"]');
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("heading", { name: "Sign in to NexPOS" })).toBeVisible();
  await expect(entry.getByRole("link", { name: "NexPOS home" })).toBeVisible();
  await expect(entry.getByLabel("Email")).toBeVisible();
  await expect(entry.getByLabel("Password")).toBeVisible();
  await expect(entry.getByRole("button", { name: "Sign in securely" })).toBeVisible();
  await expect(entry).toHaveCSS("background-color", "rgb(247, 248, 245)");
  await expect(entry.getByRole("button", { name: "Sign in securely" })).toHaveCSS("background-color", "rgb(32, 40, 38)");
  if (page.viewportSize()?.width === 1440) {
    // The auth card enters with a 0.55s scale/translate animation. Sampling
    // mid-flight makes the geometry platform/timing dependent; settle the
    // animation and assert the design anchor (82px inset from the 535px
    // identity column's right edge) with a bounded tolerance instead of a
    // fragile absolute pixel.
    await entry.locator(".animate-auth-card").evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const identity = await entry.locator('[data-ui="atlas-v4-auth-identity"]').boundingBox();
    const email = await entry.getByLabel("Email address").boundingBox();
    expect(identity).not.toBeNull();
    expect(email).not.toBeNull();
    expect(identity!.width).toBeCloseTo(535, 0);
    expect(Math.abs(email!.x - (identity!.x + identity!.width) - 82)).toBeLessThanOrEqual(1);
  }
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
  await expect(entry.getByRole("button", { name: "Create business" })).toHaveCSS("background-color", "rgb(32, 40, 38)");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThan(3);
  await entry.getByRole("button", { name: "Create business" }).click();
  await expect(entry.getByRole("alert")).toContainText("VALIDATION");
});
