import { ApiError, apiFetch } from "./api";

interface ApiOptions {
  csrfToken?: string;
  init?: RequestInit;
}

type ProcurementApiCall = <T>(path: string, options?: ApiOptions) => Promise<T>;

export async function mutateProcurementRequest(input: {
  online: boolean;
  path: string;
  init: RequestInit;
  offlineMessage: string;
  api?: ProcurementApiCall;
}): Promise<void> {
  if (!input.online) throw new ApiError("NETWORK_ERROR", input.offlineMessage, "", 0);
  const api = input.api ?? apiFetch;
  const csrf = await api<{ csrfToken: string }>("/api/v1/auth/csrf");
  await api(input.path, { csrfToken: csrf.csrfToken, init: input.init });
}
