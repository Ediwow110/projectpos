import { describe, expect, it } from "vitest";

import { createCatalogProductRequest, importCatalogProductsRequest, type ProductsApiCall } from "./products-api";
import { changeTeamMemberRoleRequest, createTeamMemberRequest, deactivateTeamMemberRequest, loadTeamBranchAssignment, loadTeamRegisterAssignment, loadTeamPermissionRestrictions, saveTeamApprovalPinRequest, saveTeamBranchAssignment, saveTeamRegisterAssignment, saveTeamPermissionRestrictions, type TeamApiCall } from "./team-api";

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
  it("confirms the owner password before persisting a register allowlist without credential leakage", async () => {
    const { api, calls } = captureApi();
    await loadTeamRegisterAssignment("seat/1", api);
    await saveTeamRegisterAssignment("seat/1", ["register-1"], "owner-password", api);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/memberships/seat%2F1/registers",
      "/api/v1/auth/csrf",
      "/api/v1/auth/confirm-password",
      "/api/v1/memberships/seat%2F1/registers",
    ]);
    expect(calls[3]).toMatchObject({
      method: "PATCH", csrfToken: "csrf",
      body: JSON.stringify({ registerIds: ["register-1"] }),
    });
    expect(calls[3]?.body).not.toContain("owner-password");
  });
  it("validates owner credentials before updating branch assignments and sends only branch IDs", async () => {
    const { api, calls } = captureApi();
    await loadTeamBranchAssignment("seat/1", api);
    await saveTeamBranchAssignment("seat/1", ["branch-a"], "owner-password", api);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/memberships/seat%2F1/branches", "/api/v1/auth/csrf",
      "/api/v1/auth/confirm-password", "/api/v1/memberships/seat%2F1/branches",
    ]);
    expect(calls[3]).toMatchObject({
      method: "PATCH", csrfToken: "csrf", body: JSON.stringify({ branchIds: ["branch-a"] }),
    });
    expect(calls[3]?.body).not.toContain("owner-password");
  });
  it("loads and saves only deny-only employee permissions after owner confirmation", async () => {
    const { api, calls } = captureApi();
    await loadTeamPermissionRestrictions("m/1", api);
    await saveTeamPermissionRestrictions("m/1", ["cost.view"], "confirmation", api);
    expect(calls.map(({ path }) => path)).toEqual([
      "/api/v1/memberships/m%2F1/restrictions",
      "/api/v1/auth/csrf",
      "/api/v1/auth/confirm-password",
      "/api/v1/memberships/m%2F1/restrictions",
    ]);
    expect(calls[2]).toMatchObject({ method: "POST", csrfToken: "csrf" });
    expect(calls[3]).toMatchObject({
      method: "PATCH", csrfToken: "csrf",
      body: JSON.stringify({ deniedPermissions: ["cost.view"] }),
    });
    expect(calls[3]?.body).not.toContain("confirmation");
  });
  it("confirms owner credentials before changing a role and keeps credentials out of the membership request", async () => {
    const { api, calls } = captureApi();
    await changeTeamMemberRoleRequest("m/2", "manager", "owner-confirmation", api);
    expect(calls.map((call) => call.path)).toEqual([
      "/api/v1/auth/csrf", "/api/v1/auth/confirm-password", "/api/v1/memberships/m%2F2/role",
    ]);
    expect(calls[1]).toMatchObject({ method: "POST", csrfToken: "csrf" });
    expect(calls[2]).toMatchObject({ method: "PATCH", body: JSON.stringify({ role: "manager" }), csrfToken: "csrf" });
    expect(calls[2]?.body).not.toContain("owner-confirmation");
  });
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
