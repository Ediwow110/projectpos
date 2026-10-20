import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  completePosSale,
  createCounterWithOpenShift,
  createStaffMember,
  registerOperationalBusiness,
  seedProduct,
  signIn,
  signOut,
} from "./helpers";

const OWNER_PASSWORD = "correct-horse-12";

async function openInbox(page: Page): Promise<void> {
  await page.goto("/customer-concerns");
  await expect(page.getByRole("heading", { name: /Customer case (inbox|history)/ })).toBeVisible();
}

async function tabTo(page: Page, target: Locator, maxSteps = 40): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label") ?? "the target control"}`);
}

async function skipToMain(page: Page): Promise<void> {
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  // After signing in or navigating via the app router, focus might be left on
  // another control. Find the skip link using only keyboard navigation rather
  // than assuming one Tab always starts at the top of the document.
  await tabTo(page, skipLink, 85);
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
}

test("cashier submits a receipt concern and managers race safely while history survives refresh", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Concern Owner",
    email: `concern-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Concern Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const managerEmail = `concern-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, {
    email: managerEmail, name: "Concern Manager", role: "manager",
  });
  const secondManagerEmail = `concern-manager-second-${stamp}@example.com`;
  const secondManager = await createStaffMember(request, ownerHeaders, {
    email: secondManagerEmail, name: "Second Concern Manager", role: "manager",
  });
  const cashierEmail = `concern-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, {
    email: cashierEmail, name: "Concern Cashier", role: "cashier",
  });
  const inventoryEmail = `concern-inventory-${stamp}@example.com`;
  const inventory = await createStaffMember(request, ownerHeaders, {
    email: inventoryEmail, name: "Concern Inventory", role: "inventory",
  });
  const productName = `Concern Item ${stamp}`;
  const productId = await seedProduct(request, ownerHeaders, {
    name: productName, priceMinor: 2500, stock: 5,
  });
  const register = `Concern Till ${stamp}`;
  await createCounterWithOpenShift(page, register);
  const saleId = await completePosSale(page, request, ownerHeaders, {
    productName, productPriceLabel: "25.00", register, payAmount: "25.00",
  });
  const rejectedProductName = `Rejected Concern Item ${stamp}`;
  await seedProduct(request, ownerHeaders, { name: rejectedProductName, priceMinor: 1200, stock: 3 });
  await completePosSale(page, request, ownerHeaders, {
    productName: rejectedProductName, productPriceLabel: "12.00", register, payAmount: "12.00",
  });
  const salesResponse = await request.get(`${API}/api/v1/sales?limit=20`, { headers: ownerHeaders });
  expect(salesResponse.ok()).toBe(true);
  const sales = ((await salesResponse.json()) as { items: Array<{ id: string; receiptNo: string }> }).items;
  const sale = sales
    .find((item) => item.id === saleId);
  const rejectedSale = sales.find((item) => item.id !== saleId);
  expect(sale?.receiptNo).toBeTruthy();
  expect(rejectedSale?.receiptNo).toBeTruthy();

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/receipts/lookup");
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.screenshot({ path: `test-results/atlas-v4-lookup-empty-${testInfo.project.name}.png`, fullPage: false });
  const receiptInput = page.getByLabel("Receipt number");
  const lookupUrl = "**/api/v1/receipts/lookup?*";
  await receiptInput.fill("NO-SUCH-RECEIPT");
  await expect(page.getByText("Receipt number ready to search")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.screenshot({ path: `test-results/atlas-v4-lookup-entered-${testInfo.project.name}.png`, fullPage: false });
  await page.route(lookupUrl, (route) => route.abort());
  await receiptInput.press("Enter");
  await expect(page.getByRole("region", { name: "Receipt lookup result" }).getByRole("alert")).toContainText("Could not reach the store service");
  await page.unroute(lookupUrl);

  await receiptInput.fill("NO-SUCH-RECEIPT");
  await page.route(lookupUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  await receiptInput.press("Enter");
  await expect(page.getByText("Looking for receipt NO-SUCH-RECEIPT")).toBeVisible();
  await page.screenshot({ path: `test-results/atlas-v4-lookup-searching-${testInfo.project.name}.png`, fullPage: false });
  await expect(page.getByText("No matching receipt is available within your current access.")).toBeVisible();
  await page.unroute(lookupUrl);

  await receiptInput.fill(sale!.receiptNo);
  await receiptInput.press("Enter");
  await expect(page.getByRole("heading", { name: `Receipt ${sale!.receiptNo}` })).toBeVisible();
  await expect(page.getByRole("table")).toContainText(productName);
  await page.screenshot({ path: `test-results/atlas-v4-lookup-match-${testInfo.project.name}.png`, fullPage: false });
  await expect(page.getByText("not a tax invoice or a BIR-compliant document")).toBeVisible();

  const issueLink = page.getByRole("link", { name: "Report an item concern" });
  await tabTo(page, issueLink);
  await expect(issueLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/customer-concerns/new/${sale!.receiptNo}$`));
  await expect(page.getByRole("heading", { name: (page.viewportSize()?.width ?? 1440) < 640 ? "Report a product issue" : "Customer complaint intake" })).toBeVisible();
  await expect(page.getByText("RECEIPT VERIFIED")).toBeVisible();
  await expect(page.getByRole("region", { name: "Verified receipt" })).toContainText(sale!.receiptNo);
  await expect(page.getByRole("group", { name: "Items and quantities" })).toBeVisible();
  await expect(page.getByLabel("Issue reason")).toBeVisible();
  await expect(page.getByLabel("Requested outcome")).toBeVisible();
  await page.screenshot({ path: `test-results/atlas-v4-complaint-intake-${testInfo.project.name}.png`, fullPage: false });
  const increaseQuantity = page.getByRole("button", { name: `Increase affected quantity for ${productName}` });
  const decreaseQuantity = page.getByRole("button", { name: `Decrease affected quantity for ${productName}` });
  const affectedQuantity = page.getByRole("status", { name: `Affected quantity for ${productName}` });
  const originalViewport = page.viewportSize()!;
  // Atlas V4 acceptance covers the whole specified viewport spectrum.
  for (const width of [390, 820, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: originalViewport.height });
    await expect(increaseQuantity).toBeVisible();
    expect(await increaseQuantity.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await decreaseQuantity.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width + 2);
  }
  await page.setViewportSize(originalViewport);
  await expect(decreaseQuantity).toBeDisabled();
  await tabTo(page, increaseQuantity);
  await expect(increaseQuantity).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(affectedQuantity).toHaveText("1");
  await expect(decreaseQuantity).toBeEnabled();
  const notes = page.getByLabel("Notes");
  await tabTo(page, notes);
  await expect(notes).toBeFocused();
  await page.keyboard.type("Customer reports the item was damaged.");
  const submitConcern = page.getByRole("button", { name: "Submit for review" });
  if ((page.viewportSize()?.width ?? 1440) < 640) {
    expect(await submitConcern.evaluate((button) => getComputedStyle(button).position)).toBe("fixed");
    expect(await submitConcern.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(53);
  }
  await tabTo(page, submitConcern);
  await expect(submitConcern).toBeFocused();
  const concernIdempotencyKeys: string[] = [];
  let dropFirstConcernResponse = true;
  await page.route("**/api/v1/customer-concerns", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    concernIdempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
    if (dropFirstConcernResponse) {
      dropFirstConcernResponse = false;
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.keyboard.press("Enter");
  await expect(page.locator("main p[role='alert']")).toContainText("case could not be submitted");
  await expect(submitConcern).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("submitted");
  await expect(page.getByRole("status")).toContainText("No funds or inventory changed.");
  expect(concernIdempotencyKeys).toHaveLength(2);
  expect(concernIdempotencyKeys[0]).toBeTruthy();
  expect(concernIdempotencyKeys[1]).toBe(concernIdempotencyKeys[0]);
  await page.unroute("**/api/v1/customer-concerns");
  const submittedHeading = page.getByRole("heading", { name: "Complaint submitted" });
  await expect(submittedHeading).toBeFocused();
  await page.screenshot({ path: `test-results/atlas-v4-complaint-submitted-${testInfo.project.name}.png`, fullPage: false });

  const anonymousCases = await request.get(`${API}/api/v1/customer-concerns`);
  expect(anonymousCases.status()).toBe(401);
  const { headers: cashierApiHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword);
  const ownCasesResponse = await request.get(`${API}/api/v1/customer-concerns`, { headers: cashierApiHeaders });
  expect(ownCasesResponse.ok()).toBe(true);
  const ownCases = await ownCasesResponse.json() as Array<{ id: string; status: string }>;
  expect(ownCases).toHaveLength(1);
  expect(ownCases[0]?.status).toBe("PENDING");
  const cashierDecision = await request.post(`${API}/api/v1/customer-concerns/${ownCases[0]!.id}/decision`, {
    headers: cashierApiHeaders, data: { decision: "APPROVED", reason: "Unauthorized role" },
  });
  expect(cashierDecision.status()).toBe(403);
  const noCsrfHeaders = { ...cashierApiHeaders };
  delete noCsrfHeaders["X-CSRF-Token"];
  const csrfDeniedDecision = await request.post(`${API}/api/v1/customer-concerns/${ownCases[0]!.id}/decision`, {
    headers: noCsrfHeaders, data: { decision: "APPROVED", reason: "Missing CSRF" },
  });
  expect(csrfDeniedDecision.status()).toBe(403);
  const { headers: inventoryHeaders } = await apiAuthedContext(request, inventoryEmail, inventory.tempPassword);
  const inventoryCases = await request.get(`${API}/api/v1/customer-concerns`, { headers: inventoryHeaders });
  expect(inventoryCases.status()).toBe(403);
  const inventoryReceipt = await request.get(`${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(sale!.receiptNo)}`, { headers: inventoryHeaders });
  expect(inventoryReceipt.status()).toBe(403);

  const { headers: ownerReadHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD);
  const stockAfterRequest = await request.get(`${API}/api/v1/inventory/balances?pageSize=50`, { headers: ownerReadHeaders });
  expect(stockAfterRequest.ok()).toBe(true);
  const stockRow = ((await stockAfterRequest.json()) as { items: Array<{ productId: string; qtyOnHand: number }> }).items
    .find((item) => item.productId === productId);
  expect(stockRow?.qtyOnHand).toBe(4);

  await openInbox(page);
  const cashierHistory = page.locator("section[aria-label='Customer case history']").filter({ hasText: sale!.receiptNo });
  await expect(cashierHistory).toBeVisible();
  await expect(cashierHistory).toContainText("PENDING");
  await expect(cashierHistory.getByRole("button", { name: "Authorize request" })).toHaveCount(0);
  await signOut(page);
  await signIn(page, managerEmail, manager.tempPassword);
  await openInbox(page);
  await expect(page.getByRole("heading", { name: "Manager approvals" })).toBeVisible();
  await expect(page.getByLabel("Approval status")).toBeVisible();
  await page.getByLabel("Case type").selectOption("EXCHANGE");
  await expect(page.getByText("No cases match these filters.")).toBeVisible();
  await page.getByLabel("Case type").selectOption("REFUND");
  const caseCard = page.locator("section[aria-label='Customer case results']").filter({ hasText: sale!.receiptNo });
  await expect(page.getByRole("region", { name: "Customer case results" })).toBeVisible();
  await expect(caseCard).toBeVisible();
  await expect(caseCard).toContainText("PENDING");
  await expect(caseCard).toContainText("Customer reports the item was damaged.");
  await expect(page.getByRole("region", { name: "Complaint and refund history" })).toContainText(sale!.receiptNo);
  await page.screenshot({ path: `test-results/atlas-v4-complaint-history-${testInfo.project.name}.png`, fullPage: false });
  await caseCard.getByLabel("Decision note").fill("Reviewed damaged item request.");
  const authorizeCase = caseCard.getByRole("button", { name: "Authorize request" });
  await tabTo(page, authorizeCase);
  await expect(authorizeCase).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No cases match these filters.")).toBeVisible();
  await page.getByLabel("Case status").selectOption("ALL");
  await expect(caseCard).toContainText("APPROVED");
  await expect(caseCard).toContainText("No funds or inventory were changed by this approval.");

  await page.reload();
  await page.getByLabel("Case status").selectOption("ALL");
  await expect(page.getByRole("region", { name: "Customer case results" }).getByText("APPROVED", { exact: true })).toBeVisible();
  await expect(page.getByText("Process approved refund")).toBeVisible();

  const rejectedReceiptResponse = await request.get(`${API}/api/v1/receipts/lookup?receiptNo=${encodeURIComponent(rejectedSale!.receiptNo)}`, { headers: cashierApiHeaders });
  expect(rejectedReceiptResponse.ok()).toBe(true);
  const rejectedReceipt = await rejectedReceiptResponse.json() as { saleId: string; items: Array<{ id: string }> };
  const rejectedCaseResponse = await request.post(`${API}/api/v1/customer-concerns`, {
    headers: { ...cashierApiHeaders, "Idempotency-Key": `reject-case-${stamp}` },
    data: { saleId: rejectedReceipt.saleId, items: [{ saleItemId: rejectedReceipt.items[0]!.id, qty: 1 }], reason: "QUALITY", outcome: "REFUND", note: "Customer reports a quality issue." },
  });
  expect(rejectedCaseResponse.status()).toBe(201);
  const rejectedCase = await rejectedCaseResponse.json() as { concern: { id: string } };
  await page.reload();
  const rejectedCaseCard = page.locator("section[aria-label='Customer case results']").filter({ hasText: rejectedSale!.receiptNo });
  await expect(rejectedCaseCard).toBeVisible();
  await rejectedCaseCard.getByLabel("Decision note").fill("Request did not meet the return policy.");
  const secondManagerPage = await browser.newPage();
  await signIn(secondManagerPage, secondManagerEmail, secondManager.tempPassword);
  await openInbox(secondManagerPage);
  const secondManagerCase = secondManagerPage.locator("section[aria-label='Customer case results']").filter({ hasText: rejectedSale!.receiptNo });
  await expect(secondManagerCase).toBeVisible();
  await secondManagerCase.getByLabel("Decision note").fill("Request did not meet the return policy.");
  const decisionResponse = (target: Page) => target.waitForResponse((response) =>
    response.url().includes(`/api/v1/customer-concerns/${rejectedCase.concern.id}/decision`) &&
    response.request().method() === "POST");
  const responseWaits = [decisionResponse(page), decisionResponse(secondManagerPage)];
  await Promise.all([
    rejectedCaseCard.getByRole("button", { name: "Reject", exact: true }).click(),
    secondManagerCase.getByRole("button", { name: "Reject", exact: true }).click(),
  ]);
  const decisionStatuses = await Promise.all(responseWaits.map(async (response) => (await response).status()));
  expect(decisionStatuses.sort((a, b) => a - b)).toEqual([200, 409]);
  await secondManagerPage.close();

  await page.reload();
  await page.getByLabel("Case status").selectOption("ALL");
  await expect(rejectedCaseCard).toContainText("REJECTED");

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await openInbox(page);
  const rejectedHistory = page.locator("section[aria-label='Customer case history']").filter({ hasText: rejectedSale!.receiptNo });
  await expect(rejectedHistory).toBeVisible();
  await expect(rejectedHistory).toContainText("REJECTED");
});

test("over-threshold concern is non-actionable for managers and requires owner review", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Escalation Owner",
    email: `concern-escalation-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Escalation Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const threshold = await request.patch(`${API}/api/v1/business/settings`, {
    headers: ownerHeaders, data: { refundApprovalThresholdMinor: 1000 },
  });
  expect(threshold.ok()).toBe(true);
  const managerEmail = `concern-escalation-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, {
    email: managerEmail, name: "Escalation Manager", role: "manager",
  });
  const cashierEmail = `concern-escalation-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, {
    email: cashierEmail, name: "Escalation Cashier", role: "cashier",
  });
  const productName = `Escalation Item ${stamp}`;
  await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 3 });
  const register = `Escalation Till ${stamp}`;
  await createCounterWithOpenShift(page, register);
  const saleId = await completePosSale(page, request, ownerHeaders, {
    productName, productPriceLabel: "25.00", register, payAmount: "25.00",
  });
  const sales = await request.get(`${API}/api/v1/sales?limit=20`, { headers: ownerHeaders });
  expect(sales.ok()).toBe(true);
  const sale = ((await sales.json()) as { items: Array<{ id: string; receiptNo: string }> }).items.find((row) => row.id === saleId);
  expect(sale?.receiptNo).toBeTruthy();

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/receipts/lookup");
  await expect(page.getByRole("heading", { name: "Find a receipt" })).toBeVisible();
  await skipToMain(page);
  const receiptNumber = page.getByLabel("Receipt number");
  await tabTo(page, receiptNumber);
  await page.keyboard.type(sale!.receiptNo);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: `Receipt ${sale!.receiptNo}` })).toBeVisible();
  const intakeLink = page.getByRole("link", { name: "Report an item concern" });
  await tabTo(page, intakeLink);
  await page.keyboard.press("Enter");
  // Atlas V4 uses keyboard-accessible stepper buttons, not a free-text
  // quantity input. Exercise the real control through the tab order.
  const increaseQuantity = page.getByRole("button", { name: `Increase affected quantity for ${productName}` });
  const decreaseQuantity = page.getByRole("button", { name: `Decrease affected quantity for ${productName}` });
  const affectedQuantity = page.getByRole("status", { name: `Affected quantity for ${productName}` });
  await expect(affectedQuantity).toHaveText("0");
  await expect(decreaseQuantity).toBeDisabled();
  await tabTo(page, increaseQuantity);
  await expect(increaseQuantity).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(affectedQuantity).toHaveText("1");
  await expect(decreaseQuantity).toBeEnabled();
  const outcomeInput = page.getByLabel("Requested outcome");
  await tabTo(page, outcomeInput);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  const concernNotes = page.getByLabel("Customer notes");
  await tabTo(page, concernNotes);
  await page.keyboard.type("Above the manager authorization threshold.");
  const submitConcern = page.getByRole("button", { name: "Submit for review" });
  await tabTo(page, submitConcern);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("OWNER REVIEW");

  await signOut(page);
  await signIn(page, managerEmail, manager.tempPassword);
  await openInbox(page);
  const managerCard = page.locator("section[aria-label='Customer case results']").filter({ hasText: sale!.receiptNo });
  await expect(managerCard).toContainText("OWNER REVIEW");
  await expect(managerCard).toContainText("This amount requires an owner decision.");
  await expect(managerCard.getByRole("button", { name: "Authorize request" })).toHaveCount(0);

  await signOut(page);
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  if (await tour.isVisible().catch(() => false)) await tour.getByRole("button", { name: "Skip tour" }).click();
  await openInbox(page);
  await expect(page.getByRole("heading", { name: "Owner escalation required" })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Review owner request" })).toHaveAttribute("href", "#customer-case-decisions");
  await skipToMain(page);
  await expect(page.getByRole("heading", { name: "Owner escalation required" })).toBeVisible();
  await page.screenshot({ path: "test-results/atlas-v4-owner-escalation-desktop.png", fullPage: false });
  const ownerCard = page.locator("section[aria-label='Customer case results']").filter({ hasText: sale!.receiptNo });
  await expect(ownerCard).toContainText("OWNER REVIEW");
  const ownerNote = ownerCard.getByLabel("Decision note");
  await tabTo(page, ownerNote);
  await page.keyboard.type("Owner reviewed the high-value request.");
  const ownerPassword = ownerCard.getByLabel("Confirm owner password");
  await tabTo(page, ownerPassword);
  await page.keyboard.type(OWNER_PASSWORD);
  const authorize = ownerCard.getByRole("button", { name: "Verify owner & authorize" });
  await tabTo(page, authorize);
  await page.keyboard.press("Enter");
  await page.getByLabel("Case status").selectOption("ALL");
  await expect(ownerCard).toContainText("APPROVED");
});

test("deny-only review permission blocks a manager's customer-case workflow", async ({ page, request }) => {
  const stamp = Date.now();
  const password = "correct-horse-12";
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Permission Owner",
    email: `concern-permission-owner-${stamp}@example.com`,
    password,
    businessName: `Concern Permission Store ${stamp}`,
  });
  const ownerAuth = await apiAuthedContext(request, ownerEmail, password, page);
  const managerEmail = `concern-denied-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerAuth.headers, {
    email: managerEmail,
    name: "Denied Review Manager",
    role: "manager",
  });
  const confirmed = await request.post(`${API}/api/v1/auth/confirm-password`, {
    headers: ownerAuth.headers,
    data: { password },
  });
  expect(confirmed.ok()).toBe(true);
  const restricted = await request.patch(`${API}/api/v1/memberships/${manager.membershipId}/restrictions`, {
    headers: ownerAuth.headers,
    data: { deniedPermissions: ["customer_concern.review"] },
  });
  expect(restricted.ok()).toBe(true);

  await signOut(page);
  await signIn(page, managerEmail, manager.tempPassword);
  await page.goto("/customer-concerns");
  await expect(page.getByRole("heading", { name: "Customer case history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No customer cases yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manager approvals" })).toBeVisible();

  const managerAuth = await apiAuthedContext(request, managerEmail, manager.tempPassword, page);
  const managerProfile = await request.get(`${API}/api/v1/me`, { headers: managerAuth.headers });
  expect(managerProfile.ok()).toBe(true);
  const effectivePermissions = (await managerProfile.json() as { permissions: string[] }).permissions;
  expect(effectivePermissions).toContain("customer_concern.request");
  expect(effectivePermissions).not.toContain("customer_concern.review");
  const list = await request.get(`${API}/api/v1/customer-concerns`, { headers: managerAuth.headers });
  expect(list.status()).toBe(200);
  expect(await list.json()).toEqual([]);
  const decision = await request.post(`${API}/api/v1/customer-concerns/denied-case/decision`, {
    headers: managerAuth.headers,
    data: { decision: "APPROVED", reason: "Review permission is denied" },
  });
  expect(decision.status()).toBe(403);
});
