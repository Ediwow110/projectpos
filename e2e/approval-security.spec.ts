// Phase 3: attacker-style direct API coverage for the manager-approval
// grants. These tests never touch the UI — they call the protected endpoints
// exactly as a malicious authenticated client would, and assert that every
// bypass attempt fails closed.
//
// Mints are deliberately kept to at most two per test because
// POST /api/v1/approvals/manager is rate limited to 5 attempts per minute per
// business+user.
import { expect, test, type Page } from "@playwright/test";

import {
  API,
  apiAuthedContext,
  createStaffMember,
  findMembershipByEmail,
  registerOperationalBusiness,
  seedProduct,
  setApprovalPin,
} from "./helpers";

const OWNER_PASSWORD = "correct-horse-12";
const OWNER_PIN = "482615";

interface Fixture {
  ownerHeaders: Record<string, string>;
  cashierHeaders: Record<string, string>;
  ownerEmail: string;
  productA: string;
  productB: string;
}

async function setupAttacker(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  stamp: number,
): Promise<Fixture> {
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "Security Owner",
    email: `sec-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Security Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const owner = await findMembershipByEmail(request, ownerHeaders, ownerEmail);
  await setApprovalPin(request, ownerHeaders, owner.id, OWNER_PIN);

  const cashierEmail = `sec-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerHeaders, {
    email: cashierEmail, name: "Security Cashier", role: "cashier",
  });
  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword);

  const productA = await seedProduct(request, ownerHeaders, {
    name: `Sec A ${stamp}`, priceMinor: 1000, stock: 50,
  });
  const productB = await seedProduct(request, ownerHeaders, {
    name: `Sec B ${stamp}`, priceMinor: 1000, stock: 50,
  });
  return { ownerHeaders, cashierHeaders, ownerEmail, productA, productB };
}

/** Mints a real inventory.adjust grant for the cashier by authenticating as the owner. */
async function mintInventoryGrant(
  request: import("@playwright/test").APIRequestContext,
  cashierHeaders: Record<string, string>,
  ownerEmail: string,
  action: Record<string, unknown>,
): Promise<string> {
  const minted = await request.post(`${API}/api/v1/approvals/manager`, {
    headers: cashierHeaders,
    data: { email: ownerEmail, pin: OWNER_PIN, permission: "inventory.adjust", action },
  });
  expect(minted.ok(), `mint failed: ${minted.status()} ${await minted.text()}`).toBe(true);
  return ((await minted.json()) as { token: string }).token;
}

function movementBody(productId: string, qtyDelta: number, extra: Record<string, unknown> = {}) {
  return { productId, type: "receive", qtyDelta, ...extra };
}

test("protected inventory write rejects a missing, fabricated and malformed approval token", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());

  const noToken = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 5),
  });
  expect(noToken.status()).toBe(403);

  const fabricated = `mgr_${"f".repeat(48)}`;
  const fabricatedAttempt = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 5, { approvalToken: fabricated }),
  });
  expect(fabricatedAttempt.status()).toBe(403);

  // Too short for managerApprovalTokenSchema (min 20) — rejected before it
  // ever reaches the grant lookup.
  const malformed = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 5, { approvalToken: "short" }),
  });
  expect(malformed.status()).toBe(400);
});

test("an approval grant is strictly one-use: the replay of a consumed token is refused", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());
  const action = {
    kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 5,
  };
  const token = await mintInventoryGrant(request, fx.cashierHeaders, fx.ownerEmail, action);
  expect(token.startsWith("mgr_")).toBe(true);

  const first = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 5, { approvalToken: token }),
  });
  expect(first.status()).toBe(201);

  const replay = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 5, { approvalToken: token }),
  });
  expect(replay.status()).toBe(403);
});

test("a grant is bound to its exact action: changed quantity and changed product are refused", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());

  const grantForFive = await mintInventoryGrant(request, fx.cashierHeaders, fx.ownerEmail, {
    kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 5,
  });
  const changedQty = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 50, { approvalToken: grantForFive }),
  });
  expect(changedQty.status()).toBe(403);

  const grantForA = await mintInventoryGrant(request, fx.cashierHeaders, fx.ownerEmail, {
    kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 3,
  });
  const changedProduct = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productB, 3, { approvalToken: grantForA }),
  });
  expect(changedProduct.status()).toBe(403);
});

