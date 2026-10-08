import { describe, expect, it } from "vitest";

import { createCatalogProductRequest, importCatalogProductsRequest, type ProductsApiCall } from "./products-api";
import { createTeamMemberRequest, deactivateTeamMemberRequest, saveTeamApprovalPinRequest, type TeamApiCall } from "./team-api";

function captureApi(): {
  api: TeamApiCall & ProductsApiCall;
  calls: Array<{ path: string; csrfToken?: string; method?: string; body?: string | null }>;
} {
  const calls: Array<{ path: string; csrfToken?: string; method?: string; body?: string | null }> = [];
  const api: TeamApiCall & ProductsApiCall = async <T>(
    path: string,
    options?: { csrfToken?: string; init?: RequestInit },
  ): Promise<T> => {
    calls.push({
      path,
      csrfToken: options?.csrfToken,
      method: options?.init?.method,
      body: options?.init?.body as string | null | undefined,
    });
    if (path === "/api/v1/auth/csrf") return { csrfToken: "csrf" } as T;
    if (path === "/api/v1/memberships") return { membershipId: "m1", userId: "u2" } as T;
    if (path === "/api/v1/products") return { id: "p1", name: "Iced Latte" } as T;
    return {} as T;
  };
  return { api, calls };
}

describe("admin page API boundaries", () => {
  it("preserves team mutation endpoints and bodies", async () => {
    const { api, calls } = captureApi();
    await createTeamMemberRequest({ name: "Sam", email: "sam@example.com", role: "cashier" }, api);
    await deactivateTeamMemberRequest("m1", api);
    await saveTeamApprovalPinRequest("m2", "123456", api);
    expect(calls[1]).toMatchObject({ path: "/api/v1/memberships", csrfToken: "csrf", method: "POST" });
    expect(calls[1]?.body).toBe(JSON.stringify({ name: "Sam", email: "sam@example.com", role: "cashier" }));
    expect(calls[3]).toMatchObject({ path: "/api/v1/memberships/m1/deactivate", csrfToken: "csrf", method: "POST" });
    expect(calls[5]?.body).toBe(JSON.stringify({ pin: "123456" }));
  });

  it("preserves product create and import bodies", async () => {
    const { api, calls } = captureApi();
    const item = { name: "Iced Latte", priceMinor: 14950, unit: "pc" };
    await createCatalogProductRequest(item, api);
    await importCatalogProductsRequest([item], api);
    expect(calls[1]?.body).toBe(JSON.stringify(item));
    expect(calls[3]).toMatchObject({ path: "/api/v1/products/import", csrfToken: "csrf", method: "POST" });
    expect(calls[3]?.body).toBe(JSON.stringify({ items: [item] }));
  });
});
