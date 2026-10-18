import { expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";

export const API = `http://localhost:${process.env.E2E_API_PORT ?? "3101"}`;

export function posCartRegion(page: Page): Locator {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1024) return page.getByRole("region", { name: "Mobile cart" });
  if (width < 1280) return page.getByRole("region", { name: "Tablet cart" });
  return page.getByRole("complementary", { name: "Cart" });
}

export async function clickPosPay(page: Page, amount: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  const cart = posCartRegion(page);
  if (width < 1280) {
    await cart.getByRole("button", { name: "Pay", exact: true }).click();
    return;
  }
  await cart.getByRole("button", { name: new RegExp("Pay ₱" + amount.replace(".", "\\.")) }).click();
  // Atlas V4 desktops deliberately show method selection before the detailed
  // payment workspace. Do not bypass this user-facing step in E2E checkout.
  const chooser = page.getByRole("dialog", { name: "Payment" });
  await expect(chooser).toHaveAttribute("data-ui", "atlas-v4-payment-chooser");
  await chooser.getByRole("button", { name: "Continue" }).click();
}

/** Confirm the quantity picker shown by a product tile before adding it to the cart. */
export async function confirmPosQuantity(page: Page, pieces = 1): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Choose pieces" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Pieces" }).fill(String(pieces));
  await dialog.getByRole("button", { name: "Add to sale" }).click();
  await expect(dialog).toBeHidden();
}

export async function expectOnePosCartItem(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1280) {
    await expect(posCartRegion(page).getByText("1 item in cart", { exact: true })).toBeVisible();
    return;
  }
  const cart = posCartRegion(page);
  await expect(cart.getByRole("heading", { name: "Cart (1)" })).toBeVisible();
  await expect(cart.locator("ul > li").first()).not.toContainText("Cart is empty.");
}

