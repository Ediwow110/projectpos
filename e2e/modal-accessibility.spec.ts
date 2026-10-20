import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, registerOperationalBusiness, seedProduct } from "./helpers";

test("workspace skip link moves keyboard focus to the main landmark", async ({ page }) => {
  const stamp = Date.now();
  const email = `skip-link-${stamp}@example.com`;
  await registerOperationalBusiness(page, {
    ownerName: "Skip Link Owner",
    email,
    password: "correct-horse-12",
    businessName: `Skip Link Store ${stamp}`,
  });
  await page.goto("/customer-concerns");
  await expect(page.getByRole("heading", { name: /Customer case (inbox|history)/ })).toBeVisible();

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  // Next.js client navigation may restore focus to the last active control.
  // Verify the skip link is reachable by keyboard without assuming it
  // always receives the first Tab after a route transition.
  for (let step = 0; step < 80; step += 1) {
    if (await skipLink.evaluate((link) => link === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  const main = page.getByRole("main");
  await expect(main).toHaveAttribute("id", "main-content");
  await expect(main).toBeFocused();
});

test("void confirmation traps keyboard focus and restores it on Escape without mutation", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `modal-access-${stamp}@example.com`;
  const password = "correct-horse-12";
  await registerOperationalBusiness(page, {
    ownerName: "Modal Accessibility Owner",
    email,
    password,
    businessName: `Modal Accessibility Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, email, password, page);
  const productId = await seedProduct(request, headers, {
    name: `Modal Test Product ${stamp}`,
    priceMinor: 1500,
    stock: 5,
  });
  const draftResponse = await request.post(`${API}/api/v1/sales/drafts`, {
    headers,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draftResponse.status()).toBe(201);
  const draft = await draftResponse.json() as { id: string };

  await page.goto(`/sales/${draft.id}`);
  const openVoidDialog = page.getByRole("button", { name: "Void sale", exact: true });
  await openVoidDialog.click();
  const dialog = page.getByRole("dialog", { name: "Void sale" });
  await expect(dialog).toBeVisible();
  const reason = dialog.getByLabel("Reason");
  await expect(reason).toBeFocused();
  await reason.fill("Keyboard focus containment check");

  const confirmVoid = dialog.getByRole("button", { name: "Void sale", exact: true });
  await expect(confirmVoid).toBeEnabled();
  await confirmVoid.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirmVoid).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openVoidDialog).toBeFocused();
  const persisted = await request.get(`${API}/api/v1/sales/${draft.id}`, { headers });
  expect(persisted.ok()).toBe(true);
  expect((await persisted.json() as { status: string }).status).toBe("DRAFT");
});
