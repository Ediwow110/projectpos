import { apiFetch } from "./api";

export type TeamApiCall = <T>(
  path: string,
  options?: { csrfToken?: string; init?: RequestInit },
) => Promise<T>;

async function csrfToken(api: TeamApiCall): Promise<string> {
  return (await api<{ csrfToken: string }>("/api/v1/auth/csrf")).csrfToken;
}

export async function createTeamMemberRequest(
  input: { name: string; email: string; role: string },
  api: TeamApiCall = apiFetch,
): Promise<{ membershipId: string; userId: string; tempPassword?: string }> {
  const csrf = await csrfToken(api);
  return api("/api/v1/memberships", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify(input) },
  });
}

export async function deactivateTeamMemberRequest(id: string, api: TeamApiCall = apiFetch): Promise<void> {
  const csrf = await csrfToken(api);
  await api(`/api/v1/memberships/${id}/deactivate`, { csrfToken: csrf, init: { method: "POST" } });
}

export async function saveTeamApprovalPinRequest(id: string, pin: string, api: TeamApiCall = apiFetch): Promise<void> {
  const csrf = await csrfToken(api);
  await api(`/api/v1/memberships/${id}/approval-pin`, {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ pin }) },
  });
}

export async function changeTeamMemberRoleRequest(
  id: string,
  role: "manager" | "cashier" | "inventory",
  confirmation: string,
  api: TeamApiCall = apiFetch,
): Promise<{ ok: true; role: string }> {
  const csrf = await csrfToken(api);
  await api("/api/v1/auth/confirm-password", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ password: confirmation }) },
  });
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/role`, {
    csrfToken: csrf,
    init: { method: "PATCH", body: JSON.stringify({ role }) },
  });
}

export interface MemberPermissionRestrictions {
  role: string;
  rolePermissions: string[];
  deniedPermissions: string[];
}

export async function loadTeamPermissionRestrictions(
  id: string,
  api: TeamApiCall = apiFetch,
): Promise<MemberPermissionRestrictions> {
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/restrictions`);
}

export async function saveTeamPermissionRestrictions(
  id: string,
  deniedPermissions: string[],
  confirmation: string,
  api: TeamApiCall = apiFetch,
): Promise<{ role: string; deniedPermissions: string[] }> {
  const csrf = await csrfToken(api);
  await api("/api/v1/auth/confirm-password", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ password: confirmation }) },
  });
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/restrictions`, {
    csrfToken: csrf,
    init: { method: "PATCH", body: JSON.stringify({ deniedPermissions }) },
  });
}

export async function loadTeamBranchAssignment(
  id: string,
  api: TeamApiCall = apiFetch,
): Promise<{ branchIds: string[] | null }> {
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/branches`);
}

export async function saveTeamBranchAssignment(
  id: string,
  branchIds: string[] | null,
  password: string,
  api: TeamApiCall = apiFetch,
): Promise<{ branchIds: string[] | null }> {
  const csrf = await csrfToken(api);
  await api("/api/v1/auth/confirm-password", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ password }) },
  });
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/branches`, {
    csrfToken: csrf,
    init: { method: "PATCH", body: JSON.stringify({ branchIds }) },
  });
}

export async function loadTeamRegisterAssignment(
  id: string, api: TeamApiCall = apiFetch,
): Promise<{ registerIds: string[] | null }> {
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/registers`);
}

export async function saveTeamRegisterAssignment(
  id: string, registerIds: string[] | null, password: string, api: TeamApiCall = apiFetch,
): Promise<{ registerIds: string[] | null }> {
  const csrf = await csrfToken(api);
  await api("/api/v1/auth/confirm-password", {
    csrfToken: csrf,
    init: { method: "POST", body: JSON.stringify({ password }) },
  });
  return api(`/api/v1/memberships/${encodeURIComponent(id)}/registers`, {
    csrfToken: csrf,
    init: { method: "PATCH", body: JSON.stringify({ registerIds }) },
  });
}
