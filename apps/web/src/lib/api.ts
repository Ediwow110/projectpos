export class ApiError extends Error {
  code: string;
  correlationId: string;
  status: number;
  constructor(code: string, message: string, correlationId: string, status: number) {
    super(message);
    this.code = code;
    this.correlationId = correlationId;
    this.status = status;
  }
}

const API_BASE =
  (typeof process !== "undefined" && process.env["NEXT_PUBLIC_API_BASE"]) ||
  "http://localhost:3001";

export function apiBase(): string {
  return API_BASE;
}

export async function apiFetch<T>(
  path: string,
  opts: { csrfToken?: string; init?: RequestInit } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts.init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.csrfToken ? { "X-CSRF-Token": opts.csrfToken } : {}),
      ...((opts.init?.headers ?? {}) as Record<string, string>),
    },
  });
  const body = (await res.json()) as T & {
    code?: string;
    message?: string;
    correlationId?: string;
  };
  if (!res.ok) {
    throw new ApiError(
      body.code ?? "UNKNOWN",
      body.message ?? "Request failed",
      body.correlationId ?? "",
      res.status,
    );
  }
  return body as T;
}
