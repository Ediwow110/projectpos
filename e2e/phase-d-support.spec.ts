import { expect, test } from "@playwright/test";
import { API, apiAuthedContext, createStaffMember, registerOperationalBusiness } from "./helpers";

test("Phase D guest support → owner inbox → consented, revocable read-only operator health", async ({ page, request }) => {
  test.setTimeout(240_000);
  // Match the isolated local E2E server's configured operator key; use a
  // distinct invalid value for the negative authorization assertion.
  const operatorKey = process.env["PLATFORM_API_KEY"] ?? "test-platform-key";
  const stamp = Date.now().toString(36);
  const password = "correct-horse-12";
  const email = await registerOperationalBusiness(page, {
    ownerName: "Phase D Store Owner", email: `phase-d-owner-${stamp}@example.com`,
    password, businessName: "Phase D Isolated Store",
  });
  const owner = await apiAuthedContext(request, email, password, page);
  const staffEmail = `phase-d-cashier-${stamp}@example.com`;
  const staff = await createStaffMember(request, owner.headers, { email: staffEmail, name: "Support-denied Cashier", role: "cashier" });
  const staffAuth = await apiAuthedContext(request, staffEmail, staff.tempPassword);
  expect((await request.get(`${API}/api/v1/admin/support/cases`, { headers: staffAuth.headers })).status()).toBe(403);
  expect((await request.get(`${API}/api/v1/admin/support/consents`, { headers: staffAuth.headers })).status()).toBe(403);
  const businessResponse = await request.get(`${API}/api/v1/business`, { headers: owner.headers });
  expect(businessResponse.ok()).toBe(true);
  const business = await businessResponse.json() as { id: string; storefrontKey: string | null };
  const branchRes = await request.post(`${API}/api/v1/branches`, { headers: owner.headers, data: { name: "Phase D Pickup" } });
  expect(branchRes.ok()).toBe(true);
  const branch = await branchRes.json() as { id: string };
  const productRes = await request.post(`${API}/api/v1/products`, {
    headers: owner.headers, data: { name: "Phase D Product", priceMinor: 1200, costMinor: 500 },
  });
  expect(productRes.ok()).toBe(true);
  const product = await productRes.json() as { id: string };
  expect((await request.post(`${API}/api/v1/inventory/movements`, {
    headers: owner.headers, data: { productId: product.id, branchId: branch.id, type: "opening_stock", qtyDelta: 5 },
  })).ok()).toBe(true);
  expect((await request.patch(`${API}/api/v1/business/settings`, {
    headers: owner.headers,
    data: { onlineOrderingEnabled: true, onlinePickupBranchIds: [branch.id], onlineFulfillmentBranchId: branch.id, deliveryFlatFeeMinor: 0 },
  })).ok()).toBe(true);
  const updatedBusiness = await request.get(`${API}/api/v1/business`, { headers: owner.headers });
  expect(updatedBusiness.ok()).toBe(true);
  const storefrontKey = (await updatedBusiness.json() as { storefrontKey: string }).storefrontKey;
  expect(storefrontKey).toBeTruthy();

  const origin = "http://localhost:3100";
  const draftResponse = await request.post(`${API}/api/v1/public/orders`, {
    headers: { Origin: origin, "Idempotency-Key": `d-create-${stamp}` }, data: { storefrontKey },
  });
  expect(draftResponse.ok(), `public order creation failed: ${draftResponse.status()} ${await draftResponse.text()}`).toBe(true);
  const cookie = draftResponse.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]).join("; ");
  const draft = await draftResponse.json() as { id: string };
  expect((await request.patch(`${API}/api/v1/public/orders/${draft.id}/draft`, {
    headers: { Origin: origin, Cookie: cookie },
    data: { branchId: branch.id, fulfillmentMode: "PICKUP", lines: [{ productId: product.id, qty: 1 }] },
  })).ok()).toBe(true);
  const submitted = await request.post(`${API}/api/v1/public/orders/${draft.id}/submit`, {
    headers: { Origin: origin, Cookie: cookie, "Idempotency-Key": `d-submit-${stamp}` },
    data: { branchId: branch.id, fulfillmentMode: "PICKUP", paymentMode: "PAY_AT_PICKUP", contactName: "Phase D Guest", email: "guest@example.com", phone: "+639171234567" },
  });
  expect(submitted.ok()).toBe(true);
  const token = (await submitted.json() as { statusToken: string }).statusToken;
  await page.goto(`/order-status#token=${token}`);
  await expect(page.getByRole("heading", { name: "Need help with this order?" })).toBeVisible();
  expect(page.url()).not.toContain(token);
  await page.getByLabel("What do you need help with?").selectOption("FULFILLMENT");
  await page.getByLabel("Describe the issue").fill("My pickup time has not been confirmed.");
  await page.getByRole("button", { name: "Send support request" }).click();
  await expect(page.getByText("Support request received")).toBeVisible();
  const reference = await page.getByText(/Reference:/).textContent();
  expect(reference).toContain("gsc_");
  await page.getByRole("button", { name: /View this order's support history/ }).click();
  await expect(page.getByRole("list", { name: "Support case history" })).toContainText("OPEN");

  await page.goto("/admin/support");
  await expect(page.getByRole("heading", { name: "Support & platform consent" })).toBeVisible();
  await expect(page.getByText("My pickup time has not been confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Close case" }).click();
  await page.getByRole("dialog", { name: "Close support case?" }).getByRole("button", { name: "Close case" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Support case closed" })).toBeVisible();
  const guestHistory = await request.post(`${API}/api/v1/public/support/history`, {
    headers: { Origin: origin }, data: { statusToken: token },
  });
  expect(guestHistory.ok()).toBe(true);
  expect((await guestHistory.json() as { items: Array<{ status: string }> }).items[0]?.status).toBe("CLOSED");

  const wrong = await request.get(`${API}/api/v1/platform/diagnostics/businesses/${business.id}`, {
    headers: { "x-platform-key": "deliberately-invalid-operator-key" },
  });
  expect(wrong.status()).toBe(403);
  await page.getByLabel("Purpose").fill("Investigate guest pickup incident");
  await page.getByLabel("Minutes").fill("15");
  await page.getByLabel("Owner password").fill(password);
  await page.getByRole("button", { name: "Issue consent" }).click();
  await expect(page.getByText("Read-only consent issued", { exact: false })).toBeVisible();
  const consentToken = (await page.locator('[role="status"] .font-data').last().textContent())?.trim();
  expect(consentToken).toMatch(/^ownerconsent_[a-f0-9]{64}$/);
  await page.goto("/platform/tenant-health");
  await expect(page.getByRole("heading", { name: "Tenant health" })).toBeVisible();
  await page.getByLabel("Business ID").fill(business.id);
  await page.getByLabel("Operator key").fill(operatorKey);
  await page.getByLabel("Owner consent token").fill(consentToken!);
  await page.getByRole("button", { name: "View authorized diagnostics" }).click();
  await expect(page.getByRole("region", { name: "Tenant diagnostics" })).toBeVisible();
  await expect(page.getByText("Phase D Isolated Store", { exact: true })).toBeVisible();
  await expect(page.getByText("Open guest cases")).toBeVisible();
  const activeConsents = await request.get(`${API}/api/v1/admin/support/consents`, { headers: owner.headers });
  expect(activeConsents.ok()).toBe(true);
  const records = (await activeConsents.json() as { items: Array<{ id: string; revokedAt: string | null }> }).items;
  const current = records.find((row) => row.revokedAt === null);
  expect(current).toBeTruthy();
  const revoked = await request.post(`${API}/api/v1/admin/support/consents/${current!.id}/revoke`, { headers: owner.headers });
  expect(revoked.ok()).toBe(true);
  await page.getByRole("button", { name: "View authorized diagnostics" }).click();
  await expect(page.getByText("Operator credentials or active owner consent could not be verified.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tenant diagnostics" })).toHaveCount(0);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const entry of [
      { path: "/admin/support", heading: "Support & platform consent" },
      { path: "/platform/tenant-health", heading: "Tenant health" },
      { path: `/order-status#token=${token}`, heading: "Need help with this order?" },
    ]) {
      await page.goto(entry.path);
      await expect(page.getByRole("heading", { name: entry.heading })).toBeVisible();
      const actual = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(actual, `${entry.path.split("#")[0]} overflow at ${width}px`).toBeLessThanOrEqual(width + 2);
    }
  }
});
