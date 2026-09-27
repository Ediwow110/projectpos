import { expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";

export const API = "http://localhost:3101";

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
}

export async function expectOnePosCartItem(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 1280) {
    await expect(posCartRegion(page).getByText("1 item in cart", { exact: true })).toBeVisible();
    return;
  }
  await expect(page.getByRole("heading", { name: "Cart (1)" })).toBeVisible();
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
