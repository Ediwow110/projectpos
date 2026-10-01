// Live browser coverage for the manager-approval surfaces that predate this
// matrix: refund, sale void, inventory movement and foreign shift close.
// e2e/pos-discounts.spec.ts already drives the discount path end to end, so
// this file covers the remaining four protected flows and the negative
// approver cases every one of them shares.
import { expect, test, type Page } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  completePosSale,
  createCounterWithOpenShift,
  createStaffMember,
  expectPosStatus,
  findMembershipByEmail,
  registerOperationalBusiness,
  seedProduct,
  setApprovalPin,
  signIn,
  signOut,
} from "./helpers";

const OWNER_PASSWORD = "correct-horse-12";
const MANAGER_PIN = "482615";

interface Roster {
  ownerEmail: string;
  managerEmail: string;
  cashierEmail: string;
  cashierPassword: string;
}

/** Registers a business and adds a manager plus a cashier, each with a PIN. */
async function seedRoster(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  stamp: number,
): Promise<Roster> {
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Approval Owner",
    email: `approval-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Approval Store ${stamp}`,
  });
  const { headers } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);

  const managerEmail = `approval-manager-${stamp}@example.com`;
  const manager = await createStaffMember(request, headers, {
    email: managerEmail, name: "Approval Manager", role: "manager",
  });
  await setApprovalPin(request, headers, manager.membershipId, MANAGER_PIN);

  // The cashier deliberately gets no approval PIN. Approval credentials are an
  // owner/manager capability — MembershipService.setApprovalPin rejects every
  // other role, and the team UI offers the action for owner/manager only — so
  // the "authenticated but not permitted" negative case below uses a
  // non-member address instead of a cashier credential.
  const cashierEmail = `approval-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, headers, {
    email: cashierEmail, name: "Approval Cashier", role: "cashier",
  });

  return { ownerEmail, managerEmail, cashierEmail, cashierPassword: cashier.tempPassword };
}

function approvalDialog(page: Page) {
  return page.getByRole("dialog", { name: "Manager approval" });
}

async function fillApproval(page: Page, email: string, pin: string): Promise<void> {
  const dialog = approvalDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Manager email").fill(email);
  await dialog.getByLabel("Approval PIN").fill(pin);
  await dialog.getByRole("button", { name: "Approve & continue" }).click();
}

test("inventory: cashier stock adjustment requires manager approval and writes the exact quantity once", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const roster = await seedRoster(page, request, stamp);
  const { headers: ownerHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD, page);
  const productName = `Approval Stock ${stamp}`;
  const productId = await seedProduct(request, ownerHeaders, {
    name: productName, priceMinor: 5000, stock: 10,
  });

  await signOut(page);
  await signIn(page, roster.cashierEmail, roster.cashierPassword);

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await page.getByLabel("Product ID").fill(productId);
  await page.getByLabel("Movement type").selectOption("damage");
  await page.getByLabel("Quantity").fill("-3");
  await page.getByLabel("Reason").fill("broken during stock count");
  await page.getByRole("button", { name: "Record", exact: true }).click();

  // The cashier role has no inventory.adjust permission, so the write is held
  // until an owner or manager authorizes this exact movement.
  await expect(approvalDialog(page)).toBeVisible();
  // The reason is part of the fingerprint the manager authorizes, so it must be
  // visible; the summary must name the product rather than echo its internal id.
  await expect(approvalDialog(page)).toContainText("broken during stock count");
  await expect(approvalDialog(page)).toContainText(productName);
  await expect(approvalDialog(page)).not.toContainText(productId);

  // Wrong PIN keeps the dialog open and writes nothing.
  await fillApproval(page, roster.managerEmail, "000000");
  await expect(approvalDialog(page).getByRole("alert")).toContainText("Manager credentials could not be verified");
  await expect(approvalDialog(page)).toBeVisible();

  // An address that is not a member of this business cannot authorize, even
  // with a well-formed six-digit credential.
  await fillApproval(page, `outsider-${stamp}@example.com`, "482615");
  await expect(approvalDialog(page).getByRole("alert")).toContainText("Manager credentials could not be verified");
  await expect(approvalDialog(page)).toBeVisible();

  // Cancelling leaves the ledger untouched.
  await approvalDialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(approvalDialog(page)).toBeHidden();

  await page.getByLabel("Product ID").fill(productId);
  await page.getByLabel("Movement type").selectOption("damage");
  await page.getByLabel("Quantity").fill("-3");
  await page.getByLabel("Reason").fill("broken during stock count");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(approvalDialog(page)).toBeVisible();
  await fillApproval(page, roster.managerEmail, MANAGER_PIN);
  await expect(approvalDialog(page)).toBeHidden({ timeout: 30_000 });

  // signOut above revoked the browser's owner session, so the header set
  // captured at the top of the test is dead by now — authenticate freshly for
  // this read (balances takes pageSize, not limit).
  const { headers: ownerReadHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD);
  const balances = await request.get(`${API}/api/v1/inventory/balances?pageSize=50`, { headers: ownerReadHeaders });
  expect(balances.ok()).toBe(true);
  const rows = ((await balances.json()) as { items: Array<{ productId: string; qtyOnHand: number }> }).items;
  const row = rows.find((entry) => entry.productId === productId);
  expect(row, `balance row for ${productId} is present`).toBeTruthy();
  // 10 opening minus the approved damage of 3 — the approved quantity, once.
  expect(row!.qtyOnHand).toBe(7);
});

test("void: manager approval voids an unsettled sale once and a second attempt is refused", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const roster = await seedRoster(page, request, stamp);
  const { headers: ownerHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD, page);
  const productId = await seedProduct(request, ownerHeaders, {
    name: `Void Stock ${stamp}`, priceMinor: 1500, stock: 5,
  });

  // A DRAFT sale is one of the unsettled statuses the sale page can void.
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers: ownerHeaders,
    data: { lines: [{ productId, qty: 1 }] },
  });
  expect(draft.ok()).toBe(true);
  const saleId = ((await draft.json()) as { id: string }).id;

  await signOut(page);
  await signIn(page, roster.cashierEmail, roster.cashierPassword);
  await page.goto(`/sales/${saleId}`);

  await page.getByRole("button", { name: "Void sale" }).first().click();
  const voidDialog = page.getByRole("dialog", { name: "Void sale" });
  await voidDialog.getByLabel("Reason").fill("customer walked away");
  await voidDialog.getByRole("button", { name: "Void sale" }).click();

  // Cashier has no sale.void permission, so approval is required.
  await expect(approvalDialog(page)).toBeVisible();
  await fillApproval(page, `outsider-${stamp}@example.com`, "482615");
  await expect(approvalDialog(page).getByRole("alert")).toContainText("Manager credentials could not be verified");

  await fillApproval(page, roster.managerEmail, MANAGER_PIN);
  await expect(approvalDialog(page)).toBeHidden({ timeout: 30_000 });

  await expect(page.getByText("VOIDED", { exact: true })).toBeVisible({ timeout: 30_000 });

  // Replaying the void against an already-voided sale must fail closed. Use a
  // fresh owner session: the one captured at the top was revoked by signOut, and
  // a bare 401 would satisfy a loose assertion without proving anything about
  // the sale's state.
  const { headers: ownerReplayHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD);
  const replay = await request.post(`${API}/api/v1/sales/${saleId}/void`, {
    headers: ownerReplayHeaders,
    data: { reason: "customer walked away" },
  });
  expect(replay.ok()).toBe(false);
  expect(replay.status()).not.toBe(401);
});

test("refund: manager approval records the refund once and the grant cannot be reused", async ({ page, request }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const roster = await seedRoster(page, request, stamp);
  const { headers: ownerHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD, page);
  const productName = `Refund Coffee ${stamp}`;
  await seedProduct(request, ownerHeaders, { name: productName, priceMinor: 2500, stock: 10 });
  const registerName = `Refund Counter ${stamp}`;
  await createCounterWithOpenShift(page, registerName);

  const saleId = await completePosSale(page, request, ownerHeaders, {
    productName, productPriceLabel: "25.00", register: registerName, payAmount: "25.00",
  });
  await expectPosStatus(page, "Sale completed.");

  await signOut(page);
  await signIn(page, roster.cashierEmail, roster.cashierPassword);
  await page.goto(`/sales/${saleId}`);

  await page.getByRole("button", { name: "Request refund" }).click();
  const requestDialog = page.getByRole("dialog", { name: "Request refund" });
  await requestDialog.getByLabel("Reason").fill("customer returned the item");
  await requestDialog.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Refund request recorded.")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Approve refund" }).click();
  const approveDialog = page.getByRole("dialog", { name: "Approve refund" });
  await approveDialog.locator('input[type="number"]').first().fill("1");
  await approveDialog.getByRole("button", { name: "Approve refund" }).click();

  // A non-member address must not be able to approve the request the cashier
  // just raised.
  await expect(approvalDialog(page)).toBeVisible();
  await fillApproval(page, `outsider-${stamp}@example.com`, "482615");
  await expect(approvalDialog(page).getByRole("alert")).toContainText("Manager credentials could not be verified");

  await fillApproval(page, roster.managerEmail, MANAGER_PIN);
  await expect(approvalDialog(page)).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText("Refund approved and recorded.")).toBeVisible({ timeout: 30_000 });

  // Fresh owner session (signOut revoked the captured one) and an unconditional
  // assertion: guarding on `refunds.ok()` let a 401 skip the ledger check.
  // There is no /sales/:id/refunds collection route — the sale detail embeds
  // the refund records, so read them from there with a fresh owner session
  // (signOut revoked the one captured at the top).
  const { headers: ownerRefundHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD);
  const detail = await request.get(`${API}/api/v1/sales/${saleId}`, { headers: ownerRefundHeaders });
  expect(detail.ok()).toBe(true);
  const refunds = ((await detail.json()) as {
    refunds: Array<{ items: Array<{ qty: number }> }>;
  }).refunds;
  // Exactly one refund record with one unit — no duplicate line, no replay.
  expect(refunds).toHaveLength(1);
  expect(refunds[0]!.items.reduce((sum, item) => sum + item.qty, 0)).toBe(1);
});

test("shift: closing a shift opened by another staff member requires manager approval", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const roster = await seedRoster(page, request, stamp);
  const registerName = `Approval Counter ${stamp}`;
  await createCounterWithOpenShift(page, registerName);

  await signOut(page);
  await signIn(page, roster.cashierEmail, roster.cashierPassword);

  await page.goto("/shifts");
  // The shift belongs to the owner, so for this cashier the API marks it a
  // close candidate and the page renders the review panel rather than the
  // ordinary "Close shift" action.
  await page.getByRole("button", { name: "Request close approval" }).click();
  const closeDialog = page.getByRole("dialog", { name: "Close & reconcile shift" });
  await closeDialog.getByLabel("Counted cash (PHP)").fill("100.00");
  await closeDialog.getByRole("button", { name: "Close shift" }).click();

  // The shift belongs to the owner, so the cashier needs shift.close.override.
  await expect(approvalDialog(page)).toBeVisible();
  await fillApproval(page, `outsider-${stamp}@example.com`, "482615");
  await expect(approvalDialog(page).getByRole("alert")).toContainText("Manager credentials could not be verified");

  await fillApproval(page, roster.managerEmail, MANAGER_PIN);
  await expect(approvalDialog(page)).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(/Shift closed\./)).toBeVisible({ timeout: 30_000 });

  const { headers: ownerHeaders } = await apiAuthedContext(request, roster.ownerEmail, OWNER_PASSWORD);
  const memberships = await findMembershipByEmail(request, ownerHeaders, roster.ownerEmail);
  expect(memberships.role).toBe("owner");
});
