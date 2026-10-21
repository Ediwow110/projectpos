import { expect, test } from "@playwright/test";

import { API, apiAuthedContext, registerOperationalBusiness, signOut } from "./helpers";

test("a member of two businesses can see both roles and switch the workspace", async ({ page, request }) => {
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Chain Owner",
    email: "chain-owner@example.com",
    password,
    businessName: "Anchor Store",
  });
  const ownerAuth = await apiAuthedContext(request, ownerEmail, password);

  await signOut(page);
  const memberEmail = await registerOperationalBusiness(page, {
    ownerName: "Chain Member",
    email: "chain-member@example.com",
    password,
    businessName: "Home Store",
  });

  const invite = await request.post(`${API}/api/v1/memberships`, {
    headers: ownerAuth.headers,
    data: { email: memberEmail, name: "Chain Member", role: "cashier" },
  });
  expect(invite.status(), await invite.text()).toBe(201);

  const anchorMe = await request.get(`${API}/api/v1/me`, { headers: ownerAuth.headers });
  expect(anchorMe.ok()).toBe(true);
  const anchorBusinessId = ((await anchorMe.json()) as { businessId: string }).businessId;

  await page.goto("/businesses");
  const anchorRow = page.getByRole("listitem").filter({ hasText: "Anchor Store" });
  await expect(anchorRow).toContainText("cashier");
  await expect(page.getByRole("listitem").filter({ hasText: "Home Store" })).toContainText("Current workspace");

  await anchorRow.locator('[data-ui^="switch-"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });

  const switched = await request.get(`${API}/api/v1/me`, {
    headers: { Cookie: (await page.context().cookies(API)).map((c) => `${c.name}=${c.value}`).join("; ") },
  });
  expect(((await switched.json()) as { businessId: string }).businessId).toBe(anchorBusinessId);
});
