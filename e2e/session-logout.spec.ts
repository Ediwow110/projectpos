import { expect, test } from "@playwright/test";
import { API, registerOperationalBusiness } from "./helpers";

test("sign-out revokes the original session and blocks protected pages", async ({ page, request }) => {
  test.setTimeout(150_000);

  await registerOperationalBusiness(page, {
    ownerName: "Logout E2E Owner",
    email: `logout-e2e-${Date.now()}@example.com`,
    password: "correct-horse-12",
    businessName: "Logout E2E Store",
  });

  const session = (await page.context().cookies(API)).find((cookie) => cookie.name === "pos_session");
  expect(session?.value, "an authenticated session cookie exists").toBeTruthy();
  const originalCookie = `pos_session=${session!.value}`;
  const before = await request.get(`${API}/api/v1/me`, { headers: { Cookie: originalCookie } });
  expect(before.status()).toBe(200);

  await page.goto("/sales");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  // A client-side redirect alone is insufficient: the server must reject
  // the original cookie even when it is replayed after logout.
  const replay = await request.get(`${API}/api/v1/me`, { headers: { Cookie: originalCookie } });
  expect([401, 403], `revoked session was accepted with HTTP ${replay.status()}`).toContain(replay.status());

  await page.goto("/sales");
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
});
