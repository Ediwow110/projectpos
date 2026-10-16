import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  API,
  apiAuthedContext,
  clickPosPay,
  createCounterWithOpenShift,
  createStaffMember,
  expectOnePosCartItem,
  posCartRegion,
  registerOperationalBusiness,
  seedProduct,
  setApprovalPin,
  signIn,
  signOut,
} from "./helpers";

const OWNER_PASSWORD = "correct-horse-12";

async function tabTo(page: Page, target: Locator, maxSteps = 40): Promise<void> {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach the expected approval control");
}

test("cashier requests an exact shift-close approval and manager authorizes from the inbox", async ({ page, request, browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Queue Owner",
    email: `queue-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Queue Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const managerEmail = `queue-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Queue Manager", role: "manager" });
  const cashierEmail = `queue-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Queue Cashier", role: "cashier" });
  await setApprovalPin(request, ownerHeaders, manager.membershipId, "482615");

  const registerName = `Queue Till ${stamp}`;
  await createCounterWithOpenShift(page, registerName);
  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/shifts");
  const closeCandidate = page.locator("article, section, [class*=Panel]").filter({ hasText: registerName }).filter({ hasText: "Manager review" }).first();
  await expect(closeCandidate.getByRole("button", { name: "Request close approval" })).toBeVisible();
  await closeCandidate.getByRole("button", { name: "Request close approval" }).click();
  const closeDialog = page.getByRole("dialog", { name: "Close & reconcile shift" });
  await closeDialog.getByLabel("Counted cash (PHP)").fill("125.00");
  await closeDialog.getByRole("button", { name: "Close shift" }).click();

  const approvalDialog = page.getByRole("dialog", { name: /Manager approval · approve shift close override/ });
  await expect(approvalDialog).toBeVisible();
  await approvalDialog.getByRole("button", { name: "Send to manager inbox" }).click();
  await expect(approvalDialog.getByRole("status")).toContainText("Request sent");

  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  await managerPage.goto("/customer-concerns");
  await expect(managerPage.getByRole("heading", { name: "Manager approvals" })).toBeVisible();
  await managerPage.getByLabel("Approval action type").selectOption("shift_close");
  const approvalCard = managerPage.locator("article").filter({ hasText: registerName });
  await expect(approvalCard).toContainText("Shift close variance");
  await expect(approvalCard).toContainText("Expected cash");
  await expect(approvalCard).toContainText("Counted cash");
  await approvalCard.getByLabel("Your manager email").fill(managerEmail);
  await approvalCard.getByLabel("Approval PIN (instead)").fill("482615");
  await approvalCard.getByRole("button", { name: "Authorize shift close" }).click();

  await expect(page.getByText(/Shift closed\. Variance:/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog", { name: /Manager approval · approve shift close override/ })).toBeHidden();
  await managerPage.close();
});

test("cashier queues a submitted stock count and manager authorizes without posting inventory", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Count Queue Owner", email: `count-queue-owner-${stamp}@example.com`, password: OWNER_PASSWORD,
    businessName: `Count Queue Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const managerEmail = `count-queue-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Count Queue Manager", role: "manager" });
  const cashierEmail = `count-queue-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Count Queue Cashier", role: "cashier" });
  await setApprovalPin(request, ownerHeaders, manager.membershipId, "482615");
  const productName = `Count Queue Beans ${stamp}`;
  const productId = await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 10 });
  const created = await request.post(`${API}/api/v1/inventory/counts`, {
    headers: ownerHeaders, data: { name: `Submitted count ${stamp}`, scopeType: "PARTIAL", branchId: null, productIds: [productId] },
  });
  expect(created.status()).toBe(201);
  const count = await created.json() as { id: string; version: number; countNumber: string; lines: Array<{ id: string }> };
  const started = await request.post(`${API}/api/v1/inventory/counts/${count.id}/start`, { headers: ownerHeaders, data: { expectedVersion: count.version } });
  expect(started.ok()).toBe(true);
  const counting = await started.json() as { version: number; lines: Array<{ id: string }> };
  const updated = await request.patch(`${API}/api/v1/inventory/counts/${count.id}/lines`, {
    headers: ownerHeaders, data: { expectedVersion: counting.version, lines: [{ lineId: counting.lines[0]!.id, countedQty: 8 }] },
  });
  expect(updated.ok()).toBe(true);
  const lineUpdated = await updated.json() as { version: number };
  const submitted = await request.post(`${API}/api/v1/inventory/counts/${count.id}/submit`, { headers: ownerHeaders, data: { expectedVersion: lineUpdated.version } });
  expect(submitted.ok()).toBe(true);
  const balanceBeforeApproval = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: ownerHeaders });
  expect(balanceBeforeApproval.ok()).toBe(true);
  const beforeItems = (await balanceBeforeApproval.json() as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  expect(beforeItems.find((item) => item.productId === productId)?.qtyOnHand).toBe(10);

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto(`/inventory/counts/${count.id}`);
  await expect(page.getByRole("heading", { name: `Submitted count ${stamp}` })).toBeVisible();
  await page.getByRole("button", { name: "Approve count" }).click();
  const approvalDialog = page.getByRole("dialog", { name: "Manager approval · approve stock count" });
  await approvalDialog.getByRole("button", { name: "Send to manager inbox" }).click();
  await expect(approvalDialog.getByRole("status")).toContainText("Request sent");

  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  await managerPage.goto("/customer-concerns");
  await managerPage.getByLabel("Approval action type").selectOption("inventory_count");
  const approvalCard = managerPage.locator("article").filter({ hasText: count.countNumber });
  await expect(approvalCard).toContainText("Stock count");
  await expect(approvalCard).toContainText(productName);
  await expect(approvalCard).toContainText("variance -2");
  await approvalCard.getByLabel("Your manager email").fill(managerEmail);
  await approvalCard.getByLabel("Approval PIN (instead)").fill("482615");
  await approvalCard.getByRole("button", { name: "Authorize stock count" }).click();

  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(approvalDialog).toBeHidden({ timeout: 30_000 });
  const { headers: verificationHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD);
  const unchanged = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: verificationHeaders });
  expect(unchanged.ok()).toBe(true);
  const afterItems = (await unchanged.json() as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  expect(afterItems.find((item) => item.productId === productId)?.qtyOnHand).toBe(10);
  await managerPage.close();
});