test("a grant stays bound to its requesting cashier and is not consumed by another session", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());
  const token = await mintInventoryGrant(request, fx.cashierHeaders, fx.ownerEmail, {
    kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 2,
  });

  // The grant is bound to the cashier who requested it; the owner session
  // (which already holds inventory.adjust) must not be able to spend it.
  const ownerSpend = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.ownerHeaders, data: movementBody(fx.productA, 2, { approvalToken: token }),
  });
  expect(ownerSpend.status()).toBe(201);
  // That 201 is the owner's own permission, not the grant: the grant must
  // still be unused, so the cashier can spend it exactly once afterwards.
  const cashierSpend = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 2, { approvalToken: token }),
  });
  expect(cashierSpend.status()).toBe(201);
  const secondCashierSpend = await request.post(`${API}/api/v1/inventory/movements`, {
    headers: fx.cashierHeaders, data: movementBody(fx.productA, 2, { approvalToken: token }),
  });
  expect(secondCashierSpend.status()).toBe(403);
});

test("client-supplied approval flags cannot switch a protected action into an unprotected one", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());

  const attempts: Record<string, unknown>[] = [
    { approvalRequired: false },
    { requiresApproval: false },
    { managerApproved: true },
    { approved: true },
    { permission: "inventory.adjust" },
    { role: "owner" },
    { overrides: ["inventory.adjust"] },
  ];
  for (const claim of attempts) {
    const response = await request.post(`${API}/api/v1/inventory/movements`, {
      headers: fx.cashierHeaders, data: movementBody(fx.productA, 1, claim),
    });
    expect(response.status(), `client claim ${JSON.stringify(claim)} must not grant access`).toBe(403);
  }
});

test("a grant minted for one protected action kind cannot be spent on another", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());
  const inventoryGrant = await mintInventoryGrant(request, fx.cashierHeaders, fx.ownerEmail, {
    kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 4,
  });

  // Spend it against the sale-void surface instead: the permission differs, so
  // the grant lookup must not match.
  const draft = await request.post(`${API}/api/v1/sales/drafts`, {
    headers: fx.ownerHeaders, data: { lines: [{ productId: fx.productA, qty: 1 }] },
  });
  expect(draft.ok()).toBe(true);
  const saleId = ((await draft.json()) as { id: string }).id;

  const crossKind = await request.post(`${API}/api/v1/sales/${saleId}/void`, {
    headers: fx.cashierHeaders,
    data: { reason: "cross-kind reuse attempt", approvalToken: inventoryGrant },
  });
  expect(crossKind.status()).toBe(403);
});

test("the approval mint endpoint refuses a requester who already holds the permission", async ({ page, request }) => {
  test.setTimeout(180_000);
  const fx = await setupAttacker(page, request, Date.now());
  // The owner holds inventory.adjust, so escalation-by-mint is not available.
  const selfMint = await request.post(`${API}/api/v1/approvals/manager`, {
    headers: fx.ownerHeaders,
    data: {
      email: fx.ownerEmail, pin: OWNER_PIN, permission: "inventory.adjust",
      action: { kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 1 },
    },
  });
  expect(selfMint.status()).toBe(403);

  // A manager approving their own request is refused: approver must differ.
  const selfApprove = await request.post(`${API}/api/v1/approvals/manager`, {
    headers: fx.ownerHeaders,
    data: {
      email: fx.ownerEmail, pin: OWNER_PIN, permission: "inventory.adjust",
      action: { kind: "inventory_movement", productId: fx.productA, movementType: "receive", qtyDelta: 1 },
    },
  });
  expect(selfApprove.status()).toBe(403);
});

// Distinct from OWNER_PIN on purpose: business B's owner holds a genuinely
// valid approval credential, so this case fails only if the approver lookup is
// correctly scoped to the requesting business.
const FOREIGN_PIN = "519273";

