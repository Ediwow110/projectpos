export class ApiError extends Error {
  code: string;
  correlationId: string;
  status: number;
  fields: Record<string, string[]>;
  constructor(
    code: string,
    message: string,
    correlationId: string,
    status: number,
    fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.code = code;
    this.correlationId = correlationId;
    this.status = status;
    this.fields = fields;
  }
}

const API_BASE =
  (typeof process !== "undefined" && process.env["NEXT_PUBLIC_API_BASE"]) ||
  "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 15_000;

export function apiBase(): string {
  return API_BASE;
}

export async function apiFetch<T>(
  path: string,
  opts: { csrfToken?: string; init?: RequestInit; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.init?.signal
    ? AbortSignal.any([opts.init.signal, timeoutSignal])
    : timeoutSignal;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...opts.init,
      signal,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(opts.csrfToken ? { "X-CSRF-Token": opts.csrfToken } : {}),
        ...((opts.init?.headers ?? {}) as Record<string, string>),
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError") {
      throw new ApiError("NETWORK_TIMEOUT", "The request timed out.", "", 0);
    }
    if (name === "AbortError") throw error;
    throw new ApiError("NETWORK_ERROR", "Could not reach the API.", "", 0);
  }
  const body = (await res.json()) as T & {
    code?: string;
    message?: string;
    correlationId?: string;
    fields?: Record<string, string[]>;
  };
  if (!res.ok) {
    throw new ApiError(
      body.code ?? "UNKNOWN",
      body.message ?? "Request failed",
      body.correlationId ?? "",
      res.status,
      body.fields ?? {},
    );
  }
  return body as T;
}