export async function registerBusiness(
  page: Page,
  input: { ownerName: string; email: string; password: string; businessName: string },
): Promise<string> {
  await page.goto("/register");
  // Two Playwright projects can start the same spec in the same millisecond;
  // a worker-unique suffix keeps their registrations from colliding on the
  // unique email (AUTH_EMAIL_TAKEN would leave the browser stuck on /register).
  const unique = `${process.env.TEST_WORKER_INDEX ?? "w"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = input.email.replace(/@/, `-${unique}@`);
  await page.getByLabel("Your name").fill(input.ownerName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (12+ characters)").fill(input.password);
  await page.getByLabel("Business name").fill(input.businessName);
  await page.getByRole("button", { name: "Create business" }).click();
  // Cold-start tolerance: the first registration of a run pays Next dev page
  // compilation plus the API's first queries and argon2 warm-up.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 60_000 });
  return email;
}

export async function registerOperationalBusiness(
  page: Page,
  input: { ownerName: string; email: string; password: string; businessName: string },
): Promise<string> {
  const email = await registerBusiness(page, input);
  const result = await page.evaluate(async () => {
    const csrfResponse = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    if (!csrfResponse.ok) return { ok: false, status: csrfResponse.status };
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    for (const [step, settings] of [
      ["businessDetails", { businessAddress: "123 Test Street, Manila", businessTimezone: "Asia/Manila" }],
      ["taxCurrency", { currency: "PHP", taxName: "No tax", taxRateBps: 0 }],
      ["receiptSetup", { standardReceiptConfirmed: true }],
    ] as const) {
      const configured = await fetch("/api/v1/business/settings", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.csrfToken },
        body: JSON.stringify(settings),
      });
      if (!configured.ok) return { ok: false, status: configured.status };
      const response = await fetch("/api/v1/onboarding", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf.csrfToken,
        },
        body: JSON.stringify({
          step, state: "done",
          ...(step === "receiptSetup" ? { receiptPreviewConfirmed: true } : {}),
        }),
      });
      if (!response.ok) return { ok: false, status: response.status };
    }
    return { ok: true, status: 200 };
  });
  expect(result.ok, `operational onboarding setup failed with HTTP ${result.status}`).toBe(true);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  await expect(tour).toBeVisible({ timeout: 30_000 });
  const persisted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/tour/seen")
      && response.request().method() === "POST"
      && response.ok(),
    { timeout: 30_000 },
  );
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await persisted;
  await expect(tour).toBeHidden();
  return email;
}

export async function apiAuthedContext(
  request: APIRequestContext,
  email: string,
  password: string,
  page?: Page,
): Promise<{ headers: Record<string, string>; csrf: string }> {
  // Prefer the browser's live session: the API login endpoint allows 5 attempts
  // per minute per IP, and a full parallel e2e run would otherwise spend that
  // budget on redundant logins instead of on the flows under test.
  if (page) {
    // Reuse the browser's live session: the API login endpoint allows 5 attempts
    // per minute per IP, and a full parallel e2e run would otherwise spend that
    // budget on redundant logins. GET /auth/csrf issues a fresh pos_csrf cookie
    // and returns the matching token, so both sides are set from that one value
    // (the standalone request context does not persist response cookies).
    const cookies = await page.context().cookies(API);
    const session = cookies.find((c) => c.name === "pos_session")?.value ?? "";
    expect(session).not.toBe("");
    const csrfRes = await request.get(`${API}/api/v1/auth/csrf`, {
      headers: { Cookie: `pos_session=${session}` },
    });
    expect(csrfRes.ok()).toBe(true);
    const csrf = ((await csrfRes.json()) as { csrfToken: string }).csrfToken;
    const cookie = `pos_session=${session}; pos_csrf=${csrf}`;
    return { headers: { Cookie: cookie, "X-CSRF-Token": csrf }, csrf };
  }
  const login = await request.post(`${API}/api/v1/auth/login`, { data: { email, password } });
  expect(login.ok()).toBe(true);
  const cookies = login.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value.split(";")[0]);
  const body = await login.json();
  return { headers: { Cookie: cookies.join("; "), "X-CSRF-Token": body.csrfToken }, csrf: body.csrfToken };
}

/** Creates a staff membership through the owner API and returns its temp password. */
export async function createStaffMember(
  request: APIRequestContext,
  headers: Record<string, string>,
  input: { email: string; name: string; role: "manager" | "cashier" | "inventory" },
): Promise<{ membershipId: string; tempPassword: string }> {
  const created = await request.post(`${API}/api/v1/memberships`, { headers, data: input });
  expect(created.ok()).toBe(true);
  const body = (await created.json()) as { membershipId?: string; tempPassword?: string };
  expect(body.membershipId).toBeTruthy();
  expect(body.tempPassword).toBeTruthy();
  return { membershipId: body.membershipId as string, tempPassword: body.tempPassword as string };
}

/** Sets the six-digit approval PIN the manager-approval dialog authenticates with. */
export async function setApprovalPin(
  request: APIRequestContext,
  headers: Record<string, string>,
  membershipId: string,
  pin: string,
): Promise<void> {
  const set = await request.post(`${API}/api/v1/memberships/${membershipId}/approval-pin`, {
    headers,
    data: { pin },
  });
  expect(set.ok()).toBe(true);
}

export async function findMembershipByEmail(
  request: APIRequestContext,
  headers: Record<string, string>,
  email: string,
): Promise<{ id: string; role: string }> {
  const list = await request.get(`${API}/api/v1/memberships`, { headers });
  expect(list.ok()).toBe(true);
  const body = (await list.json()) as { items: Array<{ id: string; email: string; role: string }> };
  const found = body.items.find((member) => member.email === email);
  expect(found, `membership for ${email} exists`).toBeTruthy();
  return { id: found!.id, role: found!.role };
}

/** Signs into the workspace from a clean cookie jar and clears the first-run tour. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
  const tour = page.getByRole("dialog", { name: "Welcome to NexPOS" });
  const tourVisible = await tour.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (tourVisible) {
    await tour.getByRole("button", { name: "Skip tour" }).click();
    await expect(tour).toBeHidden();
  }
}

export async function signOut(page: Page): Promise<void> {
  // Atlas V4 mobile keeps session actions in the accessible workspace menu.
  // Atlas V4 desktop keeps them in the role-specific rail, not a hidden header.
  const mobileHeader = page.locator('[data-ui="atlas-mobile-header"]');
  const sidebar = page.locator('[data-ui="shell-sidebar"]');
  if (await mobileHeader.isVisible()) {
    await mobileHeader.getByRole("button", { name: "Open workspace menu" }).click();
    await page.locator('[data-ui="shell-mobile-more"]').getByRole("button", { name: "Sign out" }).click();
  } else if (await sidebar.isVisible() &&
      await sidebar.getByRole("button", { name: "Sign out" }).count() > 0) {
    await sidebar.getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("banner").getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
}

/** Fills the shared manager-approval dialog and submits it. */
export async function approveWithPin(
  page: Page,
  email: string,
  pin: string,
): Promise<ReturnType<Page["getByRole"]>> {
  const dialog = page.getByRole("dialog", { name: "Manager approval" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Manager email").fill(email);
  await dialog.getByLabel("Approval PIN").fill(pin);
  await dialog.getByRole("button", { name: "Approve & continue" }).click();
  return dialog;
}

/** Creates a register and opens a shift on it so POS can take payments. */
export async function createCounterWithOpenShift(page: Page, name: string): Promise<void> {
  await page.goto("/registers");
  await page.getByRole("button", { name: "+ Create register", exact: true }).click();
  const registerDialog = page.getByRole("dialog", { name: "Create register" });
  await registerDialog.getByLabel("Register name").fill(name);
  await registerDialog.getByRole("button", { name: "Create register", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.goto("/shifts");
  await page.getByRole("button", { name: "+ Open shift", exact: true }).click();
  const shiftDialog = page.getByRole("dialog", { name: "Open shift" });
  await shiftDialog.getByLabel("Register").selectOption({ label: name });
  await shiftDialog.getByRole("button", { name: "Open shift", exact: true }).click();
  await expect(page.getByText("Shift opened.")).toBeVisible();
}

export async function selectPosRegister(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 768) {
    await page.getByLabel("Mobile register").selectOption({ label: name });
  } else {
    await page.getByLabel("Register", { exact: true }).selectOption({ label: name });
  }
}

export async function openDiscounts(page: Page): Promise<Locator> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width >= 1280) {
    await posCartRegion(page).getByRole("button", { name: "Discounts", exact: true }).click();
  } else {
    await posCartRegion(page).getByRole("button", { name: "View cart", exact: true }).click();
    await page.getByRole("dialog", { name: "Tablet cart details" }).getByRole("button", { name: "Discounts", exact: true }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Sale discounts" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function expectPosStatus(page: Page, text: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1280) {
    await expect(page.getByRole("region", { name: "Tablet payment status" }).getByText(text, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("complementary", { name: "Cart" }).getByText(text, { exact: true })).toBeVisible();
  }
}

/** Sells one product through the POS UI and returns the completed sale id. */
export async function completePosSale(
  page: Page,
  request: APIRequestContext,
  headers: Record<string, string>,
  input: { productName: string; productPriceLabel: string; register: string; payAmount: string },
): Promise<string> {
  await page.goto("/pos");
  await selectPosRegister(page, input.register);
  await page.getByLabel("Search product, SKU or scan barcode").fill(input.productName);
  await page.getByRole("button", { name: `${input.productName} ₱${input.productPriceLabel}` }).click();
  await confirmPosQuantity(page);
  await expectOnePosCartItem(page);
  await clickPosPay(page, input.payAmount);
  await expect(page.getByRole("dialog", { name: "Payment" })).toBeVisible();
  await page.getByRole("button", { name: "Complete Payment" }).click();
  await expectPosStatus(page, "Sale completed.");
  const confirmation = page.getByRole("dialog", { name: "Payment complete" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "OK", exact: true }).click();
  await expect(confirmation).toBeHidden();

  const sales = await request.get(`${API}/api/v1/sales?limit=20`, { headers });
  expect(sales.ok()).toBe(true);
  const completed = ((await sales.json()) as { items: Array<{ id: string; status: string }> }).items
    .find((sale) => sale.status === "COMPLETED");
  expect(completed).toBeTruthy();
  return completed!.id;
}

export async function seedProduct(
  request: APIRequestContext,
  headers: Record<string, string>,
  input: { name: string; priceMinor: number; stock: number },
): Promise<string> {
  const created = await request.post(`${API}/api/v1/products`, {
    headers,
    data: { name: input.name, priceMinor: input.priceMinor, costMinor: 1000 },
  });
  expect(created.ok()).toBe(true);
  const product = await created.json();
  const stocked = await request.post(`${API}/api/v1/inventory/movements`, {
    headers,
    data: { productId: product.id, type: "opening_stock", qtyDelta: input.stock },
  });
  expect(stocked.ok()).toBe(true);
  return product.id as string;
}
