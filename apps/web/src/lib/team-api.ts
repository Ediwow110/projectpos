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