test("cashier queues an exact inventory movement and the manager grant writes it once", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Movement Queue Owner", email: `movement-queue-owner-${stamp}@example.com`, password: OWNER_PASSWORD,
    businessName: `Movement Queue Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const managerEmail = `movement-queue-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Movement Queue Manager", role: "manager" });
  const cashierEmail = `movement-queue-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Movement Queue Cashier", role: "cashier" });
  await setApprovalPin(request, ownerHeaders, manager.membershipId, "482615");
  const productName = `Movement Queue Beans ${stamp}`;
  const productId = await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 10 });
  const { headers: ownerReadHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD);

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/inventory");
  await page.getByLabel("Product ID or barcode").fill(productId);
  await page.getByLabel("Movement type").selectOption("damage");
  await page.getByLabel("Quantity").fill("3");
  await page.getByLabel("Reason").fill("damaged during shelf check");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const approvalDialog = page.getByRole("dialog", { name: /Manager approval · approve damage/ });
  await expect(approvalDialog).toBeVisible();
  await expect(approvalDialog).toContainText("damaged during shelf check");
  await approvalDialog.getByRole("button", { name: "Send to manager inbox" }).click();
  await expect(approvalDialog.getByRole("status")).toContainText("Request sent");

  const unchanged = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: ownerReadHeaders });
  expect(unchanged.ok()).toBe(true);
  const beforeItems = (await unchanged.json() as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  expect(beforeItems.find((item) => item.productId === productId)?.qtyOnHand).toBe(10);

  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  await managerPage.goto("/customer-concerns");
  await managerPage.getByLabel("Approval action type").selectOption("inventory_movement");
  const approvalCard = managerPage.locator("article").filter({ hasText: productName });
  await expect(approvalCard).toContainText("Inventory adjustment");
  await expect(approvalCard).toContainText("quantity -3");
  await expect(approvalCard).toContainText("damaged during shelf check");
  await approvalCard.getByLabel("Your manager email").fill(managerEmail);
  await approvalCard.getByLabel("Approval PIN (instead)").fill("482615");
  await approvalCard.getByRole("button", { name: "Authorize inventory adjustment" }).click();

  await expect(approvalDialog).toBeHidden({ timeout: 30_000 });
  const after = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: ownerReadHeaders });
  expect(after.ok()).toBe(true);
  const afterItems = (await after.json() as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  expect(afterItems.find((item) => item.productId === productId)?.qtyOnHand).toBe(7);
  await managerPage.close();
});

test("cashier discount request appears in manager inbox and resumes only after approval", async ({ page, request, browser }, testInfo) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Discount Queue Owner", email: `discount-queue-owner-${stamp}@example.com`, password: OWNER_PASSWORD,
    businessName: `Discount Queue Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const policy = await request.patch(`${API}/api/v1/business/settings`, {
    headers: ownerHeaders, data: { orderDiscountApprovalPercent: 5 },
  });
  expect(policy.ok()).toBe(true);
  const managerEmail = `discount-queue-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Discount Queue Manager", role: "manager" });
  const cashierEmail = `discount-queue-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Discount Queue Cashier", role: "cashier" });
  await setApprovalPin(request, ownerHeaders, manager.membershipId, "482615");
  const productName = `Queue Coffee ${stamp}`;
  await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 10 });
  const registerName = `Discount Queue Till ${stamp}`;
  await createCounterWithOpenShift(page, registerName);

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/pos");
  const width = page.viewportSize()?.width ?? 1440;
  await page.getByLabel(width < 768 ? "Mobile register" : "Register", { exact: true }).selectOption({ label: registerName });
  await page.getByLabel("Search product, SKU or scan barcode").fill(productName);
  await page.getByRole("button", { name: `${productName} ₱25.00` }).click();
  await expectOnePosCartItem(page);
  if (width < 1280) {
    await posCartRegion(page).getByRole("button", { name: "View cart", exact: true }).click();
    await page.getByRole("dialog", { name: "Tablet cart details" }).getByRole("button", { name: "Discounts", exact: true }).click();
  } else {
    await posCartRegion(page).getByRole("button", { name: "Discounts", exact: true }).click();
  }
  const discountDialog = page.getByRole("dialog", { name: "Sale discounts" });
  await discountDialog.getByLabel("Order discount (PHP)").fill("3.00");
  await discountDialog.getByRole("button", { name: "Apply discounts" }).click();
  await expect(discountDialog).toBeHidden();
  await clickPosPay(page, "22.00");
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();

  const cashierApproval = page.getByRole("dialog", { name: "Manager approval" });
  await expect(cashierApproval).toBeVisible();
  await cashierApproval.getByRole("button", { name: "Send to manager inbox" }).click();
  await expect(cashierApproval.getByRole("status")).toContainText("Request sent");
  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword, page);
  const beforeApproval = await request.get(`${API}/api/v1/sales?limit=20`, { headers: cashierHeaders });
  expect(beforeApproval.ok()).toBe(true);
  expect(((await beforeApproval.json()) as { items: Array<{ status: string }> }).items.some((sale) => sale.status === "COMPLETED")).toBe(false);

  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  let decisionResponse: { status: number; body: unknown } | null = null;
  managerPage.on("response", async (response) => {
    if (!response.url().includes("/api/v1/approvals/requests/") || !response.url().endsWith("/decision")) return;
    decisionResponse = { status: response.status(), body: await response.json().catch(() => null) };
  });
  await managerPage.goto("/customer-concerns");
  // Manager approvals is the stable task heading beneath the responsive
  // inbox title; avoid sampling the shell before its viewport variant settles.
  await expect(managerPage.getByRole("heading", { name: "Manager approvals", exact: true })).toBeVisible();
  await expect(managerPage.getByRole("region", { name: "Approval overview" })).toBeVisible();
  const atlasQueue = managerPage.getByRole("list", { name: /^(?:Mobile pending approvals|Pending approval requests)$/ });
  await expect(atlasQueue.getByText("Discount override")).toBeVisible();
  await managerPage.screenshot({ path: `test-results/atlas-v4-approval-populated-inbox-${testInfo.project.name}.png`, fullPage: false });
  await atlasQueue.getByRole("link", { name: /Discount override/ }).click();
  await expect(managerPage).toHaveURL(/#manager-approval-/);
  await managerPage.getByLabel("Approval action type").selectOption("discount");
  const approvalCard = managerPage.locator("article").filter({ hasText: productName });
  await expect(approvalCard.getByRole("region", { name: "Protected action review" })).toBeVisible();
  await expect(approvalCard.getByRole("complementary", { name: "Decision safeguards" })).toBeVisible();
  await expect(approvalCard.getByText("Required permission")).toBeVisible();
  await expect(approvalCard).toContainText("Discount override");
  await expect(approvalCard).toContainText("₱3.00");
  await expect(approvalCard.getByText("Policy verified")).toHaveCount(0);
  const layout = await managerPage.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(layout.content, "Populated approval review must not overflow horizontally").toBeLessThanOrEqual(layout.viewport + 2);
  await approvalCard.screenshot({ path: `test-results/atlas-v4-protected-action-review-${testInfo.project.name}.png` });
  await approvalCard.getByLabel("Your manager email").fill(managerEmail);
  await approvalCard.getByLabel("Approval PIN (instead)").fill("482615");
  const decisionNote = approvalCard.getByLabel("Decision note");
  await decisionNote.fill("Policy verified");
  await expect(decisionNote).toBeFocused();
  const authorizeDiscount = approvalCard.getByRole("button", { name: "Authorize discount" });
  await tabTo(managerPage, authorizeDiscount);
  await expect(authorizeDiscount).toBeFocused();
  await managerPage.keyboard.press("Enter");

  await expect.poll(() => {
    const body = decisionResponse?.body as { request?: { status?: string } } | null;
    return body?.request?.status;
  }, { timeout: 10_000 }).toBe("APPROVED");
  await expect(cashierApproval).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Payment" })).toHaveCount(0, { timeout: 30_000 });
  const completedStatus = width < 1280
    ? page.getByRole("region", { name: "Tablet payment status" }).getByText("Sale completed.", { exact: true })
    : page.getByRole("complementary", { name: "Cart" }).getByText("Sale completed.", { exact: true });
  await expect(completedStatus).toBeVisible({ timeout: 30_000 });
  const completed = await request.get(`${API}/api/v1/sales?limit=20`, { headers: cashierHeaders });
  expect(completed.ok()).toBe(true);
  expect(((await completed.json()) as { items: Array<{ status: string; totalMinor: number; discountMinor: number }> }).items)
    .toEqual(expect.arrayContaining([expect.objectContaining({ status: "COMPLETED", totalMinor: 2200, discountMinor: 300 })]));
  await managerPage.close();
});

