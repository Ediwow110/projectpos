import { apiFetch } from "./api";

export type ProductsApiCall = <T>(
  path: string,
  options?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

async function csrfToken(api: ProductsApiCall): Promise<string> {
  return (await api<{ csrfToken: string }>("/api/v1/auth/csrf")).csrfToken;
}

export async function createCatalogProductRequest(
  input: Record<string, unknown>,
  api: ProductsApiCall = apiFetch,
): Promise<{ id: string; name: string }> {
  const csrf = await csrfToken(api);
  return api("/api/v1/products", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export async function importCatalogProductsRequest<T>(
  items: T[],
  api: ProductsApiCall = apiFetch,
): Promise<void> {
  const csrf = await csrfToken(api);
  await api("/api/v1/products/import", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ items }) },
  });
}
