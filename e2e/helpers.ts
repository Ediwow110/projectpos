import { expect, type Page, type APIRequestContext } from "@playwright/test";

export const API = "http://localhost:3001";

export async function registerBusiness(
  page: Page,
  input: { ownerName: string; email: string; password: string; businessName: string },
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(input.ownerName);
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password (12+ characters)").fill(input.password);
  await page.getByLabel("Business name").fill(input.businessName);
  await page.getByRole("button", { name: "Create business" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

export async function apiAuthedContext(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ headers: Record<string, string>; csrf: string }> {
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