test("cashier cannot decide a queued stock exception, manager can reject it without inventory mutation", async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Authorization rejection is covered in desktop; other viewports use the populated approval scenario.");
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Rejection Queue Owner", email: `reject-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD, businessName: `Rejection QA ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const managerEmail = `reject-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, {
    email: managerEmail, name: "Rejection Manager", role: "manager",
  });
  const cashierEmail = `reject-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, {
    email: cashierEmail, name: "Rejection Cashier", role: "cashier",
  });
  const productName = `Rejection QA Goods ${stamp}`;
  const productId = await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 10 });
  // The browser's owner session is revoked by signOut below. Use a separate,
  // still-authorized read session to verify stock after the manager decision.
  const { headers: ownerReadHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD);
  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto("/inventory");
  await page.getByLabel("Product ID or barcode").fill(productId);
  await page.getByLabel("Movement type").selectOption("damage");
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Reason").fill("Needs photographic damage evidence");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Manager approval · approve damage/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Send to manager inbox" }).click();
  await expect(dialog.getByRole("status")).toContainText("Request sent");

  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword, page);
  await page.goto("/customer-concerns");
  await expect(page.getByRole("region", { name: "Approval overview" })).toHaveCount(0);
  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  await managerPage.goto("/customer-concerns");
  const managerContext = await apiAuthedContext(request, managerEmail, manager.tempPassword, managerPage);
  const queued = await request.get(`${API}/api/v1/approvals/requests`, { headers: managerContext.headers });
  expect(queued.ok()).toBe(true);
  const records = (await queued.json()) as { requests: Array<{ id: string; status: string; context?: { productName?: string } }> };
  const target = records.requests.find((row) => row.status === "PENDING" && row.context?.productName === productName);
  expect(target).toBeDefined();
  const denied = await request.post(`${API}/api/v1/approvals/requests/${encodeURIComponent(target!.id)}/decision`, {
    headers: cashierHeaders,
    data: { decision: "REJECTED", reason: "Cashier must not review own request" },
  });
  expect(denied.status()).toBe(403);
  await managerPage.getByLabel("Approval status").selectOption("ALL");
  const card = managerPage.locator("article").filter({ hasText: productName });
  await expect(card).toContainText("Needs photographic damage evidence");
  await expect(card.getByRole("region", { name: "Protected action review" })).toBeVisible();
  await card.getByLabel("Decision note").fill("Provide photos before stock removal");
  await card.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(card).toContainText("REJECTED");
  const rejected = await request.get(`${API}/api/v1/approvals/requests`, { headers: managerContext.headers });
  expect(rejected.ok()).toBe(true);
  expect(((await rejected.json()) as { requests: Array<{ id: string; status: string }> }).requests.find((row) => row.id === target!.id)?.status).toBe("REJECTED");
  const balance = await request.get(`${API}/api/v1/inventory/balances?page=1&pageSize=100`, { headers: ownerReadHeaders });
  expect(balance.ok()).toBe(true);
  expect(((await balance.json()) as { items: Array<{ productId: string; qtyOnHand: number }> }).items.find((item) => item.productId === productId)?.qtyOnHand).toBe(10);
  await managerPage.close();
});

test("cashier queues store-credit and loyalty adjustments from the customer ledger", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Value Queue Owner", email: `value-queue-owner-${stamp}@example.com`, password: OWNER_PASSWORD,
    businessName: `Value Queue Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const customerName = `Value Queue Customer ${stamp}`;
  const customerResponse = await request.post(`${API}/api/v1/customers`, {
    headers: ownerHeaders, data: { name: customerName },
  });
  expect(customerResponse.status()).toBe(201);
  const customer = await customerResponse.json() as { id: string };
  const managerEmail = `value-queue-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, ownerHeaders, { email: managerEmail, name: "Value Queue Manager", role: "manager" });
  const cashierEmail = `value-queue-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, { email: cashierEmail, name: "Value Queue Cashier", role: "cashier" });
  await setApprovalPin(request, ownerHeaders, manager.membershipId, "482615");

  await signOut(page);
  await signIn(page, cashierEmail, cashier.tempPassword);
  await page.goto(`/customers/${customer.id}/stored-value`);
  await expect(page.getByRole("heading", { name: `${customerName} value ledger` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manual adjustment" })).toBeVisible();
  await expect(page.getByText("Detailed value history is limited to owner and manager roles. Checkout balances remain available.")).toBeVisible();
  await expect(page.getByText("Store-credit history", { exact: true })).toHaveCount(0);
  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword, page);
  const deniedLedger = await request.get(`${API}/api/v1/customers/${customer.id}/stored-value/history`, { headers: cashierHeaders });
  expect(deniedLedger.status()).toBe(403);

  const managerPage = await browser.newPage();
  await signIn(managerPage, managerEmail, manager.tempPassword);
  await managerPage.goto("/customer-concerns");
  await managerPage.getByLabel("Approval action type").selectOption("value_adjustment");

  for (const adjustment of [
    { type: "store-credit", label: "Store credit", amount: "500", message: "Store-credit balance adjusted." },
    { type: "loyalty", label: "Loyalty points", amount: "25", message: "Loyalty balance adjusted." },
  ]) {
    await page.getByLabel("Value type").selectOption(adjustment.type);
    await page.getByLabel(/Amount delta \(minor\)|Points delta/).fill(adjustment.amount);
    await page.getByLabel("Reason").fill(`Approved ${adjustment.label} correction`);
    await page.getByRole("button", { name: "Request manager review" }).click();
    const dialog = page.getByRole("dialog", { name: "Manager approval · customer value adjustment" });
    await dialog.getByRole("button", { name: "Send to manager inbox" }).click();
    await expect(dialog.getByRole("status")).toContainText("Request sent");

    await expect.poll(async () => {
      const response = await managerPage.request.get(`${API}/api/v1/approvals/requests`);
      if (!response.ok()) return false;
      const body = await response.json() as { requests: Array<{ status: string; action: { kind: string; valueType?: string; reason?: string }; context?: { targetLabel?: string } }> };
      return body.requests.some((row) => row.status === "PENDING" && row.action.kind === "value_adjustment"
        && row.action.valueType === (adjustment.type === "loyalty" ? "loyalty" : "store_credit")
        && row.action.reason === `Approved ${adjustment.label} correction` && row.context?.targetLabel === customerName);
    }, { timeout: 15_000 }).toBe(true);

    const card = managerPage.locator("article").filter({ hasText: customerName }).filter({ hasText: adjustment.label });
    await expect(card).toContainText(`Approved ${adjustment.label} correction`);
    await card.getByLabel("Your manager email").fill(managerEmail);
    await card.getByLabel("Approval PIN (instead)").fill("482615");
    await card.getByRole("button", { name: `Authorize ${adjustment.label.toLowerCase()} adjustment` }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("status")).toContainText(adjustment.message);
  }

  const { headers: managerHeaders } = await apiAuthedContext(request, managerEmail, manager.tempPassword, managerPage);
  const value = await request.get(`${API}/api/v1/customers/${customer.id}/stored-value`, { headers: managerHeaders });
  expect(value.ok(), await value.text()).toBe(true);
  await expect(value.json()).resolves.toMatchObject({ storeCreditMinor: 500, loyaltyPoints: 25 });
  await managerPage.close();
});