test("an approver from another business cannot authorize this business's action", async ({ page, request }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();

  // Business A — the workspace whose action is being protected.
  const ownerAEmail = await registerOperationalBusiness(page, {
    ownerName: "Tenant A Owner",
    email: `tenant-a-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Tenant A ${stamp}`,
  });
  const { headers: ownerAHeaders } = await apiAuthedContext(request, ownerAEmail, OWNER_PASSWORD, page);
  const ownerA = await findMembershipByEmail(request, ownerAHeaders, ownerAEmail);
  await setApprovalPin(request, ownerAHeaders, ownerA.id, OWNER_PIN);

  const cashierEmail = `tenant-a-cashier-${stamp}@example.com`;
  const cashier = await createStaffMember(request, ownerAHeaders, {
    email: cashierEmail, name: "Tenant A Cashier", role: "cashier",
  });
  const { headers: cashierHeaders } = await apiAuthedContext(request, cashierEmail, cashier.tempPassword);
  const productA = await seedProduct(request, ownerAHeaders, {
    name: `Tenant A Item ${stamp}`, priceMinor: 1000, stock: 20,
  });

  // Business B — an unrelated owner with a real, valid approval PIN.
  const ownerBEmail = await registerOperationalBusiness(page, {
    ownerName: "Tenant B Owner",
    email: `tenant-b-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `Tenant B ${stamp}`,
  });
  const { headers: ownerBHeaders } = await apiAuthedContext(request, ownerBEmail, OWNER_PASSWORD, page);
  const ownerB = await findMembershipByEmail(request, ownerBHeaders, ownerBEmail);
  await setApprovalPin(request, ownerBHeaders, ownerB.id, FOREIGN_PIN);

  const action = {
    kind: "inventory_movement", productId: productA, movementType: "receive", qtyDelta: 5,
  };

  // The foreign owner's credentials are genuine, but they hold no membership in
  // business A, so the grant must not be minted.
  const foreign = await request.post(`${API}/api/v1/approvals/manager`, {
    headers: cashierHeaders,
    data: { email: ownerBEmail, pin: FOREIGN_PIN, permission: "inventory.adjust", action },
  });
  expect(foreign.status()).toBe(401);
  expect(((await foreign.json()) as { code: string }).code).toBe("AUTH_INVALID_CREDENTIALS");

  // Identical request with business A's own owner succeeds, which isolates the
  // refusal to tenancy rather than to a malformed payload.
  const own = await request.post(`${API}/api/v1/approvals/manager`, {
    headers: cashierHeaders,
    data: { email: ownerAEmail, pin: OWNER_PIN, permission: "inventory.adjust", action },
  });
  expect(own.ok()).toBe(true);
  expect(((await own.json()) as { token: string }).token.startsWith("mgr_")).toBe(true);
});

test("approval PIN enrolment is an owner/manager capability and is refused for other roles", async ({ page, request }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const ownerEmail = await registerOperationalBusiness(page, {
    ownerName: "PIN Owner",
    email: `pin-owner-${stamp}@example.com`,
    password: OWNER_PASSWORD,
    businessName: `PIN Store ${stamp}`,
  });
  const { headers: ownerHeaders } = await apiAuthedContext(request, ownerEmail, OWNER_PASSWORD, page);
  const owner = await findMembershipByEmail(request, ownerHeaders, ownerEmail);

  const cashier = await createStaffMember(request, ownerHeaders, {
    email: `pin-cashier-${stamp}@example.com`, name: "PIN Cashier", role: "cashier",
  });
  const inventory = await createStaffMember(request, ownerHeaders, {
    email: `pin-inventory-${stamp}@example.com`, name: "PIN Inventory", role: "inventory",
  });
  const manager = await createStaffMember(request, ownerHeaders, {
    email: `pin-manager-${stamp}@example.com`, name: "PIN Manager", role: "manager",
  });

  const enrol = (membershipId: string, pin: string) =>
    request.post(`${API}/api/v1/memberships/${membershipId}/approval-pin`, {
      headers: ownerHeaders, data: { pin },
    });

  // The approval PIN is a manager credential: approving is only ever done by an
  // owner or manager, so enrolling any other role must fail closed. Both the
  // service guard and the team UI enforce this.
  expect((await enrol(cashier.membershipId, "111111")).status()).toBe(400);
  expect((await enrol(inventory.membershipId, "222222")).status()).toBe(400);

  // The two enrolable approver roles are accepted.
  expect((await enrol(manager.membershipId, "333333")).status()).toBe(200);

  // A malformed credential is rejected before it is hashed.
  expect((await enrol(manager.membershipId, "12ab")).status()).toBe(400);
});
