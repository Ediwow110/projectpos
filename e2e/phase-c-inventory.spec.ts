import { expect, test } from "@playwright/test";
import {
  API, apiAuthedContext, createStaffMember, registerOperationalBusiness,
  seedProduct, signIn, signOut,
} from "./helpers";

test("Phase C: record expiry and damage, dispose exactly once, and deny cashier stock writes", async ({ page, request }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Phase C QA Owner", email: `phase-c-owner-${stamp}@example.com`,
    password: "correct-horse-12", businessName: "Phase C QA Store",
  });
  const owner = await apiAuthedContext(request, ownerEmail, "correct-horse-12", page);
  const productName = `Expiry goods ${stamp}`;
  const productId = await seedProduct(request, owner.headers, {
    name: productName, priceMinor: 1500, stock: 10,
  });
  const cashierEmail = `phase-c-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, owner.headers, {
    name: "Phase C Cashier", email: cashierEmail, role: "cashier",
  });

  await page.goto("/inventory/stock-exceptions");
  await expect(page.getByRole("heading", { name: "Damage & expiration register" })).toBeVisible();
  await page.getByLabel("Inventory product").selectOption(productId);
  await page.getByLabel("Issue type").selectOption("EXPIRY");
  await page.getByLabel("Affected units").fill("2");
  await page.getByLabel("Expiration date", { exact: true }).fill("2027-06-30");
  await page.getByLabel("Issue description").fill("Batch A12 expires soon");
  await page.getByRole("button", { name: "Record issue" }).click();
  await expect(page.getByRole("status").filter({ hasText: "On-hand inventory was not changed" })).toBeVisible();
  await expect(page.getByText("Batch A12 expires soon")).toBeVisible();

  const before = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: owner.headers });
  expect(before.status()).toBe(200);
  const beforeBalance = (await before.json()) as { items: Array<{ productId: string; qtyOnHand: number }> };
  expect(beforeBalance.items.find((row) => row.productId === productId)?.qtyOnHand).toBe(10);

  await page.getByRole("button", { name: "Record disposal" }).click();
  const confirmation = page.getByRole("dialog", { name: "Dispose of reported stock?" });
  await expect(confirmation).toContainText("2 unit(s)");
  await confirmation.getByRole("button", { name: "Dispose 2 unit(s)" }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "One audited damage movement" })).toBeVisible();
  await page.getByLabel("Filter stock risks").selectOption("ALL");
  await expect(page.getByText("Disposed · movement", { exact: false })).toBeVisible();

  const after = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: owner.headers });
  const afterBalance = (await after.json()) as { items: Array<{ productId: string; qtyOnHand: number }> };
  expect(afterBalance.items.find((row) => row.productId === productId)?.qtyOnHand).toBe(8);
  const risks = await request.get(`${API}/api/v1/inventory/stock-exceptions`, { headers: owner.headers });
  expect(risks.status()).toBe(200);
  const rows = (await risks.json()) as { items: Array<{ id: string; status: string; movementId: string | null }> };
  expect(rows.items).toHaveLength(1);
  expect(rows.items[0]?.status).toBe("DISPOSED");
  const csrf = await request.get(`${API}/api/v1/auth/csrf`, { headers: owner.headers });
  expect(csrf.ok()).toBe(true);
  const replay = await request.post(`${API}/api/v1/inventory/stock-exceptions/${rows.items[0]!.id}/dispose`, {
    headers: owner.headers,
  });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).replayed).toBe(true);

  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/inventory/stock-exceptions");
    await expect(page.getByRole("heading", { name: "Damage & expiration register" })).toBeVisible();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, `Stock register should not overflow at ${width}px`).toBeLessThanOrEqual(width + 2);
  }

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/inventory/stock-exceptions");
  await expect(page.getByText("You do not have inventory-adjust permission")).toBeVisible();
  const cashierAccess = await apiAuthedContext(request, cashierEmail, cashier.tempPassword);
  const denied = await request.post(`${API}/api/v1/inventory/stock-exceptions`, {
    headers: { ...cashierAccess.headers, "Idempotency-Key": `cashier-deny-${stamp}` },
    data: { productId, kind: "DAMAGE", quantity: 1, reason: "Broken case" },
  });
  expect(denied.status()).toBe(403);
});
